// ────────────────────────────────────────────────────────────────────────────
// Build the admin PWA's own icon set.
//
// The console and the dealer portal install as two separate apps, so they must
// not land on a home screen as two identical tiles. These icons keep the Glaron
// mark but sit it on the console's dark navy with an amber base bar, which is
// what tells the two apart at a glance.
//
// Output → admin-app/src/assets/admin/ (copied to /assets/admin by the `admin`
// build target in angular.json). Re-run after changing the source mark:
//     node scripts/gen-admin-icons.mjs
// ────────────────────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { decodePng, encodePng, resize, composite } from './png-lite.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const markFile = path.join(root, 'src', 'assets', 'glaron-mark.png');
const outDir = path.join(root, 'admin-app', 'src', 'assets', 'admin');

// Console palette: the navy from the manifest/theme, with the Glaron amber.
const BG_TOP = [0x12, 0x1B, 0x33];
const BG_BOTTOM = [0x07, 0x0C, 0x18];
const ACCENT = [0xF5, 0x94, 0x1D];

const mark = decodePng(fs.readFileSync(markFile));

// A 5×7 bitmap of just the letters this icon needs. Hand-encoded because there
// is no font rasteriser here, and "ADMIN" under the mark is the clearest way to
// tell the two installed apps apart.
const GLYPHS = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
};

/** Draw `text` in ACCENT at `scale` pixels per glyph cell, centred on `cx`. */
function drawText(canvas, text, cx, top, scale) {
  const letters = text.split('');
  const cellW = 5, cellH = 7, gap = 1;
  const totalW = (letters.length * cellW + (letters.length - 1) * gap) * scale;
  let penX = Math.round(cx - totalW / 2);

  for (const ch of letters) {
    const rows = GLYPHS[ch];
    if (!rows) continue;
    for (let ry = 0; ry < cellH; ry++) {
      for (let rx = 0; rx < cellW; rx++) {
        if (rows[ry][rx] !== '1') continue;
        for (let py = 0; py < scale; py++) {
          for (let px = 0; px < scale; px++) {
            const x = penX + rx * scale + px;
            const y = top + ry * scale + py;
            if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) continue;
            const i = (y * canvas.width + x) * 4;
            canvas.data[i] = ACCENT[0];
            canvas.data[i + 1] = ACCENT[1];
            canvas.data[i + 2] = ACCENT[2];
            canvas.data[i + 3] = 255;
          }
        }
      }
    }
    penX += (cellW + gap) * scale;
  }
}

/**
 * One icon.
 *
 * `markScale` is the mark's width as a fraction of the canvas. Maskable icons
 * get a smaller one so nothing important falls outside the safe zone when a
 * launcher crops the tile to a circle.
 */
function render(size, { markScale = 0.58, accent = true } = {}) {
  const data = Buffer.alloc(size * size * 4);

  // Vertical gradient background.
  for (let y = 0; y < size; y++) {
    const t = y / (size - 1);
    const r = Math.round(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t);
    const g = Math.round(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t);
    const b = Math.round(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t);
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }

  const canvas = { width: size, height: size, data };

  // The Glaron mark, centred and lifted to leave room for the wordmark.
  const markSize = Math.round(size * markScale);
  const scaled = resize(mark, markSize, markSize);
  const offset = accent ? Math.round(size * 0.055) : 0;
  composite(canvas, scaled, Math.round((size - markSize) / 2), Math.round((size - markSize) / 2) - offset);

  // "ADMIN" under the mark — the cue that separates this tile from the dealer
  // app's on a home screen. Below ~120px the letters stop being legible, so
  // those sizes get a plain amber bar instead.
  if (accent) {
    const textScale = Math.round((size * 0.44) / 29); // 29 = 5 glyphs + gaps
    if (textScale >= 3) {
      drawText(canvas, 'ADMIN', size / 2, Math.round(size * 0.76), textScale);
    } else {
      const barW = Math.round(size * 0.34);
      const barH = Math.max(2, Math.round(size * 0.05));
      const barX = Math.round((size - barW) / 2);
      const barY = Math.round(size * 0.78);
      for (let y = barY; y < barY + barH; y++) {
        for (let x = barX; x < barX + barW; x++) {
          const i = (y * size + x) * 4;
          data[i] = ACCENT[0]; data[i + 1] = ACCENT[1]; data[i + 2] = ACCENT[2]; data[i + 3] = 255;
        }
      }
    }
  }

  return canvas;
}

fs.mkdirSync(outDir, { recursive: true });

const targets = [
  ['icon-512.png', render(512)],
  ['icon-192.png', render(192)],
  // Launchers crop maskable icons hard, so keep the artwork well inside.
  ['icon-maskable-512.png', render(512, { markScale: 0.46, accent: false })],
  ['apple-touch-icon.png', render(180)],
  ['favicon.png', render(96)],
];

for (const [name, img] of targets) {
  fs.writeFileSync(path.join(outDir, name), encodePng(img));
  console.log(`gen-admin-icons: wrote assets/admin/${name} (${img.width}×${img.height})`);
}
