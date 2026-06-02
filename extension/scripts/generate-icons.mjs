// Genera los 3 iconos PNG (16, 48, 128) usando solo modulos nativos de Node.
// Diseno: cuadrado redondeado con gradiente morado->azul y una "P" blanca centrada.
// Uso: node extension/scripts/generate-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', 'icons');
fs.mkdirSync(OUT, { recursive: true });

// CRC32 estandar
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

// Bitmap 5x7 para la letra "P"
const P_FONT = [
  '11110',
  '10001',
  '10001',
  '10001',
  '11110',
  '10000',
  '10000'
];

function lerp(a, b, t) { return Math.round(a + (b - a) * t); }

function drawIcon(size) {
  const pixels = Buffer.alloc(size * size * 4); // RGBA, transparente por defecto
  const radius = Math.round(size * 0.22);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const maxDist = Math.hypot(cx, cy);

  // 1) Fondo: cuadrado redondeado con gradiente diagonal morado (#7c3aed) -> azul (#2563eb)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // prueba de esquina redondeada
      let dx = 0, dy = 0;
      if (x < radius) dx = radius - x;
      else if (x > size - radius - 1) dx = x - (size - radius - 1);
      if (y < radius) dy = radius - y;
      else if (y > size - radius - 1) dy = y - (size - radius - 1);
      if (dx * dx + dy * dy > radius * radius) continue;
      // gradiente
      const t = (x + y) / (2 * size);
      const r = lerp(0x7c, 0x25, t);
      const g = lerp(0x3a, 0x63, t);
      const b = lerp(0xed, 0xeb, t);
      const i = (y * size + x) * 4;
      pixels[i] = r; pixels[i+1] = g; pixels[i+2] = b; pixels[i+3] = 255;
    }
  }

  // 2) Letra "P" blanca, escala segun tamano
  const scale = Math.max(2, Math.floor(size / 12));
  const glyphW = 5 * scale;
  const glyphH = 7 * scale;
  const startX = Math.round((size - glyphW) / 2);
  const startY = Math.round((size - glyphH) / 2);
  for (let gy = 0; gy < 7; gy++) {
    for (let gx = 0; gx < 5; gx++) {
      if (P_FONT[gy][gx] !== '1') continue;
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const px = startX + gx * scale + sx;
          const py = startY + gy * scale + sy;
          if (px < 0 || px >= size || py < 0 || py >= size) continue;
          const i = (py * size + px) * 4;
          pixels[i] = 255; pixels[i+1] = 255; pixels[i+2] = 255; pixels[i+3] = 255;
        }
      }
    }
  }

  // Construir PNG
  const sig = Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // Filas con filtro None (0)
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0;
    pixels.copy(raw, y * (1 + size * 4) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

for (const sz of [16, 48, 128]) {
  const png = drawIcon(sz);
  const file = path.join(OUT, `icon${sz}.png`);
  fs.writeFileSync(file, png);
  console.log('escrito', file, png.length, 'bytes');
}
