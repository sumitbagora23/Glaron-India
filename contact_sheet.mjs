import { createCanvas, loadImage } from '@napi-rs/canvas';
import fs from 'fs';
const files=fs.readdirSync('crop_review').filter(f=>f.endsWith('.png')).sort();
const cols=7, cell=250, pad=6, labelH=22;
const rows=Math.ceil(files.length/cols);
const W=cols*cell, H=rows*(cell+labelH);
const cv=createCanvas(W,H); const ctx=cv.getContext('2d');
ctx.fillStyle='#eee'; ctx.fillRect(0,0,W,H);
for(let i=0;i<files.length;i++){
  const cx=(i%cols)*cell, cy=Math.floor(i/cols)*(cell+labelH);
  ctx.fillStyle='#fff'; ctx.fillRect(cx+1,cy+1,cell-2,cell-2);
  const img=await loadImage('crop_review/'+files[i]);
  const box=cell-pad*2;
  const s=Math.min(box/img.width, box/img.height);
  const dw=img.width*s, dh=img.height*s;
  ctx.drawImage(img, cx+pad+(box-dw)/2, cy+pad+(box-dh)/2, dw, dh);
  ctx.fillStyle='#000'; ctx.font='12px sans-serif';
  ctx.fillText(files[i].replace('.png','').slice(0,30), cx+4, cy+cell+15);
}
fs.writeFileSync('scratch_contact.png', cv.toBuffer('image/png'));
console.log('sheet', W+'x'+H, files.length,'items');
