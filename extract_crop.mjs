import { createCanvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';
pdfjs.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/legacy/build/pdf.worker.mjs';
const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g,'');
const svc = fs.readFileSync('src/app/admin/product.service.ts','utf8');
const re=/"id":\s*"([^"]+)"[\s\S]*?"name":\s*"([^"]+)"[\s\S]*?"image":\s*"([^"]+)"/g;
let m; const byName={};
while((m=re.exec(svc))){ const o={id:m[1],name:m[2],image:m[3]}; byName[norm(o.name)]=o; }
const REVIEW='crop_review'; fs.rmSync(REVIEW,{recursive:true,force:true}); fs.mkdirSync(REVIEW,{recursive:true});
const SCALE=2.6;
const data=new Uint8Array(fs.readFileSync('catalog.pdf.pdf'));
const doc=await pdfjs.getDocument({data,disableWorker:true}).promise;
const results=[];
for(let pn=4; pn<=doc.numPages; pn++){
  const page=await doc.getPage(pn);
  const vp=page.getViewport({scale:SCALE});
  const W=Math.ceil(vp.width), H=Math.ceil(vp.height);
  const tc=await page.getTextContent();
  let maxh=0; for(const it of tc.items){const h=Math.abs(it.transform[3]); if(it.str.trim()&&h>maxh)maxh=h;}
  const titleItems=tc.items.filter(it=>it.str.trim()&&Math.abs(it.transform[3])>=maxh*0.9).sort((a,b)=>a.transform[4]-b.transform[4]);
  const title=titleItems.map(it=>it.str).join(' ').replace(/\s+/g,' ').trim();
  const prod=byName[norm(title)];
  if(!prod){ results.push({pn,title,matched:null}); continue; }
  const canvas=createCanvas(W,H); const ctx=canvas.getContext('2d');
  await page.render({canvasContext:ctx,viewport:vp,canvas}).promise;
  const px=ctx.getImageData(0,0,W,H).data;
  // generous text mask (all text)
  const isText=new Uint8Array(W*H); const S=SCALE;
  for(const it of tc.items){ if(!it.str.trim())continue;
    const e=it.transform[4], f=it.transform[5], h=Math.abs(it.transform[3]), w=it.width||h*0.6*it.str.length;
    let dx0=Math.floor(S*e)-3, dx1=Math.ceil(S*(e+w))+3;
    let dyT=Math.floor(H-S*(f+1.15*h))-3, dyB=Math.ceil(H-S*(f-0.35*h))+3;
    dx0=Math.max(0,dx0);dx1=Math.min(W-1,dx1);dyT=Math.max(0,dyT);dyB=Math.min(H-1,dyB);
    for(let y=dyT;y<=dyB;y++){const row=y*W; for(let x=dx0;x<=dx1;x++)isText[row+x]=1;}
  }
  // ROI upper-right (photo zone), above specs bar
  const rx0=Math.floor(W*0.40), rx1=W-2, ry0=Math.floor(H*0.10), ry1=Math.floor(H*0.545);
  const colC=new Int32Array(W), rowC=new Int32Array(H); let total=0;
  for(let y=ry0;y<ry1;y++){const row=y*W; for(let x=rx0;x<rx1;x++){
    if(isText[row+x])continue;
    const i=(row+x)*4; const r=px[i],g=px[i+1],b=px[i+2];
    const mn=Math.min(r,g,b),mx=Math.max(r,g,b);
    if(mn<205 || ((mx-mn)>45 && mx<245)){ colC[x]++; rowC[y]++; total++; }
  }}
  if(total<300){ results.push({pn,title,matched:prod.id,empty:true}); continue; }
  const cT=Math.max(3, Math.max(...colC)*0.04), rT=Math.max(3, Math.max(...rowC)*0.04);
  let x0=-1,x1=-1,y0=-1,y1=-1;
  for(let x=rx0;x<rx1;x++) if(colC[x]>=cT){ if(x0<0)x0=x; x1=x; }
  for(let y=ry0;y<ry1;y++) if(rowC[y]>=rT){ if(y0<0)y0=y; y1=y; }
  if(x0<0||y0<0){ results.push({pn,title,matched:prod.id,empty:true}); continue; }
  const pad=Math.round(W*0.012);
  x0=Math.max(0,x0-pad);y0=Math.max(0,y0-pad);x1=Math.min(W-1,x1+pad);y1=Math.min(H-1,y1+pad);
  const cw=x1-x0+1, ch=y1-y0+1;
  const oc=createCanvas(cw,ch); oc.getContext('2d').drawImage(canvas,x0,y0,cw,ch,0,0,cw,ch);
  fs.writeFileSync(`${REVIEW}/${String(pn).padStart(2,'0')}_${prod.id}.png`, oc.toBuffer('image/png'));
  results.push({pn,title,matched:prod.id,box:`${cw}x${ch}`});
}
console.log('cropped', results.filter(r=>r.matched&&!r.empty).length,'empty',results.filter(r=>r.empty).length);
console.log('UNMATCHED:', results.filter(r=>!r.matched).map(r=>`p${r.pn}:"${r.title}"`).join(', ')||'none');
fs.writeFileSync('crop_results.json',JSON.stringify(results,null,2));
