const fs = require('fs');

let content = fs.readFileSync('src/app/admin/product.service.ts', 'utf8');

// Replace "image": "assets/images/products/ with "image": "/assets/images/products/
content = content.replace(/\"image\":\s*\"assets\/images\/products\//g, '"image": "/assets/images/products/');

fs.writeFileSync('src/app/admin/product.service.ts', content, 'utf8');
console.log('Updated image paths in product.service.ts with leading slash /');
