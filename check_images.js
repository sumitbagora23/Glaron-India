const fs = require('fs');
const path = require('path');

const content = fs.readFileSync('src/app/admin/product.service.ts', 'utf8');
const matches = content.match(/assets\/images\/products\/[^\"]+/g);

if (matches) {
  console.log('Total product image paths in product.service.ts:', matches.length);
  let missing = 0;
  matches.forEach(imgPath => {
    const srcPath = path.join('src', imgPath);
    if (!fs.existsSync(srcPath)) {
      console.log('MISSING in src:', srcPath);
      missing++;
    }
  });
  console.log('Missing images in src count:', missing);
} else {
  console.log('No matches found');
}
