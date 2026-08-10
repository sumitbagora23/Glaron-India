const fs = require('fs');

const manifest = JSON.parse(fs.readFileSync('pdf_images_manifest.json', 'utf8'));

// Filter out templates/logos/watermarks
const isSystemAsset = (img) => {
  if (img.bytes === 54879) return true; // 800x800 watermark logo
  if (img.bytes === 192383) return true; // 565x800 background
  if (img.bytes === 401449) return true; // 566x800 background
  if (img.bytes === 17661) return true; // 240x137 warranty card
  if (img.bytes === 10688) return true; // 160x160 logo
  if (img.bytes === 49543) return true; // 1460x182 banner
  if (img.bytes === 63821) return true; // 406x486 logo
  if (img.bytes === 19967) return true; // 320x320 logo
  if (img.height === 800 && (img.width === 565 || img.width === 566)) return true;
  if (img.width === 1460) return true;
  if (img.width < 40 || img.height < 40) return true;
  return false;
};

const pageMap = {};
manifest.forEach(img => {
  if (!isSystemAsset(img)) {
    if (!pageMap[img.page]) pageMap[img.page] = [];
    pageMap[img.page].push(img);
  }
});

console.log('Pages with non-system candidate product images:');
for (let p = 3; p <= 70; p++) {
  const list = pageMap[p] || [];
  console.log(`Page ${p}: ${list.length} images -> ${list.map(i => `${i.filename}`).join(', ')}`);
}
