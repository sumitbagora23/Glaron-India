import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';
pdfjs.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/legacy/build/pdf.worker.mjs';
const OPS = pdfjs.OPS;

function mul(m, n){ // 2x3 affine multiply (pdf matrices)
  return [
    m[0]*n[0]+m[2]*n[1], m[1]*n[0]+m[3]*n[1],
    m[0]*n[2]+m[2]*n[3], m[1]*n[2]+m[3]*n[3],
    m[0]*n[4]+m[2]*n[5]+m[4], m[1]*n[4]+m[3]*n[5]+m[5]
  ];
}

const data = new Uint8Array(fs.readFileSync('catalog.pdf.pdf'));
const doc = await pdfjs.getDocument({ data, disableWorker: true }).promise;
const pages = (process.argv[2]||'4,5,7,57,58').split(',').map(Number);

for (const pn of pages) {
  const page = await doc.getPage(pn);
  const vp = page.getViewport({ scale: 1 });
  // title: largest font text
  const tc = await page.getTextContent();
  let title='', best=0;
  for (const it of tc.items){
    const h = Math.abs(it.transform[3]);
    if (h>best && it.str.trim()){ best=h; title=it.str.trim(); }
  }
  // image bboxes via operator list + CTM tracking
  const ol = await page.getOperatorList();
  let ctm=[1,0,0,1,0,0]; const stack=[]; const imgs=[];
  for (let i=0;i<ol.fnArray.length;i++){
    const fn=ol.fnArray[i], args=ol.argsArray[i];
    if (fn===OPS.save) stack.push(ctm.slice());
    else if (fn===OPS.restore) ctm=stack.pop()||[1,0,0,1,0,0];
    else if (fn===OPS.transform) ctm=mul(ctm,args);
    else if (fn===OPS.paintImageXObject||fn===OPS.paintJpegXObject||fn===OPS.paintImageMaskXObject||fn===OPS.paintInlineImage){
      // unit square corners
      const xs=[0,1,1,0].map((u,k)=>{const v=[0,0,1,1][k]; return ctm[0]*u+ctm[2]*v+ctm[4];});
      const ys=[0,0,1,1].map((v,k)=>{const u=[0,1,1,0][k]; return ctm[1]*u+ctm[3]*v+ctm[5];});
      const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
      imgs.push({w:+(x1-x0).toFixed(0),h:+(y1-y0).toFixed(0),x:+x0.toFixed(0),y:+y0.toFixed(0),area:+((x1-x0)*(y1-y0)).toFixed(0)});
    }
  }
  imgs.sort((a,b)=>b.area-a.area);
  console.log(`p${pn} "${title}" pageWH=${vp.width|0}x${vp.height|0} imgs=${imgs.length}`);
  imgs.slice(0,4).forEach(m=>console.log(`   area=${m.area} ${m.w}x${m.h} @(${m.x},${m.y})`));
}
