import { Injectable, signal } from '@angular/core';

export interface Product {
  id: string;
  name: string;
  category: string;
  status: 'In Stock' | 'Low Stock' | 'Out of Stock';
  stock: number;
  price: number;
  previewType: 'panel' | 'street' | 'bulb' | 'curve';
  image?: string;
  description?: string;
}

@Injectable({
  providedIn: 'root'
})
export class ProductService {
  private STORAGE_KEY = 'glaron_products_catalog_v13';

  private defaultProducts: Product[] = [
  {
    "id": "GLR-DELT-3",
    "name": "Delta",
    "category": "Indoor",
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "assets/images/products/GLR-DELT-3.png",
    "description": "TM. Delta. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 18W. 63×61 mm / 82×79 mm / 90×88 mm. 50 mm / 72 mm / 78 mm. 3000k / 4000k / 6500k. Available. 24° / 38° / 38°. > 80. Aluminium. Black / White. N/A. 2 YEARS"
  },
  {
    "id": "GLR-CURV-4",
    "name": "Curve",
    "category": "Indoor",
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "assets/images/products/GLR-CURV-4.png",
    "description": "TM. Curve. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 18W. 70×50 mm / 85×65 mm / 95×75 mm. 65 mm / 80 mm / 90 mm. 3000k / 4000k / 6500k. Available. 24°. >80. Aluminium. BK / WH. RG / GBK / MW / MB. 2 YEARS"
  },
  {
    "id": "GLR-GEM-5",
    "name": "Gem",
    "category": "Indoor",
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "assets/images/products/GLR-GEM-5.png",
    "description": "TM TM. Gem. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 18W. 73×61 mm / 85×67 mm / 93×73 mm. 65 mm / 75 mm / 85 mm. 3000k / 4000k / 6500k. Available. 24° / 38° / 38°. >80. Aluminium. BK / WH. GBK / RG. 2 YEARS"
  },
  {
    "id": "GLR-GLAR-6",
    "name": "Glare",
    "category": "Indoor",
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "assets/images/products/GLR-GLAR-6.png",
    "description": "TM. Glare. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W. 55 × 55 × 60 mm / 55 × 55 × 70 mm. 50 mm. 3000k / 4000k / 6500k. Available. 38°. >80. Aluminium Die-casting. MW / MB / RG / SILVER / GB. N/A. 2 YEARS"
  },
  {
    "id": "GLR-DELT-7",
    "name": "Delta Pro",
    "category": "Indoor",
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "assets/images/products/GLR-DELT-7.png",
    "description": "TM. Delta Pro. 2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 18W. 75 × 60 mm / 85 × 76 mm / 95 × 100 mm. 65 mm / 75 mm / 85 mm. 3000k / 4000k / 6500k. Available. 24° / 38°. >80. Aluminium Die-casting. BK / WH. GBK / RGD / GD / CH"
  },
  {
    "id": "GLR-VOGU-8",
    "name": "Vogue",
    "category": "Indoor",
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "assets/images/products/GLR-VOGU-8.png",
    "description": "TM. Vogue. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W. 42 × 42 × 60 mm / 62 × 62 × 60 mm. 35 mm / 55 mm. 3000k / 4000k / 6500k. Available. 36°. >80. Aluminium Die-casting. MW / MB. N/A. 2 YEARS"
  },
  {
    "id": "GLR-GLON-9",
    "name": "Glon",
    "category": "Indoor",
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "assets/images/products/GLR-GLON-9.png",
    "description": "TM. 2 YEARS. Glon. FOCUSED PERFORMANCE.. PREMIUM FINISH.. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 18W. 63 × 63 × 43 mm / 80 × 80 × 44 mm / 94 × 84 × 51 mm. 55 mm / 75 mm / 85 mm. 3000k / 4000k / 6500k. Available. 38°. N/A. Aluminium Die-casting. MW / MB / RG / SB / ANTIQUE BRASS. N/A"
  },
  {
    "id": "GLR-ELEG-10",
    "name": "Elegance",
    "category": "Indoor",
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "assets/images/products/GLR-ELEG-10.png",
    "description": "TM. Elegance. 2 YEARS. WHERE DESIGN MEETS LIGHT.. WHERE QUALITY LASTS.. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 18W. 68 × 66 mm / 83 × 75 mm / 93 × 85 mm. 60 mm / 75 mm / 85 mm. 3000k / 4000k / 6500k. Available. 24° / 38°. >80. Aluminium Die-casting. White / Black. N/A"
  },
  {
    "id": "GLR-ORBI-11",
    "name": "Orbit",
    "category": "Indoor",
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "assets/images/products/GLR-ORBI-11.png",
    "description": "TM. 2 YEARS. Orbit. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 18W. 63 × 32 mm / 80 × 40 mm / 95 × 40 mm. 60 mm / 75 mm / 85 mm. 3000k / 4000k / 6500k. Available. 24° / 38°. >80. Aluminium Die-casting. White / Black. N/A"
  },
  {
    "id": "GLR-PRIS-12",
    "name": "Prism",
    "category": "Indoor",
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "assets/images/products/GLR-PRIS-12.png",
    "description": "Prism. 2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 18W. 68 × 48 mm / 83 × 55 mm / 93 × 60 mm. 60 mm / 75 mm / 85 mm. 3000k / 4000k / 6500k. Available. 24° / 38°. >80. Aluminium Die-casting. BK / WH. RGD / GBK. TM"
  },
  {
    "id": "GLR-DUO-13",
    "name": "Duo",
    "category": "Indoor",
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "assets/images/products/GLR-DUO-13.png",
    "description": "2 YEARS. TM. Duo. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 2×10W / 2×15W. N/A. 113×55mm / 153×75mm. 3000k / 4000k / 6500k. Available. 36°. >80. Aluminium Die-casting. Black / White. N/A"
  },
  {
    "id": "GLR-DUOR-14",
    "name": "Duo R",
    "category": "Indoor",
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "assets/images/products/GLR-DUOR-14.png",
    "description": "2 YEARS. TM. Duo R. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 2*7W / 2*12W. 68 x 134mm / 85 x 170mm. 55 x 122mm / 75 x 160mm. 3000k / 4000k / 6500k. Available. 36°. >80. Aluminium Die-casting. MW / BK. GBK / RG / WH"
  },
  {
    "id": "GLR-MOVA-15",
    "name": "Movable",
    "category": "Indoor",
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "assets/images/products/GLR-MOVA-15.png",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 18W / 24W / 30W. 85×40 mm / 108×50 mm / 135×80 mm / 150×100 mm. 80 mm / 100 mm / 120 mm / 132 mm. 3000k / 4000k / 6500k. No. 38°/60°. >80. Aluminium. White. N/A. TM. Movable"
  },
  {
    "id": "GLR-PULL-16",
    "name": "Pull Out",
    "category": "Indoor",
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "assets/images/products/GLR-PULL-16.png",
    "description": "2 YEARS. TM. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. Shape. 7W / 12W / 2 x 7W / 2 × 12W. 68 × 48 mm / 83 × 55 mm / 93 × 60 mm. 60 mm / 75 mm / 85 mm. 3000k / 4000k / 6500k. No. 24° / 38°. >80. Aluminium Die-casting. BK / WH. N/A. Round/Square. Pull Out"
  },
  {
    "id": "GLR-LINE-17",
    "name": "Linea",
    "category": "Indoor",
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "assets/images/products/GLR-LINE-17.png",
    "description": "2 YEARS. TM. EVERY SPACE SHINES.. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 6W / 8W / 12W. 68 × 45 × 32 mm / 95 × 45 × 32 mm / 146 × 45 × 32 mm. 58 × 35 mm / 85 × 35 mm / 137 × 35 mm. 3000k / 4000k / 6500k. Available. 38°. >80. Aluminium Die-casting. PKW / BK. MW / MB / RG / GB. Linea"
  },
  {
    "id": "GLR-SPOT-18",
    "name": "Spot",
    "category": "Indoor",
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "assets/images/products/GLR-SPOT-18.png",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 1W / 2W / 3W. N/A. 25 mm / 32 mm / 28 mm. 3000k / 4000k / 6500k. No. N/A. >80. Polycarbonate / Aluminium. WH / BK / RG. N/A. TM. Spot"
  },
  {
    "id": "GLR-DEEP-19",
    "name": "Deep Downlight",
    "category": "Indoor",
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "assets/images/products/GLR-DEEP-19.png",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 12W / 18W / 24W. 120 mm / 155 mm / 175 mm. 110 mm / 145 mm / 170 mm. 3000k / 4000k / 6500k. No. N/A. >80. Aluminium. White / Black. N/A. TM. Deep Downlight"
  },
  {
    "id": "GLR-NEXU-20",
    "name": "Nexus Pro",
    "category": "Indoor",
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "assets/images/products/GLR-NEXU-20.png",
    "description": "2 YEARS. TM. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 18W / 24W. 85×45 mm / 100×48 mm / 130×48 mm. 75 mm / 92 mm / 120 mm /140 mm. 3000k / 4000k / 6500k. Available. N/A. >80. Aluminium. WH / BK. WH/ SB / RG / MB /MW. Nexus Pro"
  },
  {
    "id": "GLR-NEXU-21",
    "name": "Nexus surface",
    "category": "Indoor",
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "assets/images/products/GLR-NEXU-21.png",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 12W / 18W / 24W. 92 × 75 mm / 122 × 75 mm / 142 × 75 mm. N/A. 3000k / 4000k / 6500k. N/A. 120°. >80. Aluminium Die-casting. PKW / BK. WH / SB / RG / MB / MW. TM. Nexus surface"
  },
  {
    "id": "GLR-NOVA-22",
    "name": "Nova",
    "category": "Indoor",
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "assets/images/products/GLR-NOVA-22.png",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 18W / 24W. 51 x 51 x 45 / 80 × 80 × 46 mm / 90 × 90 × 48 mm / 128 × 128 × 50 mm. N/A. 3000k / 4000k / 6500k. N/A. 38°. >80. Aluminium Die-casting. PKW / BK. N/A. TM. Nova"
  },
  {
    "id": "GLR-CONC-23",
    "name": "Concealed",
    "category": "Indoor",
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "assets/images/products/GLR-CONC-23.png",
    "description": "2 YEARS. TM. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W. 108×53 mm. 70 mm. 3000K / 4000K. No. N/A. >80. Polycarbonate. White. N/A. Concealed"
  },
  {
    "id": "GLR-TRAC-24",
    "name": "Tracklight",
    "category": "Indoor",
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "assets/images/products/GLR-TRAC-24.png",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Track channel. 10W / 20W / 30W. 50×125 mm / 65×150 mm / 75×180 mm. N/A. 3000k / 4000k / 6500k. No. N/A. >80. Aluminium. Black / White. 1M / 2M. TM. Tracklight"
  },
  {
    "id": "GLR-TRAC-25",
    "name": "Track Wall",
    "category": "Indoor",
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "assets/images/products/GLR-TRAC-25.png",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 10W / 20W / 30W. 30 × 30 × 110 mm / 50 × 50 × 120 mm / 75 × 75 × 180 mm. N/A. 3000k / 4000k / 6500k. N/A. 38°. >80. Aluminium Die-casting. MW / MB. N/A. TM. Track Wall"
  },
  {
    "id": "GLR-STRE-26",
    "name": "Streak",
    "category": "Indoor",
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "assets/images/products/GLR-STRE-26.png",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W. 35 × 35 × 120 mm. N/A. 3000k / 4000k / 6500k. N/A. 38°. N/A. Aluminium Die-casting. PKW / BK. N/A. TM. Streak"
  },
  {
    "id": "GLR-MOVA-27",
    "name": "Movable Cylinder",
    "category": "Indoor",
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "assets/images/products/GLR-MOVA-27.png",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 24W. 85 × 90 mm / 103 × 120 mm / 165 × 90 mm. 75 mm / 90 mm / 80 × 150 mm. 3000k / 4000k / 6500k. N/A. 38°. >80. Aluminium Die-casting. Matt White / Matt Black. GBK / RG. TM. Movable Cylinder"
  },
  {
    "id": "GLR-CYLI-28",
    "name": "Cylinder",
    "category": "Indoor",
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "assets/images/products/GLR-CYLI-28.png",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 18W. 60×70 mm / 73×85 mm / 87×100 mm. N/A. 3000k / 4000k / 6500k. No. 34°. >80. Aluminium. BK / WH. MB / MW / GBK / RG. TM. Cylinder"
  },
  {
    "id": "GLR-MAGN-29",
    "name": "Magna",
    "category": "Indoor",
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "assets/images/products/GLR-MAGN-29.png",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 10W / 15W. 85 × 85 × 65 mm / 75 × 75 × 70 mm. N/A. 3000k / 4000k / 6500k. N/A. 38°. >80. Aluminium Die-casting. N/A. BRASS GOLD / MESH BLACK. TM. Magna"
  },
  {
    "id": "GLR-STRI-30",
    "name": "Striker",
    "category": "Indoor",
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "assets/images/products/GLR-STRI-30.png",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 5W / 3W. 58×14 mm / 62×18 mm. N/A. 3000k. No. N/A. >80. Metal / Polycarbonate. Black / White. N/A. TM. Striker"
  },
  {
    "id": "GLR-SLIM-31",
    "name": "Slim Panel",
    "category": "Indoor",
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "assets/images/products/GLR-SLIM-31.png",
    "description": "2 YEARS. UNIFORM ILLUMINATION.. EFFORTLESS COMFORT.. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 8W / 15W / 22W. 120 mm / 170 mm / 225 mm. 105 mm / 155 mm / 205 mm. 3000K / 4000K / 6500K. No. 110°. Metal. White. N/A. TM. Slim Panel"
  },
  {
    "id": "GLR-SURF-32",
    "name": "Surface Panel",
    "category": "Indoor",
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "assets/images/products/GLR-SURF-32.png",
    "description": "2 YEARS. WHERE DESIGN MEETS LIGHT.. WHERE QUALITY LASTS.. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 8W / 15W / 22W. 120 mm / 170 mm / 225 mm. N/A. 3000K / 4000K / 6500K. No. 110°. >80. Metal. White. N/A. TM. Surface Panel"
  },
  {
    "id": "GLR-TRIM-33",
    "name": "Trimless Surface",
    "category": "Indoor",
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "assets/images/products/GLR-TRIM-33.png",
    "description": "2 YEARS. TM. MODERN FINISHES.. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 12W / 20W. 120 mm / 150 mm. N/A. 3000K / 4000K / 6500K. No. 180°. >80. Polycarbonate / Metal. White / Black ( Metal ). N/A. Trimless Surface"
  },
  {
    "id": "GLR-TILE-34",
    "name": "Tile",
    "category": "Indoor",
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "assets/images/products/GLR-TILE-34.png",
    "description": "2 YEARS. TM. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 24W / 30W / 40W / 50W. 285 × 285 mm / 285 × 285 mm / 575 × 575 mm / 575 × 575 mm. 300 × 300 mm / 300 × 300 mm / 595 × 595 mm / 595 × 595 mm. 3000K / 4000K / 6500K. N/A. 120°. >80. Metal. White. N/A. Tile"
  },
  {
    "id": "GLR-STRI-35",
    "name": "Strip Light",
    "category": "Indoor",
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "assets/images/products/GLR-STRI-35.png",
    "description": "2 YEARS. BUILT TO LAST.. Wattage. Dimension. Roll Length. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 12V / 24V. 10MM. 5M. 3000K / 4000K / 6500K. N/A. N/A. >80. Pure copper / Aluminium Mix Copper. N/A. N/A. TM. Strip Light"
  },
  {
    "id": "GLR-SMPS-36",
    "name": "SMPS",
    "category": "Indoor",
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "assets/images/products/GLR-SMPS-36.png",
    "description": "2 YEARS. RELIABLE POWER.. CONSISTENT PERFORMANCE.. Wattage. Ampere. Roll length. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 12V / 24V. 3A / 5A / 10A / 16.7A / 25A. N/A. N/A. N/A. N/A. N/A. Aluminium. N/A. N/A. TM. SMPS"
  },
  {
    "id": "GLR-ROPE-37",
    "name": "Rope Light",
    "category": "Indoor",
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "assets/images/products/GLR-ROPE-37.png",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. ~9W/MTR. 11 mm Thickness. N/A. 3000K / 4000K / 6500K / BLUE / GREEN / RED / AMBER / PINK /. ICE BLUE / MULTI. N/A. N/A. >80. PVC. N/A. N/A. TM. Rope Light"
  },
  {
    "id": "GLR-PROF-38",
    "name": "Profile",
    "category": "Indoor",
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "assets/images/products/GLR-PROF-38.png",
    "description": "2 YEARS. MODERN FINISHES.. Variants. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. CONCEALED / SURFACE / CORNER / ROUND. 1M / 2M / CUSTOM. 17mm | 12 mm. N/A. No. N/A. N/A. Aluminium / Silicon. Aluminium Finish / Black / White. N/A. TM. Profile"
  },
  {
    "id": "GLR-MAGN-39",
    "name": "Magnetic",
    "category": "Indoor",
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "assets/images/products/GLR-MAGN-39.png",
    "description": "2 YEARS. TM. Variants. Dimension. Track. CCT (K). Power Supply. Track Dimension. CRI (Ra). Material. Body Color. Fixtures. SURFACE / CONCEALED. 5MM / 10MM / 16MM / 25MM SERIES. 1M / 2M /3M POP & SF. 3000K / 4000K / 6500K. 100W / 200W. L-1000 x W-26 x H-21 / L-2000 x W-26 x H-21 /L-3000 x W-26 x H-21. >80. Aluminium. Black / White. Linear / Profile / Track/ Pendent / Mini Rd/ Sq / Corner / Hose. Magnetic"
  },
  {
    "id": "GLR-LINE-40",
    "name": "Linear Hanging",
    "category": "Indoor",
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "assets/images/products/GLR-LINE-40.png",
    "description": "2 YEARS. TM. Wattage. Dimension. CCT (K). Shapes. Link. CRI (Ra). Material. Body Color. 20W / 30W / 40W / 50W / 70W / 100W. 2ft /3ft /4ft / 6ft /8 Ft. 3000K / 4000K / 6500K / 3 in 1. As Per Choice. Linkable. >80. Aluminium. Black. Linear Hanging"
  },
  {
    "id": "GLR-KTYP-41",
    "name": "K-Type",
    "category": "Outdoor",
    "status": "In Stock",
    "stock": 100,
    "price": 1850,
    "previewType": "street",
    "image": "assets/images/products/GLR-KTYP-41.png",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. IP Rating. 3W / 6W. 75×75×35 mm / 145×75×60 mm. N/A. 3000k. No. N/A. N/A. Die Cast Aluminium. Sand Black. IP65. TM. K-Type"
  },
  {
    "id": "GLR-BALL-42",
    "name": "Ball Light",
    "category": "Outdoor",
    "status": "In Stock",
    "stock": 100,
    "price": 1850,
    "previewType": "street",
    "image": "assets/images/products/GLR-BALL-42.png",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. IP Rating. 2W/ 4W. 65×65×55 mm / 74×74×44 mm. N/A. 3000k / Auto RGBP. No. N/A. >80. Aluminium / Polycarbonate. Black. IP65. TM. Ball Light"
  },
  {
    "id": "GLR-CURV-43",
    "name": "Curve Wall",
    "category": "Outdoor",
    "status": "In Stock",
    "stock": 100,
    "price": 1850,
    "previewType": "street",
    "image": "assets/images/products/GLR-CURV-43.png",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. IP Rating. 2W / 4 W / 6 W. 75×87×38 mm / 90×104×43 mm / 88×161×43 mm. N/A. 3000k. No. N/A. >80. Polycarbonate. Matt Black. IP65. TM. Curve Wall"
  },
  {
    "id": "GLR-CASE-44",
    "name": "Casette",
    "category": "Outdoor",
    "status": "In Stock",
    "stock": 100,
    "price": 1850,
    "previewType": "street",
    "image": "assets/images/products/GLR-CASE-44.png",
    "description": "2 YEARS. TM. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. IP Rating. 6W / 12W. 160*100*25 mm. N/A. 3000k. No. Up / Down. N/A. Die Cast Aluminium. Gloss Black. IP65. Casette"
  },
  {
    "id": "GLR-UPDO-45",
    "name": "Updown Wall",
    "category": "Outdoor",
    "status": "In Stock",
    "stock": 100,
    "price": 1850,
    "previewType": "street",
    "image": "assets/images/products/GLR-UPDO-45.png",
    "description": "2 YEARS. TM. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. IP Rating. 6W / 12W. 80*65*75mm / 155*65*75mm. N/A. 3000k. No. Up / Down. N/A. Die Cast Aluminium. Gloss Black. IP65. Updown Wall"
  },
  {
    "id": "GLR-RUBI-46",
    "name": "Rubik Square",
    "category": "Outdoor",
    "status": "In Stock",
    "stock": 100,
    "price": 1850,
    "previewType": "street",
    "image": "assets/images/products/GLR-RUBI-46.png",
    "description": "2 YEARS. TM. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. IP Rating. 6W. 110*110*85mm. N/A. 3000k. No. N/A. N/A. Acrylic. Black. IP65. Rubik Square"
  },
  {
    "id": "GLR-FOOT-47",
    "name": "Foot Lights",
    "category": "Outdoor",
    "status": "In Stock",
    "stock": 100,
    "price": 1850,
    "previewType": "street",
    "image": "assets/images/products/GLR-FOOT-47.png",
    "description": "2 YEARS. Variants. Dimension. Fixture. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 2M / 4M. 85×85 mm. Wall Concealed / Surface. 3000k. No. N/A. >80. Die Cast Aluminium. Black/White. N/A. TM. Foot Lights"
  },
  {
    "id": "GLR-SPIK-48",
    "name": "Spike",
    "category": "Outdoor",
    "status": "In Stock",
    "stock": 100,
    "price": 1850,
    "previewType": "street",
    "image": "assets/images/products/GLR-SPIK-48.png",
    "description": "2 YEARS. TM. BEAUTIFULLY.. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W. 50×70 mm / 70×80 mm. N/A. WW / WH / GREEN / RED / AMBER. No. Wide / Narrow. >80. Aluminium. Black. N/A. Spike"
  },
  {
    "id": "GLR-WALL-49",
    "name": "Wall Washer",
    "category": "Outdoor",
    "status": "In Stock",
    "stock": 100,
    "price": 1850,
    "previewType": "street",
    "image": "assets/images/products/GLR-WALL-49.png",
    "description": "2 YEARS. TM. Wattage. Dimension. Voltage. CCT (K). Length. Beam Angle. CRI (Ra). Material. Body Color. Rating. 18W / 24W / 36W / 72W. 50*55*500mm / 50*55*990mm. 220V AC / 24V DC. WW / AMBER / GREEN / RED. 1 MTR / 0.5 MTR / CUSTOMISED. 10 Degree. >80. Aluminium. Black / Grey. IP 65. Wall Washer"
  },
  {
    "id": "GLR-INGR-50",
    "name": "Inground",
    "category": "Outdoor",
    "status": "In Stock",
    "stock": 100,
    "price": 1850,
    "previewType": "street",
    "image": "assets/images/products/GLR-INGR-50.png",
    "description": "2 YEARS. TM. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 3W / 6W / 9W / 12W. 65*65*75mm / 80*80*85mm. 32mm. WW. N/A. N/A. >80. Aluminium. Silver Chrome. N/A. Inground"
  },
  {
    "id": "GLR-SWIM-51",
    "name": "Swimming Pool",
    "category": "Outdoor",
    "status": "In Stock",
    "stock": 100,
    "price": 1850,
    "previewType": "street",
    "image": "assets/images/products/GLR-SWIM-51.png",
    "description": "2 YEARS. TM. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 3W / 9W / 12W / 18W. 85mm / 110mm / 135mm / 160mm. 60mm / 85mm / 110mm / 135mm. WW / WH. N/A. N/A. >80. Aluminium. Silver Chrome. N/A. Swimming Pool"
  },
  {
    "id": "GLR-GMFL-52",
    "name": "GM Flood",
    "category": "Outdoor",
    "status": "In Stock",
    "stock": 100,
    "price": 4500,
    "previewType": "street",
    "image": "assets/images/products/GLR-GMFL-52.png",
    "description": "2 YEARS. TM. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. IP Rating. 30W / 50W / 100W / 200W. 185×180×50 mm / 227×218×55 mm / 260×250×70 mm / 318×308×75 mm. N/A. 6500K. N/A. N/A. >80. Aluminium. Grey. IP66. GM Flood"
  },
  {
    "id": "GLR-SLIM-53",
    "name": "Slim Flood",
    "category": "Outdoor",
    "status": "In Stock",
    "stock": 100,
    "price": 4500,
    "previewType": "street",
    "image": "assets/images/products/GLR-SLIM-53.png",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. IP Rating. 50W / 100W. 230*155 mm / 275*185 mm. N/A. 6500K. No. N/A. >80. Aluminum. Grey. IP66. TM. Slim Flood"
  },
  {
    "id": "GLR-HIBA-54",
    "name": "Hi-Bay",
    "category": "Outdoor",
    "status": "In Stock",
    "stock": 100,
    "price": 4500,
    "previewType": "street",
    "image": "assets/images/products/GLR-HIBA-54.png",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. IP Rating. 100W / 150W / 200W. 315 × 145 × 175 mm / 315 × 145 × 175 mm / 377 × 145 × 260 mm. N/A. 6500k. N/A. N/A. >80. Aluminium. Matt Grey. IP66. TM. Hi-Bay"
  },
  {
    "id": "GLR-STRE-55",
    "name": "Street",
    "category": "Outdoor",
    "status": "In Stock",
    "stock": 100,
    "price": 3200,
    "previewType": "street",
    "image": "assets/images/products/GLR-STRE-55.png",
    "description": "2 YEARS. EVERY NIGHT.. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. IP Rating. 24W / 36W / 50W. 275×120×55 mm / 315×135×55 mm / 360×170×55 mm. N/A. 6500K. No. N/A. >80. Aluminium. Grey. IP66. TM. Street"
  },
  {
    "id": "GLR-SOLA-56",
    "name": "Solar Street",
    "category": "Outdoor",
    "status": "In Stock",
    "stock": 100,
    "price": 3200,
    "previewType": "street",
    "image": "assets/images/products/GLR-SOLA-56.png",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. IP Rating. 70W / 120W. 275×120×55 mm / 315×135×55 mm / 360×170×55 mm. N/A. 6500K. No. N/A. >80. Aluminium. Black. IP66. TM. Solar Street"
  },
  {
    "id": "GLR-AURA-57",
    "name": "Aura Max",
    "category": "Outdoor",
    "status": "In Stock",
    "stock": 100,
    "price": 1850,
    "previewType": "street",
    "image": "assets/images/products/GLR-AURA-57.png",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 24W. 258 × 258 × 267 mm. N/A. WW. N/A. N/A. >80. Polycarbonate. Black. N/A. TM. Aura Max"
  },
  {
    "id": "GLR-VIST-58",
    "name": "Vista",
    "category": "Outdoor",
    "status": "In Stock",
    "stock": 100,
    "price": 1850,
    "previewType": "street",
    "image": "assets/images/products/GLR-VIST-58.png",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 20W. 290 x 138 x 270 mm. N/A. WW. No. N/A. >80. Polycarbonate. Grey. N/A. TM. Vista"
  },
  {
    "id": "GLR-CUBE-59",
    "name": "Cubex",
    "category": "Outdoor",
    "status": "In Stock",
    "stock": 100,
    "price": 1850,
    "previewType": "street",
    "image": "assets/images/products/GLR-CUBE-59.png",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 20W. 150×150*150 mm. N/A. WW. No. N/A. >80. Polycarbonate. Black. N/A. TM. Cubex"
  },
  {
    "id": "GLR-CUBE-60",
    "name": "Cube",
    "category": "Outdoor",
    "status": "In Stock",
    "stock": 100,
    "price": 1850,
    "previewType": "street",
    "image": "assets/images/products/GLR-CUBE-60.png",
    "description": "2 YEARS. TM. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 20W. 151 x 151 x 145 mm. N/A. WW. No. N/A. >80. Polycarbonate. Black. N/A. Cube"
  },
  {
    "id": "GLR-MASH-61",
    "name": "Mashal",
    "category": "Outdoor",
    "status": "In Stock",
    "stock": 100,
    "price": 1850,
    "previewType": "street",
    "image": "assets/images/products/GLR-MASH-61.png",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. Holder Based (No LED). 315×145×45 mm. N/A. According to LED bulb. No. N/A. N/A. Polycarbonate. Black. N/A. TM. Mashal"
  },
  {
    "id": "GLR-FREE-62",
    "name": "Freedom",
    "category": "Outdoor",
    "status": "In Stock",
    "stock": 100,
    "price": 1850,
    "previewType": "street",
    "image": "assets/images/products/GLR-FREE-62.png",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 20W. 275×120×55 mm. N/A. 3000k / 6500k. No. N/A. >80. Polycarbonate. Black. N/A. TM. Freedom"
  },
  {
    "id": "GLR-RUBI-63",
    "name": "Rubik",
    "category": "Outdoor",
    "status": "In Stock",
    "stock": 100,
    "price": 1850,
    "previewType": "street",
    "image": "assets/images/products/GLR-RUBI-63.png",
    "description": "2 YEARS. TM. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 12W. 130*130*120mm. N/A. 3000k / 6500k. No. N/A. >80. Aluminium with PC Diffuser. Sand Black. N/A. Rubik"
  },
  {
    "id": "GLR-TEMP-64",
    "name": "Temple",
    "category": "Outdoor",
    "status": "In Stock",
    "stock": 100,
    "price": 1850,
    "previewType": "street",
    "image": "assets/images/products/GLR-TEMP-64.png",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 15W. 200MM / 300MM. 3000k / 6500k. N/A. N/A. >80. Aluminium. Grey. N/A. N/A. TM. Temple"
  },
  {
    "id": "GLR-LEGA-65",
    "name": "Legacy",
    "category": "Outdoor",
    "status": "In Stock",
    "stock": 100,
    "price": 1850,
    "previewType": "street",
    "image": "assets/images/products/GLR-LEGA-65.png",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 15W. 200MM / 300MM. 3000k / 6500k. N/A. N/A. >80. Aluminium. Grey. N/A. N/A. TM. Legacy"
  },
  {
    "id": "GLR-FOUR-66",
    "name": "Four Pillar",
    "category": "Outdoor",
    "status": "In Stock",
    "stock": 100,
    "price": 1850,
    "previewType": "street",
    "image": "assets/images/products/GLR-FOUR-66.png",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 15W. 300 mm / 600 mm / 900 mm. N/A. 3000k / 6500k. N/A. N/A. >80. Alluminium. Grey. N/A. TM. Four Pillar"
  },
  {
    "id": "GLR-SQUA-67",
    "name": "Square",
    "category": "Outdoor",
    "status": "In Stock",
    "stock": 100,
    "price": 1850,
    "previewType": "street",
    "image": "assets/images/products/GLR-SQUA-67.png",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 15W. 300 mm / 600 mm / 900 mm. N/A. 3000k / 6500k. N/A. N/A. >80. Alluminium. Grey. N/A. TM. Square. BEAUTIFULLY."
  },
  {
    "id": "GLR-RING-68",
    "name": "Ring",
    "category": "Outdoor",
    "status": "In Stock",
    "stock": 100,
    "price": 1850,
    "previewType": "street",
    "image": "assets/images/products/GLR-RING-68.png",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 15W. 300 mm / 600 mm / 900 mm. N/A. 3000k / 6500k. N/A. N/A. >80. Alluminium. Grey. N/A. TM. Ring"
  },
  {
    "id": "GLR-ROUN-69",
    "name": "Round",
    "category": "Outdoor",
    "status": "In Stock",
    "stock": 100,
    "price": 1850,
    "previewType": "street",
    "image": "assets/images/products/GLR-ROUN-69.png",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 15W. 300 mm / 600 mm / 900 mm. N/A. 3000k / 6500k. N/A. N/A. >80. Alluminium. Grey. N/A. TM. Round"
  },
  {
    "id": "GLR-OVAL-70",
    "name": "Oval",
    "category": "Outdoor",
    "status": "In Stock",
    "stock": 100,
    "price": 1850,
    "previewType": "street",
    "image": "assets/images/products/GLR-OVAL-70.png",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 15W. 300 mm / 600 mm / 900 mm. N/A. 3000k / 6500k. N/A. N/A. >80. Alluminium. Grey. N/A. TM. Oval"
  }
];

  // Store list of products as a signal
  private productsSignal = signal<Product[]>(this.loadFromStorage());

  private loadFromStorage(): Product[] {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      console.error('Error loading products from localStorage', e);
    }
    this.saveToStorage(this.defaultProducts);
    return this.defaultProducts;
  }

  private saveToStorage(products: Product[]) {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(products));
    } catch (e) {
      console.error('Error saving products to localStorage', e);
    }
  }

  get products(): Product[] {
    return this.productsSignal();
  }

  getProductById(id: string): Product | undefined {
    return this.productsSignal().find(p => p.id === id);
  }

  addProduct(productData: Omit<Product, 'status'>) {
    const status: Product['status'] = productData.stock > 100 
      ? 'In Stock' 
      : (productData.stock > 0 ? 'Low Stock' : 'Out of Stock');
    
    const newProduct: Product = {
      ...productData,
      status
    };

    this.productsSignal.update(products => {
      const newList = [...products, newProduct];
      this.saveToStorage(newList);
      return newList;
    });
  }

  updateProduct(updatedProduct: Product) {
    const status: Product['status'] = updatedProduct.stock > 100 
      ? 'In Stock' 
      : (updatedProduct.stock > 0 ? 'Low Stock' : 'Out of Stock');
    
    const product = { ...updatedProduct, status };

    this.productsSignal.update(products => {
      const newList = products.map(p => p.id === product.id ? product : p);
      this.saveToStorage(newList);
      return newList;
    });
  }

  deleteProduct(id: string) {
    this.productsSignal.update(products => {
      const newList = products.filter(p => p.id !== id);
      this.saveToStorage(newList);
      return newList;
    });
  }
}
