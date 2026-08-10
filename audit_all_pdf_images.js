const { PDFParse } = require('pdf-parse');
const fs = require('fs');
const path = require('path');

const data = new Uint8Array(fs.readFileSync('catalog.pdf.pdf'));
const parser = new PDFParse(data);

const rawText = fs.readFileSync('catalog_extracted.txt', 'utf8');
const pages = rawText.split(/-- \d+ of 72 --/g);

const productNames = {
  3: 'Delta',
  4: 'Curve',
  5: 'Gem',
  6: 'Glare',
  7: 'Delta Pro',
  8: 'Vogue',
  9: 'Glon',
  10: 'Elegance',
  11: 'Orbit',
  12: 'Prism',
  13: 'Duo',
  14: 'Duo R',
  15: 'Movable',
  16: 'Pull Out',
  17: 'Linea',
  18: 'Spot',
  19: 'Deep Downlight',
  20: 'Nexus Pro',
  21: 'Nexus surface',
  22: 'Nova',
  23: 'Concealed',
  24: 'Tracklight',
  25: 'Track Wall',
  26: 'Streak',
  27: 'Movable Cylinder',
  28: 'Cylinder',
  29: 'Magna',
  30: 'Striker',
  31: 'Slim Panel',
  32: 'Surface Panel',
  33: 'Trimless Surface',
  34: 'Tile',
  35: 'Strip Light',
  36: 'SMPS',
  37: 'Rope Light',
  38: 'Profile',
  39: 'Magnetic',
  40: 'Linear Hanging',
  41: 'K-Type',
  42: 'Ball Light',
  43: 'Curve Wall',
  44: 'Casette',
  45: 'Updown Wall',
  46: 'Rubik Square',
  47: 'Foot Lights',
  48: 'Spike',
  49: 'Wall Washer',
  50: 'Inground',
  51: 'Swimming Pool',
  52: 'GM Flood',
  53: 'Slim Flood',
  54: 'Hi-Bay',
  55: 'Street',
  56: 'Solar Street',
  57: 'Aura Max',
  58: 'Vista',
  59: 'Cubex',
  60: 'Cube',
  61: 'Mashal',
  62: 'Freedom',
  63: 'Rubik',
  64: 'Temple',
  65: 'Legacy',
  66: 'Four Pillar',
  67: 'Square',
  68: 'Ring',
  69: 'Round',
  70: 'Oval'
};

const artDir = 'C:\\Users\\DELL\\.gemini\\antigravity\\brain\\eb12d900-ed92-4eb5-87f1-b2f568972240\\pdf_all_images';
if (fs.existsSync(artDir)) {
  fs.rmSync(artDir, { recursive: true, force: true });
}
fs.mkdirSync(artDir, { recursive: true });

async function run() {
  console.log('Auditing every single embedded image across pages 3 to 70...');
  
  const manifest = [];
  
  for (let s = 3; s <= 70; s++) {
    const name = productNames[s] || `P${s}`;
    try {
      const res = await parser.getImage({ first: s, last: s, imageBuffer: true });
      const pData = res.pages.find(p => p.pageNumber === s);
      if (pData && pData.images) {
        pData.images.forEach((img, idx) => {
          const fn = `page_${s}_${name.replace(/[^a-zA-Z0-9]/g, '')}_img_${idx}_${img.width}x${img.height}_${img.data.length}b.png`;
          const fp = path.join(artDir, fn);
          fs.writeFileSync(fp, img.data);
          manifest.push({
            page: s,
            product: name,
            idx,
            width: img.width,
            height: img.height,
            bytes: img.data.length,
            filename: fn
          });
        });
      }
    } catch (err) {
      console.error(`Error page ${s}:`, err);
    }
  }
  
  fs.writeFileSync('pdf_images_manifest.json', JSON.stringify(manifest, null, 2));
  console.log(`Audited ${manifest.length} total images across pages 3 to 70!`);
}

run();
