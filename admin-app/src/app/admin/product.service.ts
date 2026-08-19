import { Injectable, signal, inject } from '@angular/core';
import { Firestore, collection, doc, setDoc, deleteDoc, onSnapshot } from '@angular/fire/firestore';

export interface ProductVariant {
  model?: string;
  wattage?: string;
  type?: string;
  dimension?: string;
  cutout?: string;
  colorSize?: string;
  bodyColour?: string;
  packing?: string;
  price?: number;
  pricePerMtr?: number;
  // The shades THIS option is sold in, when they differ from the product's.
  // Left out when the option is sold in whatever the product is sold in, so an
  // untouched variant keeps following `Product.lightColours` below. A variant
  // that carries ["No Colour"] is one option in the range with no shade to
  // choose, even though its siblings have one.
  lightColours?: string[];
  // What one shade costs on THIS option, when it is not the option's own price
  // ({ "Warm White": 325 }). Same rule as `Product.lightColourPrice`: it is the
  // price of that colour, not a surcharge. A colour with no entry here falls
  // back to the product's price for it, then to the option's own price.
  lightColourPrice?: { [colour: string]: number };
}

export interface Product {
  id: string;
  name: string;
  // Legacy single-category string, kept as a joined display value (e.g. "Panel, Street").
  category: string;
  // Canonical multi-category list. A product can belong to several categories.
  categories?: string[];
  // Set once the catalogue categories below have been restored onto the stored
  // product. Until it is set the catalogue assignment wins; afterwards an
  // admin's own edit sticks, so re-assigning categories by hand still works.
  categoryV2?: boolean;
  // Set once the 1 July 2026 price list has been applied to the stored product.
  // The seed below only fills in a product that has no options at all, so a
  // document seeded before that sheet keeps the old packing counts, gate-light
  // dimensions and headline price forever without this one-time refresh.
  priceList2026?: boolean;
  status: 'In Stock' | 'Low Stock' | 'Out of Stock';
  stock: number;
  price: number;
  previewType: 'panel' | 'street' | 'bulb' | 'curve';
  image?: string;
  description?: string;
  // Light colours this product can be ordered in ("Warm White", "Cool White",
  // ...). Picked by the admin on the product form; the catalogue cards show
  // them behind each wattage / dimension tab.
  lightColours?: string[];
  // What one shade costs, when it is not the option's own price
  // ({ "Warm White": 325 }). This is the price of that colour, not a
  // surcharge on top of it: the card and the cart show exactly this number.
  // A colour with no entry is sold at the option's own price, so this stays
  // empty unless a shade is genuinely priced differently.
  lightColourPrice?: { [colour: string]: number };
  // The housing finishes this product is sold in ("Black", "White",
  // "BK/GBK"). Typed free-hand on the product form. A body colour NEVER moves
  // the price — that is the whole difference between it and a light colour —
  // but it does go on the line, so black and white are quoted separately. Left
  // empty on a product that has never been edited, in which case the finishes
  // are read off the variants' imported `bodyColour` text instead. See
  // orderableBodyColours() in body-colours.ts.
  bodyColours?: string[];
  variants?: ProductVariant[];
}

@Injectable({
  providedIn: 'root'
})
export class ProductService {
  private STORAGE_KEY = 'glaron_products_catalog_v13';
  private firestore = inject(Firestore, { optional: true });

  private defaultProducts: Product[] = [
  {
    "id": "GLR-DELT-3",
    "name": "Delta",
    "category": "COB",
    "categories": ["COB"],
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "/assets/images/products/GLR-DELT-3.webp",
    "description": "TM. Delta. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 18W. 63×61 mm / 82×79 mm / 90×88 mm. 50 mm / 72 mm / 78 mm. 3000k / 4000k / 6500k. Available. 24° / 38° / 38°. > 80. Aluminium. Black / White. N/A. 2 YEARS",
    "variants": [
      {
        "model": "CB DELTA",
        "wattage": "7W",
        "dimension": "63*61",
        "cutout": "50",
        "bodyColour": "WHITE | BLACK",
        "packing": "40",
        "price": 580
      },
      {
        "model": "CB DELTA",
        "wattage": "12W",
        "dimension": "82*79",
        "cutout": "72",
        "bodyColour": "WHITE | BLACK",
        "packing": "40",
        "price": 690
      },
      {
        "model": "CB DELTA",
        "wattage": "18W",
        "dimension": "90*88",
        "cutout": "78",
        "bodyColour": "WHITE | BLACK",
        "packing": "20",
        "price": 930
      }
    ]
  },
  {
    "id": "GLR-CURV-4",
    "name": "Curve",
    "category": "COB",
    "categories": ["COB"],
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "/assets/images/products/GLR-CURV-4.webp",
    "description": "TM. Curve. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 18W. 70×50 mm / 85×65 mm / 95×75 mm. 65 mm / 80 mm / 90 mm. 3000k / 4000k / 6500k. Available. 24°. >80. Aluminium. BK / WH. RG / GBK / MW / MB. 2 YEARS",
    "variants": [
      {
        "model": "CB CURVE",
        "wattage": "7W",
        "dimension": "70*50",
        "cutout": "65",
        "bodyColour": "BK/WH + RG | GBK | MW | MB",
        "packing": "40",
        "price": 580
      },
      {
        "model": "CB CURVE",
        "wattage": "12W",
        "dimension": "85*65",
        "cutout": "80",
        "bodyColour": "BK/WH + RG | GBK | MW | MB",
        "packing": "40",
        "price": 720
      },
      {
        "model": "CB CURVE",
        "wattage": "18W",
        "dimension": "95*75",
        "cutout": "90",
        "bodyColour": "BK/WH + RG | GBK | MW | MB",
        "packing": "20",
        "price": 1030
      }
    ]
  },
  {
    "id": "GLR-GEM-5",
    "name": "Gem",
    "category": "COB",
    "categories": ["COB"],
    "status": "In Stock",
    "stock": 100,
    "price": 670,
    "previewType": "panel",
    "image": "/assets/images/products/GLR-GEM-5.webp",
    "description": "TM TM. Gem. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 18W. 73×61 mm / 85×67 mm / 93×73 mm. 65 mm / 75 mm / 85 mm. 3000k / 4000k / 6500k. Available. 24° / 38° / 38°. >80. Aluminium. BK / WH. GBK / RG. 2 YEARS",
    "variants": [
      {
        "model": "CB GEM",
        "wattage": "7W",
        "dimension": "73*61",
        "cutout": "65",
        "bodyColour": "BK + GBK | WH + RG",
        "packing": "40",
        "price": 670
      },
      {
        "model": "CB GEM",
        "wattage": "12W",
        "dimension": "85*67",
        "cutout": "75",
        "bodyColour": "BK + GBK | WH + RG",
        "packing": "40",
        "price": 820
      },
      {
        "model": "CB GEM",
        "wattage": "18W",
        "dimension": "93*73",
        "cutout": "85",
        "bodyColour": "BK + GBK | WH + RG",
        "packing": "20",
        "price": 1150
      }
    ]
  },
  {
    "id": "GLR-GLAR-6",
    "name": "Glare",
    "category": "COB",
    "categories": ["COB"],
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "/assets/images/products/GLR-GLAR-6.webp",
    "description": "TM. Glare. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W. 55 × 55 × 60 mm / 55 × 55 × 70 mm. 50 mm. 3000k / 4000k / 6500k. Available. 38°. >80. Aluminium Die-casting. MW / MB / RG / SILVER / GB. N/A. 2 YEARS",
    "variants": [
      {
        "model": "Glare",
        "wattage": "DimensionW",
        "price": 580
      }
    ]
  },
  {
    "id": "GLR-DELT-7",
    "name": "Delta Pro",
    "category": "COB",
    "categories": ["COB"],
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "/assets/images/products/GLR-DELT-7.webp",
    "description": "TM. Delta Pro. 2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 18W. 75 × 60 mm / 85 × 76 mm / 95 × 100 mm. 65 mm / 75 mm / 85 mm. 3000k / 4000k / 6500k. Available. 24° / 38°. >80. Aluminium Die-casting. BK / WH. GBK / RGD / GD / CH",
    "variants": [
      {
        "model": "CB DELTA",
        "wattage": "7W",
        "dimension": "63*61",
        "cutout": "50",
        "bodyColour": "WHITE | BLACK",
        "packing": "40",
        "price": 580
      },
      {
        "model": "CB DELTA",
        "wattage": "12W",
        "dimension": "82*79",
        "cutout": "72",
        "bodyColour": "WHITE | BLACK",
        "packing": "40",
        "price": 690
      },
      {
        "model": "CB DELTA",
        "wattage": "18W",
        "dimension": "90*88",
        "cutout": "78",
        "bodyColour": "WHITE | BLACK",
        "packing": "20",
        "price": 930
      }
    ]
  },
  {
    "id": "GLR-VOGU-8",
    "name": "Vogue",
    "category": "COB",
    "categories": ["COB"],
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "/assets/images/products/GLR-VOGU-8.webp",
    "description": "TM. Vogue. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W. 42 × 42 × 60 mm / 62 × 62 × 60 mm. 35 mm / 55 mm. 3000k / 4000k / 6500k. Available. 36°. >80. Aluminium Die-casting. MW / MB. N/A. 2 YEARS",
    "variants": [
      {
        "model": "Vogue",
        "wattage": "DimensionW",
        "price": 580
      }
    ]
  },
  {
    "id": "GLR-GLON-9",
    "name": "Glon",
    "category": "COB",
    "categories": ["COB"],
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "/assets/images/products/GLR-GLON-9.webp",
    "description": "TM. 2 YEARS. Glon. FOCUSED PERFORMANCE.. PREMIUM FINISH.. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 18W. 63 × 63 × 43 mm / 80 × 80 × 44 mm / 94 × 84 × 51 mm. 55 mm / 75 mm / 85 mm. 3000k / 4000k / 6500k. Available. 38°. N/A. Aluminium Die-casting. MW / MB / RG / SB / ANTIQUE BRASS. N/A",
    "variants": [
      {
        "model": "Glon",
        "wattage": "DimensionW",
        "price": 580
      }
    ]
  },
  {
    "id": "GLR-ELEG-10",
    "name": "Elegance",
    "category": "COB",
    "categories": ["COB"],
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "/assets/images/products/GLR-ELEG-10.webp",
    "description": "TM. Elegance. 2 YEARS. WHERE DESIGN MEETS LIGHT.. WHERE QUALITY LASTS.. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 18W. 68 × 66 mm / 83 × 75 mm / 93 × 85 mm. 60 mm / 75 mm / 85 mm. 3000k / 4000k / 6500k. Available. 24° / 38°. >80. Aluminium Die-casting. White / Black. N/A",
    "variants": [
      {
        "model": "Elegance",
        "wattage": "DimensionW",
        "price": 580
      }
    ]
  },
  {
    "id": "GLR-ORBI-11",
    "name": "Orbit",
    "category": "COB",
    "categories": ["COB"],
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "/assets/images/products/GLR-ORBI-11.webp",
    "description": "TM. 2 YEARS. Orbit. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 18W. 63 × 32 mm / 80 × 40 mm / 95 × 40 mm. 60 mm / 75 mm / 85 mm. 3000k / 4000k / 6500k. Available. 24° / 38°. >80. Aluminium Die-casting. White / Black. N/A",
    "variants": [
      {
        "model": "Orbit",
        "wattage": "DimensionW",
        "price": 580
      }
    ]
  },
  {
    "id": "GLR-PRIS-12",
    "name": "Prism",
    "category": "COB",
    "categories": ["COB"],
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "/assets/images/products/GLR-PRIS-12.webp",
    "description": "Prism. 2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 18W. 68 × 48 mm / 83 × 55 mm / 93 × 60 mm. 60 mm / 75 mm / 85 mm. 3000k / 4000k / 6500k. Available. 24° / 38°. >80. Aluminium Die-casting. BK / WH. RGD / GBK. TM",
    "variants": [
      {
        "model": "Prism",
        "wattage": "DimensionW",
        "price": 580
      }
    ]
  },
  {
    "id": "GLR-DUO-13",
    "name": "Duo",
    "category": "COB",
    "categories": ["COB"],
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "/assets/images/products/GLR-DUO-13.webp",
    "description": "2 YEARS. TM. Duo. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 2×10W / 2×15W. N/A. 113×55mm / 153×75mm. 3000k / 4000k / 6500k. Available. 36°. >80. Aluminium Die-casting. Black / White. N/A",
    "variants": [
      {
        "model": "Duo",
        "wattage": "DimensionW",
        "price": 580
      }
    ]
  },
  {
    "id": "GLR-DUOR-14",
    "name": "Duo R",
    "category": "COB",
    "categories": ["COB"],
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "/assets/images/products/GLR-DUOR-14.webp",
    "description": "2 YEARS. TM. Duo R. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 2*7W / 2*12W. 68 x 134mm / 85 x 170mm. 55 x 122mm / 75 x 160mm. 3000k / 4000k / 6500k. Available. 36°. >80. Aluminium Die-casting. MW / BK. GBK / RG / WH",
    "variants": [
      {
        "model": "Duo R",
        "wattage": "DimensionW",
        "price": 580
      }
    ]
  },
  {
    "id": "GLR-MOVA-15",
    "name": "Movable",
    "category": "COB",
    "categories": ["COB"],
    "status": "In Stock",
    "stock": 100,
    "price": 665,
    "previewType": "panel",
    "image": "/assets/images/products/GLR-MOVA-15.webp",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 18W / 24W / 30W. 85×40 mm / 108×50 mm / 135×80 mm / 150×100 mm. 80 mm / 100 mm / 120 mm / 132 mm. 3000k / 4000k / 6500k. No. 38°/60°. >80. Aluminium. White. N/A. TM. Movable",
    "variants": [
      {
        "model": "MOVABLE COB WHITE",
        "wattage": "7W",
        "dimension": "85*40",
        "cutout": "80",
        "packing": "40",
        "price": 665
      },
      {
        "model": "MOVABLE COB WHITE",
        "wattage": "12W",
        "dimension": "85*40",
        "cutout": "80",
        "packing": "20",
        "price": 750
      },
      {
        "model": "MOVABLE COB WHITE",
        "wattage": "18W",
        "dimension": "108*50",
        "cutout": "100",
        "packing": "20",
        "price": 1080
      },
      {
        "model": "MOVABLE COB WHITE",
        "wattage": "24W",
        "dimension": "135*80",
        "cutout": "120",
        "packing": "10",
        "price": 1520
      },
      {
        "model": "MOVABLE COB WHITE",
        "wattage": "30W",
        "dimension": "150*100",
        "cutout": "132",
        "packing": "10",
        "price": 1995
      }
    ]
  },
  {
    "id": "GLR-PULL-16",
    "name": "Pull Out",
    "category": "COB",
    "categories": ["COB"],
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "/assets/images/products/GLR-PULL-16.webp",
    "description": "2 YEARS. TM. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. Shape. 7W / 12W / 2 x 7W / 2 × 12W. 68 × 48 mm / 83 × 55 mm / 93 × 60 mm. 60 mm / 75 mm / 85 mm. 3000k / 4000k / 6500k. No. 24° / 38°. >80. Aluminium Die-casting. BK / WH. N/A. Round/Square. Pull Out",
    "variants": [
      {
        "model": "Pull Out",
        "wattage": "DimensionW",
        "bodyColour": "Reflector",
        "price": 580
      }
    ]
  },
  {
    "id": "GLR-LINE-17",
    "name": "Linea",
    "category": "COB",
    "categories": ["COB"],
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "/assets/images/products/GLR-LINE-17.webp",
    "description": "2 YEARS. TM. EVERY SPACE SHINES.. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 6W / 8W / 12W. 68 × 45 × 32 mm / 95 × 45 × 32 mm / 146 × 45 × 32 mm. 58 × 35 mm / 85 × 35 mm / 137 × 35 mm. 3000k / 4000k / 6500k. Available. 38°. >80. Aluminium Die-casting. PKW / BK. MW / MB / RG / GB. Linea",
    "variants": [
      {
        "model": "Linea",
        "wattage": "DimensionW",
        "price": 580
      }
    ]
  },
  {
    "id": "GLR-SPOT-18",
    "name": "Spot",
    "category": "COB",
    "categories": ["COB"],
    "status": "In Stock",
    "stock": 100,
    "price": 110,
    "previewType": "panel",
    "image": "/assets/images/products/GLR-SPOT-18.webp",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 1W / 2W / 3W. N/A. 25 mm / 32 mm / 28 mm. 3000k / 4000k / 6500k. No. N/A. >80. Polycarbonate / Aluminium. WH / BK / RG. N/A. TM. Spot",
    "variants": [
      {
        "model": "METAL SPOT",
        "type": "3W",
        "cutout": "28",
        "bodyColour": "BLACK | WHITE | RGD",
        "packing": "100",
        "price": 280
      },
      {
        "model": "PC BUTTON",
        "type": "1W",
        "cutout": "25",
        "bodyColour": "WHITE",
        "packing": "100",
        "price": 110
      },
      {
        "model": "PC BUTTON",
        "type": "2W",
        "cutout": "32",
        "bodyColour": "WHITE",
        "packing": "100",
        "price": 110
      }
    ]
  },
  {
    "id": "GLR-DEEP-19",
    "name": "Deep Downlight",
    "category": "Down Light",
    "categories": ["Down Light"],
    "status": "In Stock",
    "stock": 100,
    "price": 710,
    "previewType": "panel",
    "image": "/assets/images/products/GLR-DEEP-19.webp",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 12W / 18W / 24W. 120 mm / 155 mm / 175 mm. 110 mm / 145 mm / 170 mm. 3000k / 4000k / 6500k. No. N/A. >80. Aluminium. White / Black. N/A. TM. Deep Downlight",
    "variants": [
      {
        "model": "DEEP DOWNLIGHT",
        "wattage": "12W",
        "dimension": "120",
        "cutout": "115-110",
        "packing": "40",
        "price": 710
      },
      {
        "model": "DEEP DOWNLIGHT",
        "wattage": "18W",
        "dimension": "155",
        "cutout": "145-145",
        "packing": "20",
        "price": 920
      },
      {
        "model": "DEEP DOWNLIGHT",
        "wattage": "24W",
        "dimension": "175",
        "cutout": "165-170",
        "packing": "20",
        "price": 1200
      }
    ]
  },
  {
    "id": "GLR-NEXU-20",
    "name": "Nexus Pro",
    "category": "Down Light",
    "categories": ["Down Light"],
    "status": "In Stock",
    "stock": 100,
    "price": 850,
    "previewType": "panel",
    "image": "/assets/images/products/GLR-NEXU-20.webp",
    "description": "2 YEARS. TM. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 18W / 24W. 85×45 mm / 100×48 mm / 130×48 mm. 75 mm / 92 mm / 120 mm /140 mm. 3000k / 4000k / 6500k. Available. N/A. >80. Aluminium. WH / BK. WH/ SB / RG / MB /MW. Nexus Pro",
    "variants": [
      {
        "model": "NEXUS PRO",
        "wattage": "7W",
        "dimension": "85*45",
        "cutout": "75",
        "bodyColour": "WH/BK + WH/SB/RG",
        "packing": "40",
        "price": 850
      },
      {
        "model": "NEXUS PRO",
        "wattage": "12W",
        "dimension": "100*48",
        "cutout": "92",
        "bodyColour": "WH/BK + WH/SB/RG",
        "packing": "40",
        "price": 1150
      },
      {
        "model": "NEXUS PRO",
        "wattage": "18W",
        "dimension": "130*48",
        "cutout": "120",
        "bodyColour": "WH/BK + WH/SB/RG",
        "packing": "20",
        "price": 1450
      }
    ]
  },
  {
    "id": "GLR-NEXU-21",
    "name": "Nexus surface",
    "category": "Surface",
    "categories": ["Surface"],
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "/assets/images/products/GLR-NEXU-21.webp",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 12W / 18W / 24W. 92 × 75 mm / 122 × 75 mm / 142 × 75 mm. N/A. 3000k / 4000k / 6500k. N/A. 120°. >80. Aluminium Die-casting. PKW / BK. WH / SB / RG / MB / MW. TM. Nexus surface",
    "variants": [
      {
        "model": "Nexus surface",
        "wattage": "DimensionW",
        "price": 580
      }
    ]
  },
  {
    "id": "GLR-NOVA-22",
    "name": "Nova",
    "category": "Surface",
    "categories": ["Surface"],
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "/assets/images/products/GLR-NOVA-22.webp",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 18W / 24W. 51 x 51 x 45 / 80 × 80 × 46 mm / 90 × 90 × 48 mm / 128 × 128 × 50 mm. N/A. 3000k / 4000k / 6500k. N/A. 38°. >80. Aluminium Die-casting. PKW / BK. N/A. TM. Nova",
    "variants": [
      {
        "model": "NOVA FLOOD (DRIVER) CW",
        "wattage": "50W",
        "dimension": "216*186*43",
        "packing": "20",
        "price": 1720
      },
      {
        "model": "NOVA FLOOD (DRIVER) CW",
        "wattage": "100W",
        "dimension": "277*266*40",
        "packing": "10",
        "price": 2860
      }
    ]
  },
  {
    "id": "GLR-CONC-23",
    "name": "Concealed",
    "category": "Concealed",
    "categories": ["Concealed"],
    "status": "In Stock",
    "stock": 100,
    "price": 140,
    "previewType": "panel",
    "image": "/assets/images/products/GLR-CONC-23.webp",
    "description": "2 YEARS. TM. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W. 108×53 mm. 70 mm. 3000K / 4000K. No. N/A. >80. Polycarbonate. White. N/A. Concealed",
    "variants": [
      {
        "model": "LUX CONCEALED",
        "wattage": "7W",
        "dimension": "108*53",
        "cutout": "70",
        "colorSize": "WW | CW",
        "packing": "100",
        "price": 340
      },
      {
        "model": "PC CONCEALED",
        "wattage": "7W",
        "dimension": "110*110",
        "cutout": "70",
        "colorSize": "WW / NW / WH",
        "packing": "200",
        "price": 140
      },
      {
        "model": "PC CONCEALED",
        "wattage": "7W",
        "dimension": "110*110",
        "cutout": "70",
        "colorSize": "R/G/B/P",
        "packing": "200",
        "price": 150
      },
      {
        "model": "PC CONCEALED",
        "wattage": "7W",
        "dimension": "110*110",
        "cutout": "70",
        "colorSize": "3in1 WW / NW / WH",
        "packing": "200",
        "price": 180
      }
    ]
  },
  {
    "id": "GLR-TRAC-24",
    "name": "Tracklight",
    "category": "Track Light",
    "categories": ["Track Light"],
    "status": "In Stock",
    "stock": 100,
    "price": 210,
    "previewType": "panel",
    "image": "/assets/images/products/GLR-TRAC-24.webp",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Track channel. 10W / 20W / 30W. 50×125 mm / 65×150 mm / 75×180 mm. N/A. 3000k / 4000k / 6500k. No. N/A. >80. Aluminium. Black / White. 1M / 2M. TM. Tracklight",
    "variants": [
      {
        "model": "CB TRACKLIGHT",
        "wattage": "10W",
        "dimension": "50 x 125",
        "bodyColour": "WHITE | BLACK",
        "packing": "20",
        "price": 980
      },
      {
        "model": "CB TRACKLIGHT",
        "wattage": "20W",
        "dimension": "65x150",
        "bodyColour": "WHITE | BLACK",
        "packing": "20",
        "price": 1380
      },
      {
        "model": "CB TRACKLIGHT",
        "wattage": "30W",
        "dimension": "75x180",
        "bodyColour": "WHITE | BLACK",
        "packing": "20",
        "price": 1700
      },
      {
        "model": "TRACK - PC",
        "wattage": "1M | 2M",
        "bodyColour": "WHITE | BLACK",
        "packing": "100",
        "price": 210
      },
      {
        "model": "TRACK - METAL",
        "wattage": "1M | 2M",
        "bodyColour": "WHITE | BLACK",
        "packing": "50",
        "price": 350
      }
    ]
  },
  {
    "id": "GLR-TRAC-25",
    "name": "Track Wall",
    "category": "Track Light",
    "categories": ["Track Light"],
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "/assets/images/products/GLR-TRAC-25.webp",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 10W / 20W / 30W. 30 × 30 × 110 mm / 50 × 50 × 120 mm / 75 × 75 × 180 mm. N/A. 3000k / 4000k / 6500k. N/A. 38°. >80. Aluminium Die-casting. MW / MB. N/A. TM. Track Wall",
    "variants": [
      {
        "model": "Track Wall",
        "wattage": "DimensionW",
        "price": 580
      }
    ]
  },
  {
    "id": "GLR-STRE-26",
    "name": "Streak",
    "category": "Cylinder",
    "categories": ["Cylinder"],
    "status": "In Stock",
    "stock": 100,
    "price": 1050,
    "previewType": "panel",
    "image": "/assets/images/products/GLR-STRE-26.webp",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W. 35 × 35 × 120 mm. N/A. 3000k / 4000k / 6500k. N/A. 38°. N/A. Aluminium Die-casting. PKW / BK. N/A. TM. Streak",
    "variants": [
      {
        "model": "LEAF STREET (DRIVER) CW",
        "wattage": "24W",
        "dimension": "275*120*55",
        "packing": "30",
        "price": 1050
      },
      {
        "model": "LEAF STREET (DRIVER) CW",
        "wattage": "36W",
        "dimension": "315*135*55",
        "packing": "25",
        "price": 1420
      },
      {
        "model": "LEAF STREET (DRIVER) CW",
        "wattage": "50W",
        "dimension": "360*170*55",
        "packing": "20",
        "price": 1950
      }
    ]
  },
  {
    "id": "GLR-MOVA-27",
    "name": "Movable Cylinder",
    "category": "Cylinder",
    "categories": ["Cylinder"],
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "/assets/images/products/GLR-MOVA-27.webp",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 24W. 85 × 90 mm / 103 × 120 mm / 165 × 90 mm. 75 mm / 90 mm / 80 × 150 mm. 3000k / 4000k / 6500k. N/A. 38°. >80. Aluminium Die-casting. Matt White / Matt Black. GBK / RG. TM. Movable Cylinder",
    "variants": [
      {
        "model": "Movable Cylinder",
        "wattage": "DimensionW",
        "price": 580
      }
    ]
  },
  {
    "id": "GLR-CYLI-28",
    "name": "Cylinder",
    "category": "Cylinder",
    "categories": ["Cylinder"],
    "status": "In Stock",
    "stock": 100,
    "price": 740,
    "previewType": "panel",
    "image": "/assets/images/products/GLR-CYLI-28.webp",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 18W. 60×70 mm / 73×85 mm / 87×100 mm. N/A. 3000k / 4000k / 6500k. No. 34°. >80. Aluminium. BK / WH. MB / MW / GBK / RG. TM. Cylinder",
    "variants": [
      {
        "model": "CB CYLINDER",
        "wattage": "7W",
        "dimension": "60*70",
        "bodyColour": "BK/WH + GBK/RG",
        "packing": "40",
        "price": 740
      },
      {
        "model": "CB CYLINDER",
        "wattage": "12W",
        "dimension": "73*85",
        "bodyColour": "BK/WH + GBK/RG",
        "packing": "40",
        "price": 960
      },
      {
        "model": "CB CYLINDER",
        "wattage": "18W",
        "dimension": "87*100",
        "bodyColour": "BK/WH + GBK/RG",
        "packing": "20",
        "price": 1420
      }
    ]
  },
  {
    "id": "GLR-MAGN-29",
    "name": "Magna",
    "category": "Surface",
    "categories": ["Surface"],
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "/assets/images/products/GLR-MAGN-29.webp",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 10W / 15W. 85 × 85 × 65 mm / 75 × 75 × 70 mm. N/A. 3000k / 4000k / 6500k. N/A. 38°. >80. Aluminium Die-casting. N/A. BRASS GOLD / MESH BLACK. TM. Magna",
    "variants": [
      {
        "model": "Magna",
        "wattage": "DimensionW",
        "price": 580
      }
    ]
  },
  {
    "id": "GLR-STRI-30",
    "name": "Striker",
    "category": "Striker",
    "categories": ["Striker"],
    "status": "In Stock",
    "stock": 100,
    "price": 106,
    "previewType": "panel",
    "image": "/assets/images/products/GLR-STRI-30.webp",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 5W / 3W. 58×14 mm / 62×18 mm. N/A. 3000k. No. N/A. >80. Metal / Polycarbonate. Black / White. N/A. TM. Striker",
    "variants": [
      {
        "model": "ECO STRIP",
        "type": "240LED-12V",
        "colorSize": "WW, NW, WH",
        "packing": "500 METER",
        "pricePerMtr": 106
      },
      {
        "model": "PURE COPPER",
        "type": "240LED-12V",
        "colorSize": "WW, NW, WH",
        "packing": "500 METER",
        "pricePerMtr": 150
      }
    ]
  },
  {
    "id": "GLR-SLIM-31",
    "name": "Slim Panel",
    "category": "Panel",
    "categories": ["Panel"],
    "status": "In Stock",
    "stock": 100,
    "price": 350,
    "previewType": "panel",
    "image": "/assets/images/products/GLR-SLIM-31.webp",
    "description": "2 YEARS. UNIFORM ILLUMINATION.. EFFORTLESS COMFORT.. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 8W / 15W / 22W. 120 mm / 170 mm / 225 mm. 105 mm / 155 mm / 205 mm. 3000K / 4000K / 6500K. No. 110°. Metal. White. N/A. TM. Slim Panel",
    "variants": [
      {
        "model": "SLIM PANEL METAL",
        "wattage": "8W",
        "dimension": "120",
        "cutout": "105-105",
        "packing": "20",
        "price": 350
      },
      {
        "model": "SLIM PANEL METAL",
        "wattage": "15W",
        "dimension": "170",
        "cutout": "155-155",
        "packing": "20",
        "price": 530
      },
      {
        "model": "SLIM PANEL METAL",
        "wattage": "22W",
        "dimension": "225",
        "cutout": "205-205",
        "packing": "20",
        "price": 750
      }
    ]
  },
  {
    "id": "GLR-SURF-32",
    "name": "Surface Panel",
    "category": "Panel, Surface",
    "categories": ["Panel", "Surface"],
    "status": "In Stock",
    "stock": 100,
    "price": 480,
    "previewType": "panel",
    "image": "/assets/images/products/GLR-SURF-32.webp",
    "description": "2 YEARS. WHERE DESIGN MEETS LIGHT.. WHERE QUALITY LASTS.. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 8W / 15W / 22W. 120 mm / 170 mm / 225 mm. N/A. 3000K / 4000K / 6500K. No. 110°. >80. Metal. White. N/A. TM. Surface Panel",
    "variants": [
      {
        "model": "SURFACE PANEL METAL",
        "wattage": "8W",
        "dimension": "120",
        "cutout": "-",
        "packing": "20",
        "price": 480
      },
      {
        "model": "SURFACE PANEL METAL",
        "wattage": "15W",
        "dimension": "170",
        "cutout": "-",
        "packing": "20",
        "price": 720
      },
      {
        "model": "SURFACE PANEL METAL",
        "wattage": "22W",
        "dimension": "225",
        "cutout": "-",
        "packing": "20",
        "price": 970
      }
    ]
  },
  {
    "id": "GLR-TRIM-33",
    "name": "Trimless Surface",
    "category": "Surface",
    "categories": ["Surface"],
    "status": "In Stock",
    "stock": 100,
    "price": 430,
    "previewType": "panel",
    "image": "/assets/images/products/GLR-TRIM-33.webp",
    "description": "2 YEARS. TM. MODERN FINISHES.. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 12W / 20W. 120 mm / 150 mm. N/A. 3000K / 4000K / 6500K. No. 180°. >80. Polycarbonate / Metal. White / Black ( Metal ). N/A. Trimless Surface",
    "variants": [
      {
        "model": "TRIMLESS SURFACE (PC)",
        "wattage": "12W",
        "dimension": "120",
        "packing": "20",
        "price": 430
      },
      {
        "model": "TRIMLESS SURFACE (PC)",
        "wattage": "20W",
        "dimension": "150",
        "packing": "20",
        "price": 560
      }
    ]
  },
  {
    "id": "GLR-TILE-34",
    "name": "Tile",
    "category": "Panel",
    "categories": ["Panel"],
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "/assets/images/products/GLR-TILE-34.webp",
    "description": "2 YEARS. TM. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 24W / 30W / 40W / 50W. 285 × 285 mm / 285 × 285 mm / 575 × 575 mm / 575 × 575 mm. 300 × 300 mm / 300 × 300 mm / 595 × 595 mm / 595 × 595 mm. 3000K / 4000K / 6500K. N/A. 120°. >80. Metal. White. N/A. Tile",
    "variants": [
      {
        "model": "PC PANEL",
        "wattage": "8W",
        "dimension": "120",
        "cutout": "100-100",
        "packing": "40",
        "price": 320
      },
      {
        "model": "PC PANEL",
        "wattage": "15W",
        "dimension": "175",
        "cutout": "150-150",
        "packing": "40",
        "price": 490
      },
      {
        "model": "PC PANEL",
        "wattage": "22W",
        "dimension": "220",
        "cutout": "200-200",
        "packing": "20",
        "price": 720
      }
    ]
  },
  {
    "id": "GLR-STRI-35",
    "name": "Strip Light",
    "category": "Rope & Striped Light",
    "categories": ["Rope & Striped Light"],
    "status": "In Stock",
    "stock": 100,
    "price": 120,
    "previewType": "panel",
    "image": "/assets/images/products/GLR-STRI-35.webp",
    "description": "2 YEARS. BUILT TO LAST.. Wattage. Dimension. Roll Length. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 12V / 24V. 10MM. 5M. 3000K / 4000K / 6500K. N/A. N/A. >80. Pure copper / Aluminium Mix Copper. N/A. N/A. TM. Strip Light",
    "variants": [
      {
        "model": "STRIKER WW",
        "type": "METAL(IP 65)",
        "dimension": "58*14",
        "bodyColour": "BLACK",
        "packing": "200",
        "price": 260
      },
      {
        "model": "STRIKER WW",
        "type": "PC",
        "dimension": "62*18",
        "bodyColour": "WHITE | BLACK",
        "packing": "200",
        "price": 120
      }
    ]
  },
  {
    "id": "GLR-SMPS-36",
    "name": "SMPS",
    "category": "Rope & Striped Light",
    "categories": ["Rope & Striped Light"],
    "status": "In Stock",
    "stock": 100,
    "price": 370,
    "previewType": "panel",
    "image": "/assets/images/products/GLR-SMPS-36.webp",
    "description": "2 YEARS. RELIABLE POWER.. CONSISTENT PERFORMANCE.. Wattage. Ampere. Roll length. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 12V / 24V. 3A / 5A / 10A / 16.7A / 25A. N/A. N/A. N/A. N/A. N/A. Aluminium. N/A. N/A. TM. SMPS",
    "variants": [
      {
        "model": "ULTRA SMPS",
        "type": "12V/3A",
        "dimension": "105*32*23",
        "packing": "50",
        "price": 370
      },
      {
        "model": "ULTRA SMPS",
        "type": "12V/5A",
        "dimension": "130*32*23",
        "packing": "50",
        "price": 485
      },
      {
        "model": "ULTRA SMPS",
        "type": "12V/10A",
        "dimension": "138*50*23",
        "packing": "50",
        "price": 630
      },
      {
        "model": "ULTRA SMPS",
        "type": "12V/16.7A",
        "dimension": "178*50*23",
        "packing": "50",
        "price": 900
      },
      {
        "model": "ULTRA SMPS",
        "type": "12V/25A",
        "dimension": "204*50*23",
        "packing": "50",
        "price": 1100
      }
    ]
  },
  {
    "id": "GLR-ROPE-37",
    "name": "Rope Light",
    "category": "Rope & Striped Light",
    "categories": ["Rope & Striped Light"],
    "status": "In Stock",
    "stock": 100,
    "price": 104,
    "previewType": "panel",
    "image": "/assets/images/products/GLR-ROPE-37.webp",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. ~9W/MTR. 11 mm Thickness. N/A. 3000K / 4000K / 6500K / BLUE / GREEN / RED / AMBER / PINK /. ICE BLUE / MULTI. N/A. N/A. >80. PVC. N/A. N/A. TM. Rope Light",
    "variants": [
      {
        "model": "MELLO ROPE",
        "type": "2835-120LED",
        "colorSize": "WW, NW, WH",
        "packing": "200 METER",
        "pricePerMtr": 104
      },
      {
        "model": "MELLO ROPE",
        "type": "2835-120LED",
        "colorSize": "BLUE, GREEN, RED, AMBER, PINK, ICE BLUE",
        "packing": "200 METER",
        "pricePerMtr": 108
      },
      {
        "model": "MELLO ROPE",
        "type": "2835-120LED",
        "colorSize": "MULTI",
        "packing": "200 METER",
        "pricePerMtr": 120
      },
      {
        "model": "ROPE CORD",
        "colorSize": "REGULAR",
        "packing": "100",
        "price": 120
      },
      {
        "model": "ROPE CORD",
        "colorSize": "MULTI CONTROLLER(6 in 1)",
        "packing": "100",
        "price": 170
      }
    ]
  },
  {
    "id": "GLR-PROF-38",
    "name": "Profile",
    "category": "Rope & Striped Light",
    "categories": ["Rope & Striped Light"],
    "status": "In Stock",
    "stock": 100,
    "price": 140,
    "previewType": "panel",
    "image": "/assets/images/products/GLR-PROF-38.webp",
    "description": "2 YEARS. MODERN FINISHES.. Variants. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. CONCEALED / SURFACE / CORNER / ROUND. 1M / 2M / CUSTOM. 17mm | 12 mm. N/A. No. N/A. N/A. Aluminium / Silicon. Aluminium Finish / Black / White. N/A. TM. Profile",
    "variants": [
      {
        "model": "ALUMINIUM PROFILE",
        "type": "80 GM (CONCEALED)",
        "dimension": "17*7 MM",
        "cutout": "2M",
        "packing": "200 MTR",
        "pricePerMtr": 150
      },
      {
        "model": "ALUMINIUM PROFILE",
        "type": "60 GM (CONCEALED)",
        "dimension": "12*7 MM",
        "cutout": "2M",
        "packing": "200 MTR",
        "pricePerMtr": 140
      }
    ]
  },
  {
    "id": "GLR-MAGN-39",
    "name": "Magnetic",
    "category": "Track Light",
    "categories": ["Track Light"],
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "/assets/images/products/GLR-MAGN-39.webp",
    "description": "2 YEARS. TM. Variants. Dimension. Track. CCT (K). Power Supply. Track Dimension. CRI (Ra). Material. Body Color. Fixtures. SURFACE / CONCEALED. 5MM / 10MM / 16MM / 25MM SERIES. 1M / 2M /3M POP & SF. 3000K / 4000K / 6500K. 100W / 200W. L-1000 x W-26 x H-21 / L-2000 x W-26 x H-21 /L-3000 x W-26 x H-21. >80. Aluminium. Black / White. Linear / Profile / Track/ Pendent / Mini Rd/ Sq / Corner / Hose. Magnetic",
    "variants": [
      {
        "model": "Magnetic",
        "wattage": "100W",
        "bodyColour": "Fixtures",
        "price": 580
      },
      {
        "model": "Magnetic",
        "wattage": "200W",
        "bodyColour": "Fixtures",
        "price": 725
      }
    ]
  },
  {
    "id": "GLR-LINE-40",
    "name": "Linear Hanging",
    "category": "Surface",
    "categories": ["Surface"],
    "status": "In Stock",
    "stock": 100,
    "price": 580,
    "previewType": "panel",
    "image": "/assets/images/products/GLR-LINE-40.webp",
    "description": "2 YEARS. TM. Wattage. Dimension. CCT (K). Shapes. Link. CRI (Ra). Material. Body Color. 20W / 30W / 40W / 50W / 70W / 100W. 2ft /3ft /4ft / 6ft /8 Ft. 3000K / 4000K / 6500K / 3 in 1. As Per Choice. Linkable. >80. Aluminium. Black. Linear Hanging",
    "variants": [
      {
        "model": "Linear Hanging",
        "wattage": "DimensionW",
        "price": 580
      }
    ]
  },
  {
    "id": "GLR-KTYP-41",
    "name": "K-Type",
    "category": "Wall Light",
    "categories": ["Wall Light"],
    "status": "In Stock",
    "stock": 100,
    "price": 650,
    "previewType": "street",
    "image": "/assets/images/products/GLR-KTYP-41.webp",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. IP Rating. 3W / 6W. 75×75×35 mm / 145×75×60 mm. N/A. 3000k. No. N/A. N/A. Die Cast Aluminium. Sand Black. IP65. TM. K-Type",
    "variants": [
      {
        "model": "K-TYPE WW",
        "wattage": "3W",
        "dimension": "75*75*35",
        "bodyColour": "SAND BLACK",
        "packing": "20",
        "price": 650
      },
      {
        "model": "K-TYPE WW",
        "wattage": "6W",
        "dimension": "145*75*60",
        "bodyColour": "SAND BLACK",
        "packing": "20",
        "price": 760
      }
    ]
  },
  {
    "id": "GLR-BALL-42",
    "name": "Ball Light",
    "category": "Wall Light",
    "categories": ["Wall Light"],
    "status": "In Stock",
    "stock": 100,
    "price": 380,
    "previewType": "street",
    "image": "/assets/images/products/GLR-BALL-42.webp",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. IP Rating. 2W/ 4W. 65×65×55 mm / 74×74×44 mm. N/A. 3000k / Auto RGBP. No. N/A. >80. Aluminium / Polycarbonate. Black. IP65. TM. Ball Light",
    "variants": [
      {
        "model": "BALL LIGHT WW",
        "type": "2 WAY",
        "dimension": "65*65*55",
        "bodyColour": "BLACK",
        "packing": "20",
        "price": 670
      },
      {
        "model": "BALL LIGHT WW",
        "type": "4 WAY",
        "dimension": "65*65*55",
        "bodyColour": "BLACK",
        "packing": "20",
        "price": 680
      },
      {
        "model": "BALL LIGHT WW",
        "type": "4 WAY PC",
        "dimension": "74*74*44",
        "bodyColour": "BLACK",
        "packing": "20",
        "price": 380
      },
      {
        "model": "BALL LIGHT WW",
        "type": "4WAY AUTO RGBP",
        "dimension": "74*74*44",
        "bodyColour": "BLACK",
        "packing": "20",
        "price": 620
      }
    ]
  },
  {
    "id": "GLR-CURV-43",
    "name": "Curve Wall",
    "category": "Wall Light",
    "categories": ["Wall Light"],
    "status": "In Stock",
    "stock": 100,
    "price": 360,
    "previewType": "street",
    "image": "/assets/images/products/GLR-CURV-43.webp",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. IP Rating. 2W / 4 W / 6 W. 75×87×38 mm / 90×104×43 mm / 88×161×43 mm. N/A. 3000k. No. N/A. >80. Polycarbonate. Matt Black. IP65. TM. Curve Wall",
    "variants": [
      {
        "model": "CURVE (POLYCARBONATE)",
        "type": "2 WAY",
        "dimension": "75*87*38",
        "colorSize": "WW",
        "packing": "100",
        "price": 360
      },
      {
        "model": "CURVE (POLYCARBONATE)",
        "type": "4 WAY",
        "dimension": "90*104*43",
        "colorSize": "WW",
        "packing": "100",
        "price": 440
      },
      {
        "model": "CURVE (POLYCARBONATE)",
        "type": "6 WAY",
        "dimension": "88*161*43",
        "colorSize": "WW",
        "packing": "50",
        "price": 620
      }
    ]
  },
  {
    "id": "GLR-CASE-44",
    "name": "Casette",
    "category": "Wall Light",
    "categories": ["Wall Light"],
    "status": "In Stock",
    "stock": 100,
    "price": 1850,
    "previewType": "street",
    "image": "/assets/images/products/GLR-CASE-44.webp",
    "description": "2 YEARS. TM. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. IP Rating. 6W / 12W. 160*100*25 mm. N/A. 3000k. No. Up / Down. N/A. Die Cast Aluminium. Gloss Black. IP65. Casette",
    "variants": [
      {
        "model": "Casette",
        "wattage": "DimensionW",
        "price": 1850
      }
    ]
  },
  {
    "id": "GLR-UPDO-45",
    "name": "Updown Wall",
    "category": "Wall Light",
    "categories": ["Wall Light"],
    "status": "In Stock",
    "stock": 100,
    "price": 1850,
    "previewType": "street",
    "image": "/assets/images/products/GLR-UPDO-45.webp",
    "description": "2 YEARS. TM. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. IP Rating. 6W / 12W. 80*65*75mm / 155*65*75mm. N/A. 3000k. No. Up / Down. N/A. Die Cast Aluminium. Gloss Black. IP65. Updown Wall",
    "variants": [
      {
        "model": "Updown Wall",
        "wattage": "DimensionW",
        "price": 1850
      }
    ]
  },
  {
    "id": "GLR-RUBI-46",
    "name": "Rubik Square",
    "category": "Wall Light",
    "categories": ["Wall Light"],
    "status": "In Stock",
    "stock": 100,
    "price": 1850,
    "previewType": "street",
    "image": "/assets/images/products/GLR-RUBI-46.webp",
    "description": "2 YEARS. TM. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. IP Rating. 6W. 110*110*85mm. N/A. 3000k. No. N/A. N/A. Acrylic. Black. IP65. Rubik Square",
    "variants": [
      {
        "model": "Rubik Square",
        "wattage": "DimensionW",
        "price": 1850
      }
    ]
  },
  {
    "id": "GLR-FOOT-47",
    "name": "Foot Lights",
    "category": "Foot Light",
    "categories": ["Foot Light"],
    "status": "In Stock",
    "stock": 100,
    "price": 570,
    "previewType": "street",
    "image": "/assets/images/products/GLR-FOOT-47.webp",
    "description": "2 YEARS. Variants. Dimension. Fixture. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 2M / 4M. 85×85 mm. Wall Concealed / Surface. 3000k. No. N/A. >80. Die Cast Aluminium. Black/White. N/A. TM. Foot Lights",
    "variants": [
      {
        "model": "FOOT LIGHT WW",
        "wattage": "4W",
        "dimension": "85*85",
        "bodyColour": "BLACK | WHITE",
        "packing": "100",
        "price": 570
      }
    ]
  },
  {
    "id": "GLR-SPIK-48",
    "name": "Spike",
    "category": "Spike",
    "categories": ["Spike"],
    "status": "In Stock",
    "stock": 100,
    "price": 700,
    "previewType": "street",
    "image": "/assets/images/products/GLR-SPIK-48.webp",
    "description": "2 YEARS. TM. BEAUTIFULLY.. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W. 50×70 mm / 70×80 mm. N/A. WW / WH / GREEN / RED / AMBER. No. Wide / Narrow. >80. Aluminium. Black. N/A. Spike",
    "variants": [
      {
        "model": "SPIKE LIGHT",
        "wattage": "7W",
        "dimension": "50*70",
        "packing": "50",
        "price": 700
      },
      {
        "model": "SPIKE LIGHT",
        "wattage": "12W",
        "dimension": "70*80",
        "packing": "20",
        "price": 800
      }
    ]
  },
  {
    "id": "GLR-WALL-49",
    "name": "Wall Washer",
    "category": "Wall Light",
    "categories": ["Wall Light"],
    "status": "In Stock",
    "stock": 100,
    "price": 1850,
    "previewType": "street",
    "image": "/assets/images/products/GLR-WALL-49.webp",
    "description": "2 YEARS. TM. Wattage. Dimension. Voltage. CCT (K). Length. Beam Angle. CRI (Ra). Material. Body Color. Rating. 18W / 24W / 36W / 72W. 50*55*500mm / 50*55*990mm. 220V AC / 24V DC. WW / AMBER / GREEN / RED. 1 MTR / 0.5 MTR / CUSTOMISED. 10 Degree. >80. Aluminium. Black / Grey. IP 65. Wall Washer",
    "variants": [
      {
        "model": "Wall Washer",
        "wattage": "DimensionW",
        "price": 1850
      }
    ]
  },
  {
    "id": "GLR-INGR-50",
    "name": "Inground",
    "category": "Spike",
    "categories": ["Spike"],
    "status": "In Stock",
    "stock": 100,
    "price": 1850,
    "previewType": "street",
    "image": "/assets/images/products/GLR-INGR-50.webp",
    "description": "2 YEARS. TM. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 3W / 6W / 9W / 12W. 65*65*75mm / 80*80*85mm. 32mm. WW. N/A. N/A. >80. Aluminium. Silver Chrome. N/A. Inground",
    "variants": [
      {
        "model": "Inground",
        "wattage": "DimensionW",
        "price": 1850
      }
    ]
  },
  {
    "id": "GLR-SWIM-51",
    "name": "Swimming Pool",
    "category": "Spike",
    "categories": ["Spike"],
    "status": "In Stock",
    "stock": 100,
    "price": 1850,
    "previewType": "street",
    "image": "/assets/images/products/GLR-SWIM-51.webp",
    "description": "2 YEARS. TM. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 3W / 9W / 12W / 18W. 85mm / 110mm / 135mm / 160mm. 60mm / 85mm / 110mm / 135mm. WW / WH. N/A. N/A. >80. Aluminium. Silver Chrome. N/A. Swimming Pool",
    "variants": [
      {
        "model": "Swimming Pool",
        "wattage": "DimensionW",
        "price": 1850
      }
    ]
  },
  {
    "id": "GLR-GMFL-52",
    "name": "GM Flood",
    "category": "Flood",
    "categories": ["Flood"],
    "status": "In Stock",
    "stock": 100,
    "price": 1500,
    "previewType": "street",
    "image": "/assets/images/products/GLR-GMFL-52.webp",
    "description": "2 YEARS. TM. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. IP Rating. 30W / 50W / 100W / 200W. 185×180×50 mm / 227×218×55 mm / 260×250×70 mm / 318×308×75 mm. N/A. 6500K. N/A. N/A. >80. Aluminium. Grey. IP66. GM Flood",
    "variants": [
      {
        "model": "GM FLOOD (DRIVER) CW",
        "wattage": "30W",
        "dimension": "185*180*50",
        "packing": "30",
        "price": 1500
      },
      {
        "model": "GM FLOOD (DRIVER) CW",
        "wattage": "50W",
        "dimension": "227*218*55",
        "packing": "16",
        "price": 1850
      },
      {
        "model": "GM FLOOD (DRIVER) CW",
        "wattage": "100W",
        "dimension": "260*250*70",
        "packing": "10",
        "price": 2850
      },
      {
        "model": "GM FLOOD (DRIVER) CW",
        "wattage": "200W",
        "dimension": "318*308*75",
        "packing": "5",
        "price": 5000
      }
    ]
  },
  {
    "id": "GLR-SLIM-53",
    "name": "Slim Flood",
    "category": "Flood",
    "categories": ["Flood"],
    "status": "In Stock",
    "stock": 100,
    "price": 1280,
    "previewType": "street",
    "image": "/assets/images/products/GLR-SLIM-53.webp",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. IP Rating. 50W / 100W. 230*155 mm / 275*185 mm. N/A. 6500K. No. N/A. >80. Aluminum. Grey. IP66. TM. Slim Flood",
    "variants": [
      {
        "model": "SLIM FLOOD (DOB) CW",
        "wattage": "50W",
        "dimension": "230*155",
        "packing": "30",
        "price": 1280
      },
      {
        "model": "SLIM FLOOD (DOB) CW",
        "wattage": "100W",
        "dimension": "275*185",
        "packing": "18",
        "price": 1900
      },
      {
        "model": "SLIM FLOOD (DOB) CW",
        "wattage": "200W",
        "dimension": "305*205",
        "packing": "18",
        "price": 3800
      }
    ]
  },
  {
    "id": "GLR-HIBA-54",
    "name": "Hi-Bay",
    "category": "Flood",
    "categories": ["Flood"],
    "status": "In Stock",
    "stock": 100,
    "price": 4500,
    "previewType": "street",
    "image": "/assets/images/products/GLR-HIBA-54.webp",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. IP Rating. 100W / 150W / 200W. 315 × 145 × 175 mm / 315 × 145 × 175 mm / 377 × 145 × 260 mm. N/A. 6500k. N/A. N/A. >80. Aluminium. Matt Grey. IP66. TM. Hi-Bay",
    "variants": [
      {
        "model": "Hi-Bay",
        "wattage": "DimensionW",
        "price": 4500
      }
    ]
  },
  {
    "id": "GLR-STRE-55",
    "name": "Street",
    "category": "Street",
    "categories": ["Street"],
    "status": "In Stock",
    "stock": 100,
    "price": 3200,
    "previewType": "street",
    "image": "/assets/images/products/GLR-STRE-55.webp",
    "description": "2 YEARS. EVERY NIGHT.. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. IP Rating. 24W / 36W / 50W. 275×120×55 mm / 315×135×55 mm / 360×170×55 mm. N/A. 6500K. No. N/A. >80. Aluminium. Grey. IP66. TM. Street",
    "variants": [
      {
        "model": "Street",
        "wattage": "DimensionW",
        "price": 3200
      }
    ]
  },
  {
    "id": "GLR-SOLA-56",
    "name": "Solar Street",
    "category": "Solar, Street",
    "categories": ["Solar", "Street"],
    "status": "In Stock",
    "stock": 100,
    "price": 3400,
    "previewType": "street",
    "image": "/assets/images/products/GLR-SOLA-56.webp",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. IP Rating. 70W / 120W. 275×120×55 mm / 315×135×55 mm / 360×170×55 mm. N/A. 6500K. No. N/A. >80. Aluminium. Black. IP66. TM. Solar Street",
    "variants": [
      {
        "model": "SOLAR LIGHT",
        "wattage": "70W",
        "dimension": "216*186*43",
        "packing": "20",
        "price": 3400
      },
      {
        "model": "SOLAR LIGHT",
        "wattage": "120W",
        "dimension": "277*266*40",
        "packing": "10",
        "price": 4800
      }
    ]
  },
  {
    "id": "GLR-AURA-57",
    "name": "Aura Max",
    "category": "Gate Light",
    "categories": ["Gate Light"],
    "status": "In Stock",
    "stock": 100,
    "price": 2160,
    "previewType": "street",
    "image": "/assets/images/products/GLR-AURA-57.webp",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 24W. 258 × 258 × 267 mm. N/A. WW. N/A. N/A. >80. Polycarbonate. Black. N/A. TM. Aura Max",
    "variants": [
      {
        "model": "AURA MAX",
        "wattage": "24W",
        "type": "LED",
        "dimension": "258 * 258 * 267",
        "packing": "12",
        "price": 2160
      }
    ]
  },
  {
    "id": "GLR-VIST-58",
    "name": "Vista",
    "category": "Gate Light",
    "categories": ["Gate Light"],
    "status": "In Stock",
    "stock": 100,
    "price": 1700,
    "previewType": "street",
    "image": "/assets/images/products/GLR-VIST-58.webp",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 20W. 290 x 138 x 270 mm. N/A. WW. No. N/A. >80. Polycarbonate. Grey. N/A. TM. Vista",
    "variants": [
      {
        "model": "VISTA",
        "wattage": "20W",
        "type": "LED",
        "dimension": "290 * 138 * 270",
        "packing": "12",
        "price": 1700
      }
    ]
  },
  {
    "id": "GLR-CUBE-59",
    "name": "Cubex",
    "category": "Gate Light",
    "categories": ["Gate Light"],
    "status": "In Stock",
    "stock": 100,
    "price": 1300,
    "previewType": "street",
    "image": "/assets/images/products/GLR-CUBE-59.webp",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 20W. 150×150*150 mm. N/A. WW. No. N/A. >80. Polycarbonate. Black. N/A. TM. Cubex",
    "variants": [
      {
        "model": "CUBE-X",
        "wattage": "20W",
        "dimension": "151 * 151 * 145",
        "packing": "12",
        "price": 1300,
        "type": "LED"
      }
    ]
  },
  {
    "id": "GLR-CUBE-60",
    "name": "Cube",
    "category": "Gate Light",
    "categories": ["Gate Light"],
    "status": "In Stock",
    "stock": 100,
    "price": 1140,
    "previewType": "street",
    "image": "/assets/images/products/GLR-CUBE-60.webp",
    "description": "2 YEARS. TM. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 20W. 151 x 151 x 145 mm. N/A. WW. No. N/A. >80. Polycarbonate. Black. N/A. Cube",
    "variants": [
      {
        "model": "CUBE",
        "wattage": "20W",
        "type": "LED",
        "dimension": "151 * 151 * 145",
        "packing": "12",
        "price": 1140
      }
    ]
  },
  {
    "id": "GLR-MASH-61",
    "name": "Mashal",
    "category": "Street",
    "categories": ["Street"],
    "status": "In Stock",
    "stock": 100,
    "price": 900,
    "previewType": "street",
    "image": "/assets/images/products/GLR-MASH-61.webp",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. Holder Based (No LED). 315×145×45 mm. N/A. According to LED bulb. No. N/A. N/A. Polycarbonate. Black. N/A. TM. Mashal",
    "variants": [
      {
        "model": "MASHAL",
        "type": "HOLDER",
        "dimension": "315*145*45",
        "packing": "12",
        "price": 900
      }
    ]
  },
  {
    "id": "GLR-FREE-62",
    "name": "Freedom",
    "category": "Gate Light",
    "categories": ["Gate Light"],
    "status": "In Stock",
    "stock": 100,
    "price": 1640,
    "previewType": "street",
    "image": "/assets/images/products/GLR-FREE-62.webp",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 20W. 275×120×55 mm. N/A. 3000k / 6500k. No. N/A. >80. Polycarbonate. Black. N/A. TM. Freedom",
    "variants": [
      {
        "model": "FREEDOM",
        "wattage": "20W",
        "dimension": "160 * 230 * 65",
        "packing": "12",
        "price": 1640,
        "type": "LED"
      }
    ]
  },
  {
    "id": "GLR-RUBI-63",
    "name": "Rubik",
    "category": "Gate Light",
    "categories": ["Gate Light"],
    "status": "In Stock",
    "stock": 100,
    "price": 1850,
    "previewType": "street",
    "image": "/assets/images/products/GLR-RUBI-63.webp",
    "description": "2 YEARS. TM. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 12W. 130*130*120mm. N/A. 3000k / 6500k. No. N/A. >80. Aluminium with PC Diffuser. Sand Black. N/A. Rubik",
    "variants": [
      {
        "model": "Rubik",
        "wattage": "DimensionW",
        "price": 1850
      }
    ]
  },
  {
    "id": "GLR-TEMP-64",
    "name": "Temple",
    "category": "Gate Light",
    "categories": ["Gate Light"],
    "status": "In Stock",
    "stock": 100,
    "price": 1850,
    "previewType": "street",
    "image": "/assets/images/products/GLR-TEMP-64.webp",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 15W. 200MM / 300MM. 3000k / 6500k. N/A. N/A. >80. Aluminium. Grey. N/A. N/A. TM. Temple",
    "variants": [
      {
        "model": "Temple",
        "wattage": "DimensionW",
        "price": 1850
      }
    ]
  },
  {
    "id": "GLR-LEGA-65",
    "name": "Legacy",
    "category": "Gate Light",
    "categories": ["Gate Light"],
    "status": "In Stock",
    "stock": 100,
    "price": 1850,
    "previewType": "street",
    "image": "/assets/images/products/GLR-LEGA-65.webp",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 15W. 200MM / 300MM. 3000k / 6500k. N/A. N/A. >80. Aluminium. Grey. N/A. N/A. TM. Legacy",
    "variants": [
      {
        "model": "Legacy",
        "wattage": "DimensionW",
        "price": 1850
      }
    ]
  },
  {
    "id": "GLR-FOUR-66",
    "name": "Four Pillar",
    "category": "Gate Light",
    "categories": ["Gate Light"],
    "status": "In Stock",
    "stock": 100,
    "price": 1850,
    "previewType": "street",
    "image": "/assets/images/products/GLR-FOUR-66.webp",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 15W. 300 mm / 600 mm / 900 mm. N/A. 3000k / 6500k. N/A. N/A. >80. Alluminium. Grey. N/A. TM. Four Pillar",
    "variants": [
      {
        "model": "Four Pillar",
        "wattage": "DimensionW",
        "price": 1850
      }
    ]
  },
  {
    "id": "GLR-SQUA-67",
    "name": "Square",
    "category": "Gate Light",
    "categories": ["Gate Light"],
    "status": "In Stock",
    "stock": 100,
    "price": 1850,
    "previewType": "street",
    "image": "/assets/images/products/GLR-SQUA-67.webp",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 15W. 300 mm / 600 mm / 900 mm. N/A. 3000k / 6500k. N/A. N/A. >80. Alluminium. Grey. N/A. TM. Square. BEAUTIFULLY.",
    "variants": [
      {
        "model": "Square",
        "wattage": "DimensionW",
        "price": 1850
      }
    ]
  },
  {
    "id": "GLR-RING-68",
    "name": "Ring",
    "category": "Gate Light",
    "categories": ["Gate Light"],
    "status": "In Stock",
    "stock": 100,
    "price": 1850,
    "previewType": "street",
    "image": "/assets/images/products/GLR-RING-68.webp",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 15W. 300 mm / 600 mm / 900 mm. N/A. 3000k / 6500k. N/A. N/A. >80. Alluminium. Grey. N/A. TM. Ring",
    "variants": [
      {
        "model": "Ring",
        "wattage": "DimensionW",
        "price": 1850
      }
    ]
  },
  {
    "id": "GLR-ROUN-69",
    "name": "Round",
    "category": "Gate Light",
    "categories": ["Gate Light"],
    "status": "In Stock",
    "stock": 100,
    "price": 1850,
    "previewType": "street",
    "image": "/assets/images/products/GLR-ROUN-69.webp",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 15W. 300 mm / 600 mm / 900 mm. N/A. 3000k / 6500k. N/A. N/A. >80. Alluminium. Grey. N/A. TM. Round",
    "variants": [
      {
        "model": "Round",
        "wattage": "DimensionW",
        "price": 1850
      }
    ]
  },
  {
    "id": "GLR-OVAL-70",
    "name": "Oval",
    "category": "Gate Light",
    "categories": ["Gate Light"],
    "status": "In Stock",
    "stock": 100,
    "price": 1850,
    "previewType": "street",
    "image": "/assets/images/products/GLR-OVAL-70.webp",
    "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 15W. 300 mm / 600 mm / 900 mm. N/A. 3000k / 6500k. N/A. N/A. >80. Alluminium. Grey. N/A. TM. Oval",
    "variants": [
      {
        "model": "Oval",
        "wattage": "DimensionW",
        "price": 1850
      }
    ]
  }
];

  // Store list of products as a signal
  private productsSignal = signal<Product[]>(this.loadFromStorage());

  constructor() {
    this.initFirestoreSync();
  }

  // An earlier cleanup blanked the category on every stored product. The
  // catalogue assignment in defaultProducts is authoritative until an admin
  // edits the product, so copy it onto the stored copy once and mark it with
  // categoryV2. Returns true when the document still needs the change saved.
  private applyCatalogueCategories(p: Product): boolean {
    if (p.categoryV2) return false;
    const defP = this.defaultProducts.find(dp => dp.id === p.id);
    if (!defP || !defP.category) return false;
    p.category = defP.category;
    p.categories = defP.categories ? [...defP.categories] : [];
    p.categoryV2 = true;
    return true;
  }

  // Every product whose options are printed on the 1 July 2026 price list.
  // Anything outside it is left exactly as stored.
  private static readonly PRICE_LIST_2026 = new Set([
    'GLR-DELT-3', 'GLR-CURV-4', 'GLR-GEM-5', 'GLR-DELT-7', 'GLR-MOVA-15', 'GLR-SPOT-18',
    'GLR-DEEP-19', 'GLR-NEXU-20', 'GLR-CONC-23', 'GLR-TRAC-24', 'GLR-STRE-26', 'GLR-CYLI-28',
    'GLR-STRI-30', 'GLR-SLIM-31', 'GLR-SURF-32', 'GLR-TRIM-33', 'GLR-STRI-35', 'GLR-SMPS-36',
    'GLR-ROPE-37', 'GLR-PROF-38', 'GLR-KTYP-41', 'GLR-BALL-42', 'GLR-CURV-43', 'GLR-FOOT-47',
    'GLR-SPIK-48', 'GLR-GMFL-52', 'GLR-SLIM-53', 'GLR-SOLA-56', 'GLR-AURA-57', 'GLR-VIST-58',
    'GLR-CUBE-59', 'GLR-CUBE-60', 'GLR-MASH-61', 'GLR-FREE-62',
  ]);

  // Brings the stored product back in line with the printed price list: the
  // rate on every option, the packing count, the dimensions, and the headline
  // price a quotation line falls back to. Only the sheet's own columns are
  // copied — the shades an admin has put on an option, and what those shades
  // cost, are carried across untouched, so this never undoes work done in the
  // product form. An option list the admin has grown or trimmed is left alone
  // entirely; only its headline price is corrected.
  // Returns true when the document still needs the change saved.
  private applyPriceList2026(p: Product): boolean {
    if (p.priceList2026) return false;
    if (!ProductService.PRICE_LIST_2026.has(p.id)) return false;
    const defP = this.defaultProducts.find(dp => dp.id === p.id);
    if (!defP) return false;
    p.price = defP.price;
    if (defP.variants && p.variants && p.variants.length === defP.variants.length) {
      p.variants = defP.variants.map((dv, i) => {
        const stored = p.variants![i] || {};
        const merged: ProductVariant = { ...dv };
        if (stored.lightColours) merged.lightColours = stored.lightColours;
        if (stored.lightColourPrice) merged.lightColourPrice = stored.lightColourPrice;
        return merged;
      });
    }
    p.priceList2026 = true;
    return true;
  }

  // Detects placeholder test categories like "t1", "t2", "t3" (or comma lists of
  // them) that should not appear as real product categories.
  private isJunkCategory(category?: string): boolean {
    const c = (category || '').trim();
    if (!c) return false;
    return /^t\d+(\s*,\s*t\d+)*$/i.test(c);
  }

  // Catalogue image paths are owned by code, not by the stored document: the
  // files ship with the app, so a product seeded before an image was swapped
  // still carries the old path in Firestore/localStorage and would 404.
  // Refreshing from defaultProducts fixes every client at once. Admin-uploaded
  // images (data URLs, Storage URLs) are left alone.
  private isBundledProductImage(image?: string): boolean {
    return !!image && image.includes('/assets/images/products/');
  }

  private initFirestoreSync() {
    if (!this.firestore) return;
    try {
      const prodCollection = collection(this.firestore, 'products');
      onSnapshot(prodCollection, (snapshot) => {
        if (!snapshot.empty) {
          const remoteProducts: Product[] = [];
          snapshot.forEach(docSnap => {
            const p = docSnap.data() as Product;
            // Seed variants only onto a product that has none of its own.
            //
            // This used to overwrite p.variants from defaultProducts on every
            // snapshot, on the reasoning that the catalogue in code was the
            // authority. That stopped being true once the product form could
            // edit variants: the admin's save reached Firestore intact, the
            // snapshot for that very write came straight back, and this line
            // replaced the edit with the seed again — so a variant change
            // looked like it silently refused to save, and reappeared on
            // refresh. The stored document wins now; the seed only fills in a
            // product that predates having variants at all.
            const defP = this.defaultProducts.find(dp => dp.id === p.id);
            if (defP && defP.variants && !(p.variants && p.variants.length)) {
              p.variants = defP.variants;
            }
            if (defP && defP.image && this.isBundledProductImage(p.image)) {
              p.image = defP.image;
            }
            // Strip leftover placeholder categories (t1/t2/t3) and persist the
            // cleanup back to Firestore so it stays gone on every device.
            if (this.isJunkCategory(p.category)) {
              p.category = '';
              if (this.firestore) {
                setDoc(doc(this.firestore, 'products', p.id), p).catch(() => {});
              }
            }
            // Restore the catalogue categories. Persisted from whichever client
            // has write access (the admin); dealers just render them and the
            // write fails harmlessly.
            if (this.applyCatalogueCategories(p) && this.firestore) {
              setDoc(doc(this.firestore, 'products', p.id), p).catch(() => {});
            }
            // Same deal for the printed price list. Dealers apply it in memory
            // on every load; the admin's client is the one that persists it.
            if (this.applyPriceList2026(p) && this.firestore) {
              setDoc(doc(this.firestore, 'products', p.id), p).catch(() => {});
            }
            remoteProducts.push(p);
          });
          if (remoteProducts.length > 0) {
            this.productsSignal.set(remoteProducts);
            this.saveToStorage(remoteProducts);
          }
        } else {
          // Seed Firestore with defaultProducts if database is empty
          this.defaultProducts.forEach(p => {
            if (this.firestore) {
              setDoc(doc(this.firestore, 'products', p.id), p).catch(() => {});
            }
          });
        }
      }, (err) => {
        console.warn('Firestore snapshot notice (using local storage fallback):', err?.message || err);
      });
    } catch (e) {
      console.warn('Firestore sync notice:', e);
    }
  }

  private loadFromStorage(): Product[] {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        let parsed = JSON.parse(stored);
        // Merge variants from defaultProducts if missing or updated
        parsed = parsed.map((p: any) => {
          // Same rule as the Firestore snapshot above: never clobber variants
          // the admin has edited, only fill in a product that has none.
          const defP = this.defaultProducts.find(dp => dp.id === p.id);
          if (defP && defP.variants && !(p.variants && p.variants.length)) {
            p.variants = defP.variants;
          }
          if (defP && defP.image && this.isBundledProductImage(p.image)) {
            p.image = defP.image;
          }
          // Drop placeholder categories (t1/t2/t3) from the cached copy too.
          if (this.isJunkCategory(p.category)) {
            p.category = '';
          }
          // ...and restore the catalogue categories on the cached copy, so the
          // list is right on first paint instead of after the Firestore sync.
          this.applyCatalogueCategories(p);
          this.applyPriceList2026(p);
          return p;
        });
        return parsed;
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

  // Returns a promise that rejects if the Firestore write fails (commonly an
  // image pushing the document past Firestore's 1 MB limit) so the caller can
  // tell the admin the save didn't sync. Swallowing it showed a "saved" screen
  // for a product the dealers never received.
  addProduct(productData: Omit<Product, 'status'>): Promise<void> {
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

    if (this.firestore) {
      return setDoc(doc(this.firestore, 'products', newProduct.id), newProduct);
    }
    return Promise.resolve();
  }

  updateProduct(updatedProduct: Product): Promise<void> {
    const status: Product['status'] = updatedProduct.stock > 100 
      ? 'In Stock' 
      : (updatedProduct.stock > 0 ? 'Low Stock' : 'Out of Stock');
    
    const product = { ...updatedProduct, status };

    this.productsSignal.update(products => {
      const newList = products.map(p => p.id === product.id ? product : p);
      this.saveToStorage(newList);
      return newList;
    });

    if (this.firestore) {
      return setDoc(doc(this.firestore, 'products', product.id), product);
    }
    return Promise.resolve();
  }

  deleteProduct(id: string) {
    this.productsSignal.update(products => {
      const newList = products.filter(p => p.id !== id);
      this.saveToStorage(newList);
      return newList;
    });

    if (this.firestore) {
      deleteDoc(doc(this.firestore, 'products', id))
        .catch(err => console.warn('Firestore delete notice:', err?.message || err));
    }
  }
}
