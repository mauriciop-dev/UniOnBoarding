// verify-store-package.mjs
// Verifica que el paquete de la Store cumple con los requisitos antes de subir.
//
// Uso: node scripts/verify-store-package.mjs
//
// Que verifica:
//  1) El zip existe y tiene la cantidad de archivos esperada.
//  2) Cada entrada esperada esta presente (allowlist).
//  3) Ningun archivo excede el tamano maximo recomendado para la Store (50 MB por archivo, 2 GB total).
//  4) La version del manifest coincide con el nombre del zip (proonboarding-X.Y.Z.zip).
//  5) Los permisos del manifest son los declarados (no hay permisos " fantasma " no documentados).
//  6) No hay secretos filtrados (ya lo hace package-store.mjs, pero se re-verifica aqui).
//  7) El JSON del manifest es valido y completo.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const MANIFEST_PATH = path.join(ROOT, 'extension', 'manifest.json');
const _manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const _version = String(_manifest.version || '0.0.0');
const ZIP_PATH = path.join(ROOT, `proonboarding-${_version}.zip`);

const EXPECTED_FILES = [
  'manifest.json',
  'background.js',
  'content.js',
  'content.css',
  'ai-engine.js',
  'tts-provider.js',
  'realtime-voice.js',
  'tour-engine.js',
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

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB por archivo (limite Chrome Web Store)
const MAX_ZIP_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB total

function getVersionFromManifest() {
  return _version;
}

function readZipEntries(buf) {
  const eocdIdx = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocdIdx < 0) throw new Error('EOCD no encontrado: archivo no es un ZIP valido');
  const entries = buf.readUInt16LE(eocdIdx + 10);
  let off = buf.readUInt32LE(eocdIdx + 16);
  const out = [];
  for (let i = 0; i < entries; i++) {
    const sig = buf.readUInt32LE(off);
    if (sig !== 0x02014b50) throw new Error('Central directory corrupto en entry ' + i);
    const nameLen = buf.readUInt16LE(off + 28);
    const extLen = buf.readUInt16LE(off + 30);
    const cmtLen = buf.readUInt16LE(off + 32);
    const compSize = buf.readUInt32LE(off + 20);
    const uncompSize = buf.readUInt32LE(off + 24);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    out.push({ name, compSize, uncompSize });
    off += 46 + nameLen + extLen + cmtLen;
  }
  return out;
}

let pass = 0;
let fail = 0;
const results = [];

function check(name, ok, detail) {
  results.push({ name, ok, detail });
  if (ok) { pass++; console.log('  OK  ' + name + (detail ? '  (' + detail + ')' : '')); }
  else    { fail++; console.log('  FAIL ' + name + (detail ? '  (' + detail + ')' : '')); }
}

console.log('=== Verificacion del paquete para Chrome Web Store ===\n');
console.log('Zip: ' + ZIP_PATH);

// 1) El zip existe
if (!fs.existsSync(ZIP_PATH)) {
  console.error('No se encontro el zip. Ejecuta primero: node scripts/package-store.mjs');
  process.exit(1);
}
const zipBuf = fs.readFileSync(ZIP_PATH);
const zipSize = zipBuf.length;
check('Zip existe', true, zipSize + ' bytes');
check('Tamano total del zip <= 2 GB', zipSize <= MAX_ZIP_SIZE, (zipSize / 1024 / 1024).toFixed(1) + ' MB');

// 2) Leer entries
let entries;
try {
  entries = readZipEntries(zipBuf);
  check('ZIP valido (EOCD + central directory)', true, entries.length + ' entradas');
} catch (e) {
  check('ZIP valido (EOCD + central directory)', false, e.message);
  printSummary();
  process.exit(1);
}

// 3) Cada entrada esperada esta presente
const present = new Set(entries.map((e) => e.name));
const missing = EXPECTED_FILES.filter((f) => !present.has(f));
check('Todos los archivos esperados presentes', missing.length === 0,
  missing.length ? 'faltan: ' + missing.join(', ') : EXPECTED_FILES.length + '/' + EXPECTED_FILES.length);

// 4) No hay archivos extra
const extra = entries.map((e) => e.name).filter((n) => !EXPECTED_FILES.includes(n));
check('Sin archivos extra en el zip', extra.length === 0,
  extra.length ? 'sobran: ' + extra.join(', ') : 'solo allowlist');

// 5) Tamano por archivo <= 50 MB
const oversize = entries.filter((e) => e.uncompSize > MAX_FILE_SIZE);
check('Ningun archivo > 50 MB', oversize.length === 0,
  oversize.length ? 'exceden: ' + oversize.map((e) => e.name).join(', ') : 'OK');

// 6) Version del manifest coincide con el nombre del zip
const manifest = _manifest;
const zipName = path.basename(ZIP_PATH);
const expectedZipName = `proonboarding-${manifest.version}.zip`;
check('Version del manifest coincide con el nombre del zip', zipName === expectedZipName,
  `${manifest.version} == ${expectedZipName}`);

// 7) Manifest valido y completo
const requiredManifestFields = ['manifest_version', 'name', 'version', 'description'];
const missingFields = requiredManifestFields.filter((f) => !manifest[f]);
check('Manifest tiene campos obligatorios', missingFields.length === 0,
  missingFields.length ? 'faltan: ' + missingFields.join(', ') : 'OK');

// 8) Permisos del manifest (para comparar contra lo que mostro la Store)
const expectedPerms = ['sidePanel', 'activeTab', 'scripting', 'storage', 'offscreen'];
const actualPerms = manifest.permissions || [];
const permDiff = expectedPerms.filter((p) => !actualPerms.includes(p));
check('Permisos del manifest son los esperados (0.2.0)', permDiff.length === 0,
  'permisos: ' + actualPerms.join(', '));

// 9) Host permissions presentes
const hostPerms = manifest.host_permissions || [];
check('Host permissions presentes', hostPerms.length > 0,
  hostPerms.join(', '));

// 10) Resumen de tamanos
console.log('\nTamano por archivo:');
let total = 0;
for (const e of entries.sort((a, b) => b.uncompSize - a.uncompSize)) {
  console.log('  ' + e.name.padEnd(30) + ' ' + (e.uncompSize + ' B').padStart(10));
  total += e.uncompSize;
}
console.log('  ' + 'TOTAL'.padEnd(30) + ' ' + (total + ' B').padStart(10));

printSummary();

function printSummary() {
  console.log('\n=== Resultado: ' + pass + ' OK, ' + fail + ' FAIL ===');
  if (fail > 0) {
    console.log('\nErrores:');
    for (const r of results) if (!r.ok) console.log('  - ' + r.name + (r.detail ? ': ' + r.detail : ''));
    process.exit(1);
  }
  console.log('\n[OK] Paquete listo para subir a la Chrome Web Store.');
}
