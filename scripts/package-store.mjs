// package-store.mjs — Empacar la extension para Chrome Web Store.
//
// - Incluye SOLO los archivos de runtime (allowlist): nunca dependemos de
//   denylist (asi no se filtra una key/zip/log nuevo por error).
// - Escanea cada archivo en busca de secretos (AIza..., AQ..., Bearer,
//   -----BEGIN, sk-...) y aborta si encuentra algo.
// - Genera proonboarding-<version>.zip (ZIP valido, sin dependencias externas)
//   en la raiz del repo. *.zip ya esta en .gitignore.
//
// Uso: node scripts/package-store.mjs
// Luego subir el .zip a https://chrome.google.com/webstore/devconsole

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const EXT = path.resolve('extension');
const OUT = path.resolve(`proonboarding-${getVersion()}.zip`);

const RUNTIME_FILES = [
  'manifest.json',
  'background.js',
  'content.js',
  'content.css',
  'ai-engine.js',
  'tts-provider.js',
  'realtime-voice.js',
  'voice-worklet.js',
  'offscreen.html',
  'offscreen.js',
  'request-mic.html',
  'request-mic.js',
  'sidepanel.html',
  'sidepanel.css',
  'sidepanel.js',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png'
];

const SECRET_PATTERNS = [
  /AIza[0-9A-Za-z_\-]{20,}/,       // Google API key
  /AQ\.Ab[0-9A-Za-z_\-]{10,}/,      // Gemini Live ephemeral-ish key (dev)
  /dfcb[0-9A-Za-z]{20,}/,           // Deepgram dev key prefix
  /sk-[0-9A-Za-z]{16,}/,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
  /\bbearer\s+[0-9A-Za-z_\-.]{20,}/i
];

function getVersion() {
  const m = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  return String(m.version || '0.0.0');
}

function scanSecrets() {
  const hits = [];
  for (const rel of RUNTIME_FILES) {
    const buf = fs.readFileSync(path.join(EXT, rel));
    const text = buf.toString('utf8');
    for (const re of SECRET_PATTERNS) {
      const m = text.match(re);
      if (m) hits.push(`${rel}: ${m[0].slice(0, 12)}...`);
    }
  }
  if (hits.length) {
    console.error('Abortando: se encontraron posibles secretos en los archivos a empacar:');
    for (const h of hits) console.error('  -', h);
    process.exit(1);
  }
}

// --- ZIP writer minimo (metodo DEFLATE, sin dependencias) ------------------

const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function dosTime(d) {
  return ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() >> 1) & 0x1f);
}
function dosDate(d) {
  return (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
}
function u16(v) { const b = Buffer.alloc(2); b.writeUInt16LE(v, 0); return b; }
function u32(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0, 0); return b; }

function buildZip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const time = dosTime(now);
  const date = dosDate(now);

  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const comp = zlib.deflateRawSync(data);
    const crc = crc32(data);

    const lfh = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(8), u16(time), u16(date),
      u32(crc), u32(comp.length), u32(data.length), u16(nameBuf.length), u16(0)
    ]);
    parts.push(lfh, nameBuf, comp);

    central.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(8), u16(time), u16(date),
      u32(crc), u32(comp.length), u32(data.length), u16(nameBuf.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset)
    ]), nameBuf);

    offset += lfh.length + nameBuf.length + comp.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(centralBuf.length), u32(offset), u16(0)
  ]);
  return Buffer.concat([...parts, centralBuf, eocd]);
}

function readZipList(buf) {
  // Lectura de verificado: nombre y metodo por entries de la central directory.
  // Buscar el EOCD desde el final.
  const eocdIdx = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const entries = buf.readUInt16LE(eocdIdx + 10);
  let off = buf.readUInt32LE(eocdIdx + 16);
  const out = [];
  for (let i = 0; i < entries; i++) {
    const sig = buf.readUInt32LE(off);
    if (sig !== 0x02014b50) throw new Error('Central directory corrupto');
    const nameLen = buf.readUInt16LE(off + 28);
    const extLen = buf.readUInt16LE(off + 30);
    const cmtLen = buf.readUInt16LE(off + 32);
    out.push(buf.toString('utf8', off + 46, off + 46 + nameLen));
    off += 46 + nameLen + extLen + cmtLen;
  }
  return out;
}

// --- flujo ----------------------------------------------------------------

console.log('Empacando extension v' + getVersion() + ' para Chrome Web Store...');
scanSecrets();

let missing = 0;
const files = [];
for (const rel of RUNTIME_FILES) {
  const p = path.join(EXT, rel);
  if (!fs.existsSync(p)) { console.error('Falta archivo runtime:', rel); missing++; continue; }
  files.push({ name: rel.replace(/\\/g, '/'), data: fs.readFileSync(p) });
}
if (missing) process.exit(1);

const zip = buildZip(files);
fs.writeFileSync(OUT, zip);
console.log('\nIncluidos (' + files.length + '):');
for (const f of files) console.log('  ' + f.name + '  (' + f.data.length + ' B)');

const listed = readZipList(zip);
const bad = files.filter((f) => !listed.includes(f.name));
if (bad.length) { console.error('Verificacion fallida, entradas faltantes:', bad.map((b) => b.name)); process.exit(1); }

console.log('\nOK: ' + OUT + ' (' + zip.length.toFixed(0) + ' bytes, ' + listed.length + ' entradas).');
console.log('Subilo en la consola del Store (Package) usando el mismo ID que Publishees del manifest.');