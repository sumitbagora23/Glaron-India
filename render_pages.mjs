import { createCanvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';

pdfjs.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/legacy/build/pdf.worker.mjs';

const OUT = process.argv[2] || 'scratch_render';
const pages = (process.argv[3] || '4').split(',').map(Number);
const SCALE = Number(process.argv[4] || 2);
fs.mkdirSync(OUT, { recursive: true });

const data = new Uint8Array(fs.readFileSync('catalog.pdf.pdf'));
const doc = await pdfjs.getDocument({ data, disableWorker: true }).promise;
console.log('pages:', doc.numPages);

for (const pn of pages) {
  const page = await doc.getPage(pn);
  const vp = page.getViewport({ scale: SCALE });
  const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
  const out = `${OUT}/page_${pn}.png`;
  fs.writeFileSync(out, canvas.toBuffer('image/png'));
  console.log('wrote', out, canvas.width+'x'+canvas.height);
}
