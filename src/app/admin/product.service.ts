import { Injectable, signal, inject } from '@angular/core';
import { parseBodyColours } from './body-colours';
import { Firestore, collection, doc, setDoc, deleteDoc, onSnapshot } from '@angular/fire/firestore';

export interface ProductVariant {
  /**
   * What this option is picked by — the one thing that tells it from its
   * siblings. Usually a wattage ("7W", "200W"), but whatever the price sheet
   * counts the range in: "2 WAY" for the fittings sold in ways, "12V/3A" for a
   * driver, "METAL(IP 65)" where the build is the choice.
   *
   * There used to be a second `type` field beside this. It held the same kind
   * of value — Spot kept its wattages in it — so which field a value landed in
   * was arbitrary, and the form had to show both. One field, always this one.
   */
  wattage?: string;
  dimension?: string;
  cutout?: string;
  packing?: string;
  /**
   * The rate. `pricePerMtr` is the same number for the goods sold by length —
   * rope, strip, track, profile — and only one of the two is ever set.
   */
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
  /**
   * Set once the 1 July 2026 catalogue has been reconciled onto the stored
   * product: the two swapped names put right, the wattages the sheet dropped
   * removed, the finishes lifted to `bodyColours` below, and the three fields
   * the option no longer carries (model, colorSize, bodyColour) stripped off.
   *
   * A second flag rather than a reset of `priceList2026`: that one only ever
   * copied rates across, and every stored product already has it set, so it
   * can never fire again.
   */
  catalogue2026?: boolean;
  /**
   * Set once the finishes have been re-derived under the corrected reading of
   * the sheet's BODY COLOUR column.
   *
   * The first pass paired the positions off one-for-one, so "BK/WH + GBK/RG"
   * came out as two finishes. It is a cross product: every body against every
   * reflector, so that cell is four. A second flag because `catalogue2026` is
   * already set on every stored product and can never fire again.
   */
  bodyColoursV2?: boolean;
  /**
   * Set once the finishes the catalogue prints but the stored product never
   * carried have been filled in from the July 2026 catalogue's BODY COLOUR
   * (crossed with REFLECTOR) column — the roughly fifty ranges, mostly the
   * gate lights and the single-option outdoor fittings, that showed no finish
   * to choose at all. Fill-only: a product that already lists finishes, whether
   * seeded or typed by an admin, is left exactly as it is.
   */
  bodyColoursV3?: boolean;
  /**
   * Set once the option dimensions and cut-outs have been taken from the July
   * 2026 catalogue's TECHNICAL SPECIFICATIONS block.
   *
   * Two shapes of change. A fill, for the products that still carried a single
   * blank option: the catalogue's base (lowest-wattage) row gives that one
   * option its wattage, dimension and cut-out, never a price (the per-option
   * price sheet is not in the repo) and never over a value an admin has already
   * typed. A replace, for the five whose stored options had been duplicated off
   * the wrong product (Streak, Nova, Tile, and the dimensions on Freedom and
   * Solar Street): their option list is rebuilt from the catalogue. Where the
   * wattages still line up the real prices are kept; where they do not, the
   * option carries no price and falls back to the product's headline one until
   * the sheet is applied.
   */
  variantDetails2026?: boolean;
  /**
   * Set once the option's `type` has been folded into its `wattage`.
   *
   * The two fields held the same kind of value, so the sheet's "3W" sat in one
   * product and "2 WAY" in the other with no rule saying which. Where only
   * `type` was filled it becomes the wattage; where both were, `type` was the
   * word "LED" beside a real wattage and is simply dropped.
   */
  optionFieldMerged?: boolean;
  /**
   * Set once the shades have been assigned from the 1 July 2026 catalogue:
   * the full indoor range on the COBs, panels, cylinders, track and surface
   * fittings; warm white on the decorative outdoor ones; cool white on the
   * rest; the rope's own colours; and none at all on a driver or a profile.
   */
  lightColours2026?: boolean;
  /**
   * Set once the track rail has been taken off the tracklight.
   *
   * The rail is not a fitting: it is sold by the metre, in black or white, and
   * a dealer picks it separately. It lived as two rows on the tracklight
   * reading "1M | 2M", which is a length rather than a wattage. Those rows are
   * removed here and the rail is now PC Track and Metal Track, two products of
   * their own.
   */
  trackSplit?: boolean;
  /**
   * Set once the catalogue tidy-up has been carried onto the stored product:
   * the categories that did not describe the product, Concealed split into the
   * two the sheet actually prints, and the option labels the import left as the
   * literal word "Dimension".
   */
  catalogueTidy?: boolean;
  /**
   * Set once the warranty has been put on the stored product, and the two
   * hand-made duplicates of the track rail removed.
   */
  warrantySet?: boolean;
  /**
   * Set once the rope and the strip have been read off the sheet's MODEL
   * column rather than its TYPE column.
   *
   * The rope was three options that were never options — one rope whose colour
   * sets the rate — and the strip was two options both labelled with the type
   * they share, so nothing told Eco from Pure Copper.
   */
  ropeStripFixed?: boolean;
  /**
   * Set once the ball light's auto option carries its own shade.
   *
   * The sheet heads that table "BALL LIGHT WW", so the product is warm white —
   * but the 4-way auto option is the one that cycles red, green, blue and
   * pink, and it is the only option on the range that differs from its
   * product this way.
   */
  ballRgbpFixed?: boolean;
  /**
   * Set once the August 2026 price sheet has been applied: the per-wattage
   * rates the office wrote out by hand, which the repo never had before (the
   * seed only ever carried a single placeholder option). It rebuilds the
   * option list from that sheet — one option per wattage, each at its own
   * price, with the wattage, dimension and cut-out from the catalogue — for the
   * ranges the sheet actually prices. Bumped to v2 to re-run once the per-
   * option dimensions were added over the first rates-only pass.
   */
  priceSheet2026v2?: boolean;
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
  /**
   * How long the fitting is guaranteed for — "2 Years", "1 Year".
   *
   * The range carries two years unless the sheet prints a note under that
   * product's own table, which it does for the rope, the strip, both
   * concealed, the striker, the polycarbonate curve, the ball light, the
   * K-type, the foot light and the spike. Stored as the sheet words it rather
   * than a number of months: one product's note covers two warranties at once
   * ("1 Year Eco Strip / 2 Years Pure Copper") and a number could not say that.
   */
  warranty?: string;
  variants?: ProductVariant[];
}

@Injectable({
  providedIn: 'root'
})
export class ProductService {
  private STORAGE_KEY = 'glaron_products_catalog_v13';
  // Ids of catalogue products the admin has deleted. Held so the seed-fill in
  // the Firestore sync never resurrects them: every listed product begins life
  // as a seed, so without this a delete came straight back on the next
  // snapshot. Loaded from localStorage for an instant guard on this device and
  // mirrored to Firestore (meta/products) so no other client re-seeds it.
  private DELETED_KEY = 'glaron_products_deleted_v1';
  private deletedIds = new Set<string>(this.loadDeletedIds());
  private firestore = inject(Firestore, { optional: true });

  private defaultProducts: Product[] = [
    {
      "id": "GLR-DELT-3",
      "name": "Delta",
      "category": "COB",
      "categories": [
        "COB"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 580,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-DELT-3.webp",
      "description": "TM. Delta. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 18W. 63×61 mm / 82×79 mm / 90×88 mm. 50 mm / 72 mm / 78 mm. 3000k / 4000k / 6500k. Available. 24° / 38° / 38°. > 80. Aluminium. Black / White. N/A. 2 YEARS",
      "variants": [
        {
          "wattage": "7W",
          "dimension": "63*61",
          "cutout": "50",
          "packing": "40",
          "price": 580
        },
        {
          "wattage": "12W",
          "dimension": "82*79",
          "cutout": "72",
          "packing": "40",
          "price": 690
        },
        {
          "wattage": "18W",
          "dimension": "90*88",
          "cutout": "78",
          "packing": "20",
          "price": 930
        }
      ],
      "bodyColours": [
        "WHITE",
        "BLACK"
      ],
      "lightColours": [
        "Cool White",
        "Natural White",
        "Warm White",
        "3 In 1",
        "Dimmable-Tunable"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-CURV-4",
      "name": "Curve",
      "category": "COB",
      "categories": [
        "COB"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 580,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-CURV-4.webp",
      "description": "TM. Curve. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 18W. 70×50 mm / 85×65 mm / 95×75 mm. 65 mm / 80 mm / 90 mm. 3000k / 4000k / 6500k. Available. 24°. >80. Aluminium. BK / WH. RG / GBK / MW / MB. 2 YEARS",
      "variants": [
        {
          "wattage": "7W",
          "dimension": "70*50",
          "cutout": "65",
          "packing": "40",
          "price": 580
        },
        {
          "wattage": "12W",
          "dimension": "85*65",
          "cutout": "80",
          "packing": "40",
          "price": 720
        },
        {
          "wattage": "18W",
          "dimension": "95*75",
          "cutout": "90",
          "packing": "20",
          "price": 1030
        }
      ],
      "bodyColours": [
        "BK/RG",
        "BK/GBK",
        "BK/MW",
        "BK/MB",
        "WH/RG",
        "WH/GBK",
        "WH/MW",
        "WH/MB"
      ],
      "lightColours": [
        "Cool White",
        "Natural White",
        "Warm White",
        "3 In 1",
        "Dimmable-Tunable"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-GEM-5",
      "name": "Gem",
      "category": "COB",
      "categories": [
        "COB"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 670,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-GEM-5.webp",
      "description": "TM TM. Gem. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 18W. 73×61 mm / 85×67 mm / 93×73 mm. 65 mm / 75 mm / 85 mm. 3000k / 4000k / 6500k. Available. 24° / 38° / 38°. >80. Aluminium. BK / WH. GBK / RG. 2 YEARS",
      "variants": [
        {
          "wattage": "7W",
          "dimension": "73*61",
          "cutout": "65",
          "packing": "40",
          "price": 670
        },
        {
          "wattage": "12W",
          "dimension": "85*67",
          "cutout": "75",
          "packing": "40",
          "price": 820
        },
        {
          "wattage": "18W",
          "dimension": "93*73",
          "cutout": "85",
          "packing": "20",
          "price": 1150
        }
      ],
      "bodyColours": [
        "BK/GBK",
        "WH/RG"
      ],
      "lightColours": [
        "Cool White",
        "Natural White",
        "Warm White",
        "3 In 1",
        "Dimmable-Tunable"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-GLAR-6",
      "name": "Glare",
      "category": "COB",
      "categories": [
        "COB"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 580,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-GLAR-6.webp",
      "description": "TM. Glare. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W. 55 × 55 × 60 mm / 55 × 55 × 70 mm. 50 mm. 3000k / 4000k / 6500k. Available. 38°. >80. Aluminium Die-casting. MW / MB / RG / SILVER / GB. N/A. 2 YEARS",
      "variants": [
        {
          "price": 580
        }
      ],
      "lightColours": [
        "Cool White",
        "Natural White",
        "Warm White",
        "3 In 1",
        "Dimmable-Tunable"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-DELT-7",
      "name": "Delta Pro",
      "category": "COB",
      "categories": [
        "COB"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 580,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-DELT-7.webp",
      "description": "TM. Delta Pro. 2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 18W. 75 × 60 mm / 85 × 76 mm / 95 × 100 mm. 65 mm / 75 mm / 85 mm. 3000k / 4000k / 6500k. Available. 24° / 38°. >80. Aluminium Die-casting. BK / WH. GBK / RGD / GD / CH",
      "variants": [
        {
          "wattage": "7W",
          "dimension": "63*61",
          "cutout": "50",
          "packing": "40",
          "price": 580
        },
        {
          "wattage": "12W",
          "dimension": "82*79",
          "cutout": "72",
          "packing": "40",
          "price": 690
        },
        {
          "wattage": "18W",
          "dimension": "90*88",
          "cutout": "78",
          "packing": "20",
          "price": 930
        }
      ],
      "bodyColours": [
        "WHITE",
        "BLACK"
      ],
      "lightColours": [
        "Cool White",
        "Natural White",
        "Warm White",
        "3 In 1",
        "Dimmable-Tunable"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-VOGU-8",
      "name": "Vogue",
      "category": "COB",
      "categories": [
        "COB"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 580,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-VOGU-8.webp",
      "description": "TM. Vogue. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W. 42 × 42 × 60 mm / 62 × 62 × 60 mm. 35 mm / 55 mm. 3000k / 4000k / 6500k. Available. 36°. >80. Aluminium Die-casting. MW / MB. N/A. 2 YEARS",
      "variants": [
        {
          "price": 580
        }
      ],
      "lightColours": [
        "Cool White",
        "Natural White",
        "Warm White",
        "3 In 1",
        "Dimmable-Tunable"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-GLON-9",
      "name": "Glon",
      "category": "COB",
      "categories": [
        "COB"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 580,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-GLON-9.webp",
      "description": "TM. 2 YEARS. Glon. FOCUSED PERFORMANCE.. PREMIUM FINISH.. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 18W. 63 × 63 × 43 mm / 80 × 80 × 44 mm / 94 × 84 × 51 mm. 55 mm / 75 mm / 85 mm. 3000k / 4000k / 6500k. Available. 38°. N/A. Aluminium Die-casting. MW / MB / RG / SB / ANTIQUE BRASS. N/A",
      "variants": [
        {
          "price": 580
        }
      ],
      "lightColours": [
        "Cool White",
        "Natural White",
        "Warm White",
        "3 In 1",
        "Dimmable-Tunable"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-ELEG-10",
      "name": "Elegance",
      "category": "COB",
      "categories": [
        "COB"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 580,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-ELEG-10.webp",
      "description": "TM. Elegance. 2 YEARS. WHERE DESIGN MEETS LIGHT.. WHERE QUALITY LASTS.. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 18W. 68 × 66 mm / 83 × 75 mm / 93 × 85 mm. 60 mm / 75 mm / 85 mm. 3000k / 4000k / 6500k. Available. 24° / 38°. >80. Aluminium Die-casting. White / Black. N/A",
      "variants": [
        {
          "price": 580
        }
      ],
      "lightColours": [
        "Cool White",
        "Natural White",
        "Warm White",
        "3 In 1",
        "Dimmable-Tunable"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-ORBI-11",
      "name": "Orbit",
      "category": "COB",
      "categories": [
        "COB"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 580,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-ORBI-11.webp",
      "description": "TM. 2 YEARS. Orbit. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 18W. 63 × 32 mm / 80 × 40 mm / 95 × 40 mm. 60 mm / 75 mm / 85 mm. 3000k / 4000k / 6500k. Available. 24° / 38°. >80. Aluminium Die-casting. White / Black. N/A",
      "variants": [
        {
          "price": 580
        }
      ],
      "lightColours": [
        "Cool White",
        "Natural White",
        "Warm White",
        "3 In 1",
        "Dimmable-Tunable"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-PRIS-12",
      "name": "Prism",
      "category": "COB",
      "categories": [
        "COB"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 580,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-PRIS-12.webp",
      "description": "Prism. 2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 18W. 68 × 48 mm / 83 × 55 mm / 93 × 60 mm. 60 mm / 75 mm / 85 mm. 3000k / 4000k / 6500k. Available. 24° / 38°. >80. Aluminium Die-casting. BK / WH. RGD / GBK. TM",
      "variants": [
        {
          "price": 580
        }
      ],
      "lightColours": [
        "Cool White",
        "Natural White",
        "Warm White",
        "3 In 1",
        "Dimmable-Tunable"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-DUO-13",
      "name": "Duo",
      "category": "COB",
      "categories": [
        "COB"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 580,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-DUO-13.webp",
      "description": "2 YEARS. TM. Duo. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 2×10W / 2×15W. N/A. 113×55mm / 153×75mm. 3000k / 4000k / 6500k. Available. 36°. >80. Aluminium Die-casting. Black / White. N/A",
      "variants": [
        {
          "price": 580
        }
      ],
      "lightColours": [
        "Cool White",
        "Natural White",
        "Warm White",
        "3 In 1",
        "Dimmable-Tunable"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-DUOR-14",
      "name": "Duo R",
      "category": "COB",
      "categories": [
        "COB"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 580,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-DUOR-14.webp",
      "description": "2 YEARS. TM. Duo R. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 2*7W / 2*12W. 68 x 134mm / 85 x 170mm. 55 x 122mm / 75 x 160mm. 3000k / 4000k / 6500k. Available. 36°. >80. Aluminium Die-casting. MW / BK. GBK / RG / WH",
      "variants": [
        {
          "price": 580
        }
      ],
      "lightColours": [
        "Cool White",
        "Natural White",
        "Warm White",
        "3 In 1",
        "Dimmable-Tunable"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-MOVA-15",
      "name": "Movable",
      "category": "COB",
      "categories": [
        "COB"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 665,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-MOVA-15.webp",
      "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 18W / 24W / 30W. 85×40 mm / 108×50 mm / 135×80 mm / 150×100 mm. 80 mm / 100 mm / 120 mm / 132 mm. 3000k / 4000k / 6500k. No. 38°/60°. >80. Aluminium. White. N/A. TM. Movable",
      "variants": [
        {
          "wattage": "12W",
          "dimension": "85*40",
          "cutout": "80",
          "packing": "20",
          "price": 750
        },
        {
          "wattage": "18W",
          "dimension": "108*50",
          "cutout": "100",
          "packing": "20",
          "price": 1080
        },
        {
          "wattage": "24W",
          "dimension": "135*80",
          "cutout": "120",
          "packing": "10",
          "price": 1520
        }
      ],
      "bodyColours": [
        "WHITE"
      ],
      "lightColours": [
        "Cool White",
        "Natural White",
        "Warm White",
        "3 In 1",
        "Dimmable-Tunable"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-PULL-16",
      "name": "Pull Out",
      "category": "COB",
      "categories": [
        "COB"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 580,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-PULL-16.webp",
      "description": "2 YEARS. TM. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. Shape. 7W / 12W / 2 x 7W / 2 × 12W. 68 × 48 mm / 83 × 55 mm / 93 × 60 mm. 60 mm / 75 mm / 85 mm. 3000k / 4000k / 6500k. No. 24° / 38°. >80. Aluminium Die-casting. BK / WH. N/A. Round/Square. Pull Out",
      "variants": [
        {
          "price": 580
        }
      ],
      "lightColours": [
        "Cool White",
        "Natural White",
        "Warm White",
        "3 In 1",
        "Dimmable-Tunable"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-LINE-17",
      "name": "Linea",
      "category": "COB",
      "categories": [
        "COB"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 580,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-LINE-17.webp",
      "description": "2 YEARS. TM. EVERY SPACE SHINES.. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 6W / 8W / 12W. 68 × 45 × 32 mm / 95 × 45 × 32 mm / 146 × 45 × 32 mm. 58 × 35 mm / 85 × 35 mm / 137 × 35 mm. 3000k / 4000k / 6500k. Available. 38°. >80. Aluminium Die-casting. PKW / BK. MW / MB / RG / GB. Linea",
      "variants": [
        {
          "price": 580
        }
      ],
      "lightColours": [
        "Cool White",
        "Natural White",
        "Warm White",
        "3 In 1",
        "Dimmable-Tunable"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-SPOT-18",
      "name": "Spot",
      "category": "COB",
      "categories": [
        "COB"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 110,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-SPOT-18.webp",
      "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 1W / 2W / 3W. N/A. 25 mm / 32 mm / 28 mm. 3000k / 4000k / 6500k. No. N/A. >80. Polycarbonate / Aluminium. WH / BK / RG. N/A. TM. Spot",
      "variants": [
        {
          "cutout": "28",
          "packing": "100",
          "price": 280,
          "wattage": "3W"
        },
        {
          "cutout": "25",
          "packing": "100",
          "price": 110,
          "wattage": "1W"
        },
        {
          "cutout": "32",
          "packing": "100",
          "price": 110,
          "wattage": "2W"
        }
      ],
      "bodyColours": [
        "BLACK",
        "WHITE",
        "RGD"
      ],
      "lightColours": [
        "Cool White",
        "Natural White",
        "Warm White",
        "3 In 1",
        "Dimmable-Tunable"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-DEEP-19",
      "name": "Deep Downlight",
      "category": "Down Light",
      "categories": [
        "Down Light"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 710,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-DEEP-19.webp",
      "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 12W / 18W / 24W. 120 mm / 155 mm / 175 mm. 110 mm / 145 mm / 170 mm. 3000k / 4000k / 6500k. No. N/A. >80. Aluminium. White / Black. N/A. TM. Deep Downlight",
      "variants": [
        {
          "wattage": "12W",
          "dimension": "120",
          "cutout": "115-110",
          "packing": "40",
          "price": 710
        },
        {
          "wattage": "18W",
          "dimension": "155",
          "cutout": "145-145",
          "packing": "20",
          "price": 920
        },
        {
          "wattage": "24W",
          "dimension": "175",
          "cutout": "165-170",
          "packing": "20",
          "price": 1200
        }
      ],
      "lightColours": [
        "Cool White",
        "Natural White",
        "Warm White",
        "3 In 1",
        "Dimmable-Tunable"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-NEXU-20",
      "name": "Nexus Pro",
      "category": "Down Light",
      "categories": [
        "Down Light"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 850,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-NEXU-20.webp",
      "description": "2 YEARS. TM. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 18W / 24W. 85×45 mm / 100×48 mm / 130×48 mm. 75 mm / 92 mm / 120 mm /140 mm. 3000k / 4000k / 6500k. Available. N/A. >80. Aluminium. WH / BK. WH/ SB / RG / MB /MW. Nexus Pro",
      "variants": [
        {
          "wattage": "7W",
          "dimension": "85*45",
          "cutout": "75",
          "packing": "40",
          "price": 850
        },
        {
          "wattage": "12W",
          "dimension": "100*48",
          "cutout": "92",
          "packing": "40",
          "price": 1150
        },
        {
          "wattage": "18W",
          "dimension": "130*48",
          "cutout": "120",
          "packing": "20",
          "price": 1450
        }
      ],
      "bodyColours": [
        "WH/WH",
        "WH/SB",
        "WH/RG",
        "BK/WH",
        "BK/SB",
        "BK/RG"
      ],
      "lightColours": [
        "Cool White",
        "Natural White",
        "Warm White",
        "3 In 1",
        "Dimmable-Tunable"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-NEXU-21",
      "name": "Nexus surface",
      "category": "Surface",
      "categories": [
        "Surface"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 580,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-NEXU-21.webp",
      "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 12W / 18W / 24W. 92 × 75 mm / 122 × 75 mm / 142 × 75 mm. N/A. 3000k / 4000k / 6500k. N/A. 120°. >80. Aluminium Die-casting. PKW / BK. WH / SB / RG / MB / MW. TM. Nexus surface",
      "variants": [
        {
          "price": 580
        }
      ],
      "lightColours": [
        "Cool White",
        "Natural White",
        "Warm White",
        "3 In 1",
        "Dimmable-Tunable"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-NOVA-22",
      "name": "Nova",
      "category": "Surface",
      "categories": [
        "Surface"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 580,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-NOVA-22.webp",
      "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 18W / 24W. 51 x 51 x 45 / 80 × 80 × 46 mm / 90 × 90 × 48 mm / 128 × 128 × 50 mm. N/A. 3000k / 4000k / 6500k. N/A. 38°. >80. Aluminium Die-casting. PKW / BK. N/A. TM. Nova",
      "variants": [
        {
          "wattage": "50W",
          "dimension": "216*186*43",
          "packing": "20",
          "price": 1720
        },
        {
          "wattage": "100W",
          "dimension": "277*266*40",
          "packing": "10",
          "price": 2860
        }
      ],
      "lightColours": [
        "Cool White",
        "Natural White",
        "Warm White",
        "3 In 1",
        "Dimmable-Tunable"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-CONC-23",
      "name": "PC Concealed",
      "category": "Concealed",
      "categories": [
        "Concealed"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 140,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-CONC-23.webp",
      "description": "PC Concealed 7W. 110*110 mm, 70 mm cut-out. Warm, natural or cool white at Rs.140; red, green, blue or pink at Rs.150; 3-in-1 at Rs.180.",
      "variants": [
        {
          "wattage": "7W",
          "dimension": "110*110",
          "cutout": "70",
          "packing": "200",
          "price": 140
        }
      ],
      "lightColours": [
        "Warm White",
        "Natural White",
        "Cool White",
        "Red",
        "Green",
        "Blue",
        "Pink",
        "3 In 1"
      ],
      "lightColourPrice": {
        "Red": 150,
        "Green": 150,
        "Blue": 150,
        "Pink": 150,
        "3 In 1": 180
      },
      "warranty": "1 Year"
    },
    {
      "id": "GLR-TRAC-24",
      "name": "Tracklight",
      "category": "Track Light",
      "categories": [
        "Track Light"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 210,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-TRAC-24.webp",
      "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Track channel. 10W / 20W / 30W. 50×125 mm / 65×150 mm / 75×180 mm. N/A. 3000k / 4000k / 6500k. No. N/A. >80. Aluminium. Black / White. 1M / 2M. TM. Tracklight",
      "variants": [
        {
          "wattage": "10W",
          "dimension": "50*125",
          "packing": "20",
          "price": 980
        },
        {
          "wattage": "20W",
          "dimension": "65*150",
          "packing": "20",
          "price": 1380
        },
        {
          "wattage": "30W",
          "dimension": "75*180",
          "packing": "20",
          "price": 1700
        }
      ],
      "bodyColours": [
        "WHITE",
        "BLACK"
      ],
      "lightColours": [
        "Cool White",
        "Natural White",
        "Warm White",
        "3 In 1",
        "Dimmable-Tunable"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-TRAC-25",
      "name": "Track Wall",
      "category": "Track Light",
      "categories": [
        "Track Light"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 580,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-TRAC-25.webp",
      "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 10W / 20W / 30W. 30 × 30 × 110 mm / 50 × 50 × 120 mm / 75 × 75 × 180 mm. N/A. 3000k / 4000k / 6500k. N/A. 38°. >80. Aluminium Die-casting. MW / MB. N/A. TM. Track Wall",
      "variants": [
        {
          "price": 580
        }
      ],
      "lightColours": [
        "Cool White",
        "Natural White",
        "Warm White",
        "3 In 1",
        "Dimmable-Tunable"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-STRE-26",
      "name": "Streak",
      "category": "Street",
      "categories": [
        "Street"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 1050,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-STRE-26.webp",
      "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W. 35 × 35 × 120 mm. N/A. 3000k / 4000k / 6500k. N/A. 38°. N/A. Aluminium Die-casting. PKW / BK. N/A. TM. Streak",
      "variants": [
        {
          "wattage": "24W",
          "dimension": "275*120*55",
          "packing": "30",
          "price": 1050
        },
        {
          "wattage": "36W",
          "dimension": "315*135*55",
          "packing": "25",
          "price": 1420
        },
        {
          "wattage": "50W",
          "dimension": "360*170*55",
          "packing": "20",
          "price": 1950
        }
      ],
      "lightColours": [
        "Cool White"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-MOVA-27",
      "name": "Movable Cylinder",
      "category": "Cylinder",
      "categories": [
        "Cylinder"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 580,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-MOVA-27.webp",
      "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 24W. 85 × 90 mm / 103 × 120 mm / 165 × 90 mm. 75 mm / 90 mm / 80 × 150 mm. 3000k / 4000k / 6500k. N/A. 38°. >80. Aluminium Die-casting. Matt White / Matt Black. GBK / RG. TM. Movable Cylinder",
      "variants": [
        {
          "price": 580
        }
      ],
      "lightColours": [
        "Cool White",
        "Natural White",
        "Warm White",
        "3 In 1",
        "Dimmable-Tunable"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-CYLI-28",
      "name": "Cylinder",
      "category": "Cylinder",
      "categories": [
        "Cylinder"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 740,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-CYLI-28.webp",
      "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 18W. 60×70 mm / 73×85 mm / 87×100 mm. N/A. 3000k / 4000k / 6500k. No. 34°. >80. Aluminium. BK / WH. MB / MW / GBK / RG. TM. Cylinder",
      "variants": [
        {
          "wattage": "7W",
          "dimension": "60*70",
          "packing": "40",
          "price": 740
        },
        {
          "wattage": "12W",
          "dimension": "73*85",
          "packing": "40",
          "price": 960
        },
        {
          "wattage": "18W",
          "dimension": "87*100",
          "packing": "20",
          "price": 1420
        }
      ],
      "bodyColours": [
        "BK/GBK",
        "BK/RG",
        "WH/GBK",
        "WH/RG"
      ],
      "lightColours": [
        "Cool White",
        "Natural White",
        "Warm White",
        "3 In 1",
        "Dimmable-Tunable"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-MAGN-29",
      "name": "Magna",
      "category": "Surface",
      "categories": [
        "Surface"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 580,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-MAGN-29.webp",
      "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 10W / 15W. 85 × 85 × 65 mm / 75 × 75 × 70 mm. N/A. 3000k / 4000k / 6500k. N/A. 38°. >80. Aluminium Die-casting. N/A. BRASS GOLD / MESH BLACK. TM. Magna",
      "variants": [
        {
          "price": 580
        }
      ],
      "lightColours": [
        "Cool White",
        "Natural White",
        "Warm White",
        "3 In 1",
        "Dimmable-Tunable"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-STRI-30",
      "name": "Strip Light",
      "category": "Rope & Striped Light",
      "categories": [
        "Rope & Striped Light"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 106,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-STRI-30.webp",
      "description": "Strip 240LED-12V, sold by the metre in 500 m packing. Eco at Rs.106 per metre, pure copper at Rs.150. Warm, natural or cool white.",
      "variants": [
        {
          "wattage": "Eco",
          "packing": "500 METER",
          "pricePerMtr": 106
        },
        {
          "wattage": "Pure Copper",
          "packing": "500 METER",
          "pricePerMtr": 150
        }
      ],
      "lightColours": [
        "Cool White",
        "Natural White",
        "Warm White"
      ],
      "warranty": "1 Year (Eco Strip) / 2 Years (Pure Copper)"
    },
    {
      "id": "GLR-SLIM-31",
      "name": "Slim Panel",
      "category": "Panel",
      "categories": [
        "Panel"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 350,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-SLIM-31.webp",
      "description": "2 YEARS. UNIFORM ILLUMINATION.. EFFORTLESS COMFORT.. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 8W / 15W / 22W. 120 mm / 170 mm / 225 mm. 105 mm / 155 mm / 205 mm. 3000K / 4000K / 6500K. No. 110°. Metal. White. N/A. TM. Slim Panel",
      "variants": [
        {
          "wattage": "8W",
          "dimension": "120",
          "cutout": "105-105",
          "packing": "20",
          "price": 350
        },
        {
          "wattage": "15W",
          "dimension": "170",
          "cutout": "155-155",
          "packing": "20",
          "price": 530
        },
        {
          "wattage": "22W",
          "dimension": "225",
          "cutout": "205-205",
          "packing": "20",
          "price": 750
        }
      ],
      "lightColours": [
        "Cool White",
        "Natural White",
        "Warm White",
        "3 In 1",
        "Dimmable-Tunable"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-SURF-32",
      "name": "Surface Panel",
      "category": "Panel, Surface",
      "categories": [
        "Panel",
        "Surface"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 480,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-SURF-32.webp",
      "description": "2 YEARS. WHERE DESIGN MEETS LIGHT.. WHERE QUALITY LASTS.. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 8W / 15W / 22W. 120 mm / 170 mm / 225 mm. N/A. 3000K / 4000K / 6500K. No. 110°. >80. Metal. White. N/A. TM. Surface Panel",
      "variants": [
        {
          "wattage": "8W",
          "dimension": "120",
          "cutout": "-",
          "packing": "20",
          "price": 480
        },
        {
          "wattage": "15W",
          "dimension": "170",
          "cutout": "-",
          "packing": "20",
          "price": 720
        },
        {
          "wattage": "22W",
          "dimension": "225",
          "cutout": "-",
          "packing": "20",
          "price": 970
        }
      ],
      "lightColours": [
        "Cool White",
        "Natural White",
        "Warm White",
        "3 In 1",
        "Dimmable-Tunable"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-TRIM-33",
      "name": "Trimless Surface",
      "category": "Surface",
      "categories": [
        "Surface"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 430,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-TRIM-33.webp",
      "description": "2 YEARS. TM. MODERN FINISHES.. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 12W / 20W. 120 mm / 150 mm. N/A. 3000K / 4000K / 6500K. No. 180°. >80. Polycarbonate / Metal. White / Black ( Metal ). N/A. Trimless Surface",
      "variants": [
        {
          "wattage": "12W",
          "dimension": "120",
          "packing": "20",
          "price": 430
        },
        {
          "wattage": "20W",
          "dimension": "150",
          "packing": "20",
          "price": 560
        }
      ],
      "lightColours": [
        "Cool White",
        "Natural White",
        "Warm White",
        "3 In 1",
        "Dimmable-Tunable"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-TILE-34",
      "name": "Tile",
      "category": "Panel",
      "categories": [
        "Panel"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 580,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-TILE-34.webp",
      "description": "2 YEARS. TM. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 24W / 30W / 40W / 50W. 285 × 285 mm / 285 × 285 mm / 575 × 575 mm / 575 × 575 mm. 300 × 300 mm / 300 × 300 mm / 595 × 595 mm / 595 × 595 mm. 3000K / 4000K / 6500K. N/A. 120°. >80. Metal. White. N/A. Tile",
      "variants": [
        {
          "wattage": "8W",
          "dimension": "120",
          "cutout": "100-100",
          "packing": "40",
          "price": 320
        },
        {
          "wattage": "15W",
          "dimension": "175",
          "cutout": "150-150",
          "packing": "40",
          "price": 490
        },
        {
          "wattage": "22W",
          "dimension": "220",
          "cutout": "200-200",
          "packing": "20",
          "price": 720
        }
      ],
      "lightColours": [
        "Cool White",
        "Natural White",
        "Warm White",
        "3 In 1",
        "Dimmable-Tunable"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-STRI-35",
      "name": "Striker",
      "category": "Striker",
      "categories": [
        "Striker"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 120,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-STRI-35.webp",
      "description": "2 YEARS. BUILT TO LAST.. Wattage. Dimension. Roll Length. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 12V / 24V. 10MM. 5M. 3000K / 4000K / 6500K. N/A. N/A. >80. Pure copper / Aluminium Mix Copper. N/A. N/A. TM. Strip Light",
      "variants": [
        {
          "dimension": "58*14",
          "packing": "200",
          "price": 260,
          "wattage": "METAL(IP 65)"
        },
        {
          "dimension": "62*18",
          "packing": "200",
          "price": 120,
          "wattage": "PC"
        }
      ],
      "bodyColours": [
        "BLACK",
        "WHITE"
      ],
      "lightColours": [
        "Warm White"
      ],
      "warranty": "1 Year"
    },
    {
      "id": "GLR-SMPS-36",
      "name": "SMPS",
      "category": "Rope & Striped Light",
      "categories": [
        "Rope & Striped Light"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 370,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-SMPS-36.webp",
      "description": "2 YEARS. RELIABLE POWER.. CONSISTENT PERFORMANCE.. Wattage. Ampere. Roll length. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 12V / 24V. 3A / 5A / 10A / 16.7A / 25A. N/A. N/A. N/A. N/A. N/A. Aluminium. N/A. N/A. TM. SMPS",
      "variants": [
        {
          "dimension": "105*32*23",
          "packing": "50",
          "price": 370,
          "wattage": "12V/3A"
        },
        {
          "dimension": "130*32*23",
          "packing": "50",
          "price": 485,
          "wattage": "12V/5A"
        },
        {
          "dimension": "138*50*23",
          "packing": "50",
          "price": 630,
          "wattage": "12V/10A"
        },
        {
          "dimension": "178*50*23",
          "packing": "50",
          "price": 900,
          "wattage": "12V/16.7A"
        },
        {
          "dimension": "204*50*23",
          "packing": "50",
          "price": 1100,
          "wattage": "12V/25A"
        }
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-ROPE-37",
      "name": "Mello Rope",
      "category": "Rope & Striped Light",
      "categories": [
        "Rope & Striped Light"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 104,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-ROPE-37.webp",
      "description": "Mello Rope 2835-120LED. 11 mm thick, 50 m bundle, sold by the metre in 200 m packing. Warm, natural or cool white at Rs.104 per metre; blue, green, red, amber, pink or ice blue at Rs.108; multi at Rs.120.",
      "variants": [
        {
          "wattage": "2835-120LED",
          "packing": "200 METER",
          "pricePerMtr": 104
        }
      ],
      "lightColours": [
        "Warm White",
        "Natural White",
        "Cool White",
        "Blue",
        "Green",
        "Red",
        "Amber",
        "Pink",
        "Ice Blue",
        "Multi"
      ],
      "warranty": "1 Year",
      "lightColourPrice": {
        "Blue": 108,
        "Green": 108,
        "Red": 108,
        "Amber": 108,
        "Pink": 108,
        "Ice Blue": 108,
        "Multi": 120
      }
    },
    {
      "id": "GLR-PROF-38",
      "name": "Profile",
      "category": "Rope & Striped Light",
      "categories": [
        "Rope & Striped Light"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 140,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-PROF-38.webp",
      "description": "2 YEARS. MODERN FINISHES.. Variants. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. CONCEALED / SURFACE / CORNER / ROUND. 1M / 2M / CUSTOM. 17mm | 12 mm. N/A. No. N/A. N/A. Aluminium / Silicon. Aluminium Finish / Black / White. N/A. TM. Profile",
      "variants": [
        {
          "dimension": "17*7 MM (CONCEALED)",
          "cutout": "2M",
          "packing": "200 MTR",
          "pricePerMtr": 150,
          "wattage": "80 GM (CONCEALED)"
        },
        {
          "dimension": "12*7 MM (CONCEALED)",
          "cutout": "2M",
          "packing": "200 MTR",
          "pricePerMtr": 140,
          "wattage": "60 GM (CONCEALED)"
        }
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-MAGN-39",
      "name": "Magnetic",
      "category": "Track Light",
      "categories": [
        "Track Light"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 580,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-MAGN-39.webp",
      "description": "2 YEARS. TM. Variants. Dimension. Track. CCT (K). Power Supply. Track Dimension. CRI (Ra). Material. Body Color. Fixtures. SURFACE / CONCEALED. 5MM / 10MM / 16MM / 25MM SERIES. 1M / 2M /3M POP & SF. 3000K / 4000K / 6500K. 100W / 200W. L-1000 x W-26 x H-21 / L-2000 x W-26 x H-21 /L-3000 x W-26 x H-21. >80. Aluminium. Black / White. Linear / Profile / Track/ Pendent / Mini Rd/ Sq / Corner / Hose. Magnetic",
      "variants": [
        {
          "wattage": "100W",
          "price": 580
        },
        {
          "wattage": "200W",
          "price": 725
        }
      ],
      "lightColours": [
        "Cool White",
        "Natural White",
        "Warm White",
        "3 In 1",
        "Dimmable-Tunable"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-LINE-40",
      "name": "Linear Hanging",
      "category": "Surface",
      "categories": [
        "Surface"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 580,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-LINE-40.webp",
      "description": "2 YEARS. TM. Wattage. Dimension. CCT (K). Shapes. Link. CRI (Ra). Material. Body Color. 20W / 30W / 40W / 50W / 70W / 100W. 2ft /3ft /4ft / 6ft /8 Ft. 3000K / 4000K / 6500K / 3 in 1. As Per Choice. Linkable. >80. Aluminium. Black. Linear Hanging",
      "variants": [
        {
          "price": 580
        }
      ],
      "lightColours": [
        "Cool White",
        "Natural White",
        "Warm White",
        "3 In 1",
        "Dimmable-Tunable"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-KTYP-41",
      "name": "K-Type",
      "category": "Wall Light",
      "categories": [
        "Wall Light"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 650,
      "previewType": "street",
      "image": "/assets/images/products/GLR-KTYP-41.webp",
      "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. IP Rating. 3W / 6W. 75×75×35 mm / 145×75×60 mm. N/A. 3000k. No. N/A. N/A. Die Cast Aluminium. Sand Black. IP65. TM. K-Type",
      "variants": [
        {
          "wattage": "3W",
          "dimension": "75*75*35",
          "packing": "20",
          "price": 650
        },
        {
          "wattage": "6W",
          "dimension": "145*75*60",
          "packing": "20",
          "price": 760
        }
      ],
      "bodyColours": [
        "SAND BLACK"
      ],
      "lightColours": [
        "Warm White"
      ],
      "warranty": "1 Year"
    },
    {
      "id": "GLR-BALL-42",
      "name": "Ball Light",
      "category": "Wall Light",
      "categories": [
        "Wall Light"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 380,
      "previewType": "street",
      "image": "/assets/images/products/GLR-BALL-42.webp",
      "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. IP Rating. 2W/ 4W. 65×65×55 mm / 74×74×44 mm. N/A. 3000k / Auto RGBP. No. N/A. >80. Aluminium / Polycarbonate. Black. IP65. TM. Ball Light",
      "variants": [
        {
          "dimension": "65*65*55",
          "packing": "20",
          "price": 670,
          "wattage": "2 WAY"
        },
        {
          "dimension": "65*65*55",
          "packing": "20",
          "price": 680,
          "wattage": "4 WAY"
        },
        {
          "dimension": "74*74*44",
          "packing": "20",
          "price": 380,
          "wattage": "4 WAY PC"
        },
        {
          "dimension": "74*74*44",
          "packing": "20",
          "price": 620,
          "wattage": "4WAY AUTO RGBP",
          "lightColours": [
            "RGBP"
          ]
        }
      ],
      "bodyColours": [
        "BLACK"
      ],
      "lightColours": [
        "Warm White"
      ],
      "warranty": "1 Year"
    },
    {
      "id": "GLR-CURV-43",
      "name": "Curve Wall",
      "category": "Wall Light",
      "categories": [
        "Wall Light"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 360,
      "previewType": "street",
      "image": "/assets/images/products/GLR-CURV-43.webp",
      "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. IP Rating. 2W / 4 W / 6 W. 75×87×38 mm / 90×104×43 mm / 88×161×43 mm. N/A. 3000k. No. N/A. >80. Polycarbonate. Matt Black. IP65. TM. Curve Wall",
      "variants": [
        {
          "dimension": "75*87*38",
          "packing": "100",
          "price": 360,
          "wattage": "2 WAY"
        },
        {
          "dimension": "90*104*43",
          "packing": "100",
          "price": 440,
          "wattage": "4 WAY"
        },
        {
          "dimension": "88*161*43",
          "packing": "50",
          "price": 620,
          "wattage": "6 WAY"
        }
      ],
      "lightColours": [
        "Warm White"
      ],
      "warranty": "1 Year"
    },
    {
      "id": "GLR-CASE-44",
      "name": "Casette",
      "category": "Wall Light",
      "categories": [
        "Wall Light"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 1850,
      "previewType": "street",
      "image": "/assets/images/products/GLR-CASE-44.webp",
      "description": "2 YEARS. TM. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. IP Rating. 6W / 12W. 160*100*25 mm. N/A. 3000k. No. Up / Down. N/A. Die Cast Aluminium. Gloss Black. IP65. Casette",
      "variants": [
        {
          "price": 1850
        }
      ],
      "lightColours": [
        "Warm White"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-UPDO-45",
      "name": "Updown Wall",
      "category": "Wall Light",
      "categories": [
        "Wall Light"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 1850,
      "previewType": "street",
      "image": "/assets/images/products/GLR-UPDO-45.webp",
      "description": "2 YEARS. TM. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. IP Rating. 6W / 12W. 80*65*75mm / 155*65*75mm. N/A. 3000k. No. Up / Down. N/A. Die Cast Aluminium. Gloss Black. IP65. Updown Wall",
      "variants": [
        {
          "price": 1850
        }
      ],
      "lightColours": [
        "Warm White"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-RUBI-46",
      "name": "Rubik Square",
      "category": "Wall Light",
      "categories": [
        "Wall Light"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 1850,
      "previewType": "street",
      "image": "/assets/images/products/GLR-RUBI-46.webp",
      "description": "2 YEARS. TM. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. IP Rating. 6W. 110*110*85mm. N/A. 3000k. No. N/A. N/A. Acrylic. Black. IP65. Rubik Square",
      "variants": [
        {
          "price": 1850
        }
      ],
      "lightColours": [
        "Warm White"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-FOOT-47",
      "name": "Foot Lights",
      "category": "Foot Light",
      "categories": [
        "Foot Light"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 570,
      "previewType": "street",
      "image": "/assets/images/products/GLR-FOOT-47.webp",
      "description": "2 YEARS. Variants. Dimension. Fixture. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 2M / 4M. 85×85 mm. Wall Concealed / Surface. 3000k. No. N/A. >80. Die Cast Aluminium. Black/White. N/A. TM. Foot Lights",
      "variants": [
        {
          "wattage": "4W",
          "dimension": "85*85",
          "packing": "100",
          "price": 570
        }
      ],
      "bodyColours": [
        "BLACK",
        "WHITE"
      ],
      "lightColours": [
        "Warm White"
      ],
      "warranty": "1 Year"
    },
    {
      "id": "GLR-SPIK-48",
      "name": "Spike",
      "category": "Spike",
      "categories": [
        "Spike"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 700,
      "previewType": "street",
      "image": "/assets/images/products/GLR-SPIK-48.webp",
      "description": "2 YEARS. TM. BEAUTIFULLY.. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W. 50×70 mm / 70×80 mm. N/A. WW / WH / GREEN / RED / AMBER. No. Wide / Narrow. >80. Aluminium. Black. N/A. Spike",
      "variants": [
        {
          "wattage": "7W",
          "dimension": "50*70",
          "packing": "50",
          "price": 700
        },
        {
          "wattage": "12W",
          "dimension": "70*80",
          "packing": "20",
          "price": 800
        }
      ],
      "lightColours": [
        "Warm White"
      ],
      "warranty": "1 Year"
    },
    {
      "id": "GLR-WALL-49",
      "name": "Wall Washer",
      "category": "Wall Light",
      "categories": [
        "Wall Light"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 1850,
      "previewType": "street",
      "image": "/assets/images/products/GLR-WALL-49.webp",
      "description": "2 YEARS. TM. Wattage. Dimension. Voltage. CCT (K). Length. Beam Angle. CRI (Ra). Material. Body Color. Rating. 18W / 24W / 36W / 72W. 50*55*500mm / 50*55*990mm. 220V AC / 24V DC. WW / AMBER / GREEN / RED. 1 MTR / 0.5 MTR / CUSTOMISED. 10 Degree. >80. Aluminium. Black / Grey. IP 65. Wall Washer",
      "variants": [
        {
          "price": 1850
        }
      ],
      "lightColours": [
        "Warm White"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-INGR-50",
      "name": "Inground",
      "category": "Spike",
      "categories": [
        "Spike"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 1850,
      "previewType": "street",
      "image": "/assets/images/products/GLR-INGR-50.webp",
      "description": "2 YEARS. TM. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 3W / 6W / 9W / 12W. 65*65*75mm / 80*80*85mm. 32mm. WW. N/A. N/A. >80. Aluminium. Silver Chrome. N/A. Inground",
      "variants": [
        {
          "price": 1850
        }
      ],
      "lightColours": [
        "Warm White"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-SWIM-51",
      "name": "Swimming Pool",
      "category": "Spike",
      "categories": [
        "Spike"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 1850,
      "previewType": "street",
      "image": "/assets/images/products/GLR-SWIM-51.webp",
      "description": "2 YEARS. TM. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 3W / 9W / 12W / 18W. 85mm / 110mm / 135mm / 160mm. 60mm / 85mm / 110mm / 135mm. WW / WH. N/A. N/A. >80. Aluminium. Silver Chrome. N/A. Swimming Pool",
      "variants": [
        {
          "price": 1850
        }
      ],
      "lightColours": [
        "Warm White"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-GMFL-52",
      "name": "GM Flood",
      "category": "Flood",
      "categories": [
        "Flood"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 1500,
      "previewType": "street",
      "image": "/assets/images/products/GLR-GMFL-52.webp",
      "description": "2 YEARS. TM. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. IP Rating. 30W / 50W / 100W / 200W. 185×180×50 mm / 227×218×55 mm / 260×250×70 mm / 318×308×75 mm. N/A. 6500K. N/A. N/A. >80. Aluminium. Grey. IP66. GM Flood",
      "variants": [
        {
          "wattage": "30W",
          "dimension": "185*180*50",
          "packing": "30",
          "price": 1500
        },
        {
          "wattage": "50W",
          "dimension": "227*218*55",
          "packing": "16",
          "price": 1850
        },
        {
          "wattage": "100W",
          "dimension": "260*250*70",
          "packing": "10",
          "price": 2850
        },
        {
          "wattage": "200W",
          "dimension": "318*308*75",
          "packing": "5",
          "price": 5000
        }
      ],
      "lightColours": [
        "Cool White"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-SLIM-53",
      "name": "Slim Flood",
      "category": "Flood",
      "categories": [
        "Flood"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 1280,
      "previewType": "street",
      "image": "/assets/images/products/GLR-SLIM-53.webp",
      "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. IP Rating. 50W / 100W. 230*155 mm / 275*185 mm. N/A. 6500K. No. N/A. >80. Aluminum. Grey. IP66. TM. Slim Flood",
      "variants": [
        {
          "wattage": "50W",
          "dimension": "230*155",
          "packing": "30",
          "price": 1280
        },
        {
          "wattage": "100W",
          "dimension": "275*185",
          "packing": "18",
          "price": 1900
        },
        {
          "wattage": "200W",
          "dimension": "305*205",
          "packing": "18",
          "price": 3800
        }
      ],
      "lightColours": [
        "Cool White"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-HIBA-54",
      "name": "Hi-Bay",
      "category": "Flood",
      "categories": [
        "Flood"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 4500,
      "previewType": "street",
      "image": "/assets/images/products/GLR-HIBA-54.webp",
      "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. IP Rating. 100W / 150W / 200W. 315 × 145 × 175 mm / 315 × 145 × 175 mm / 377 × 145 × 260 mm. N/A. 6500k. N/A. N/A. >80. Aluminium. Matt Grey. IP66. TM. Hi-Bay",
      "variants": [
        {
          "price": 4500
        }
      ],
      "lightColours": [
        "Cool White"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-STRE-55",
      "name": "Street",
      "category": "Street",
      "categories": [
        "Street"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 3200,
      "previewType": "street",
      "image": "/assets/images/products/GLR-STRE-55.webp",
      "description": "2 YEARS. EVERY NIGHT.. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. IP Rating. 24W / 36W / 50W. 275×120×55 mm / 315×135×55 mm / 360×170×55 mm. N/A. 6500K. No. N/A. >80. Aluminium. Grey. IP66. TM. Street",
      "variants": [
        {
          "price": 3200
        }
      ],
      "lightColours": [
        "Cool White"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-SOLA-56",
      "name": "Solar Street",
      "category": "Solar, Street",
      "categories": [
        "Solar",
        "Street"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 3400,
      "previewType": "street",
      "image": "/assets/images/products/GLR-SOLA-56.webp",
      "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. IP Rating. 70W / 120W. 275×120×55 mm / 315×135×55 mm / 360×170×55 mm. N/A. 6500K. No. N/A. >80. Aluminium. Black. IP66. TM. Solar Street",
      "variants": [
        {
          "wattage": "70W",
          "dimension": "216*186*43",
          "packing": "20",
          "price": 3400
        },
        {
          "wattage": "120W",
          "dimension": "277*266*40",
          "packing": "10",
          "price": 4800
        }
      ],
      "lightColours": [
        "Cool White"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-AURA-57",
      "name": "Aura Max",
      "category": "Gate Light",
      "categories": [
        "Gate Light"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 2160,
      "previewType": "street",
      "image": "/assets/images/products/GLR-AURA-57.webp",
      "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 24W. 258 × 258 × 267 mm. N/A. WW. N/A. N/A. >80. Polycarbonate. Black. N/A. TM. Aura Max",
      "variants": [
        {
          "wattage": "24W",
          "dimension": "258*258*267",
          "packing": "12",
          "price": 2160
        }
      ],
      "lightColours": [
        "Warm White"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-VIST-58",
      "name": "Vista",
      "category": "Gate Light",
      "categories": [
        "Gate Light"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 1700,
      "previewType": "street",
      "image": "/assets/images/products/GLR-VIST-58.webp",
      "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 20W. 290 x 138 x 270 mm. N/A. WW. No. N/A. >80. Polycarbonate. Grey. N/A. TM. Vista",
      "variants": [
        {
          "wattage": "20W",
          "dimension": "290*138*270",
          "packing": "12",
          "price": 1700
        }
      ],
      "lightColours": [
        "Warm White"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-CUBE-59",
      "name": "Cubex",
      "category": "Gate Light",
      "categories": [
        "Gate Light"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 1300,
      "previewType": "street",
      "image": "/assets/images/products/GLR-CUBE-59.webp",
      "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 20W. 150×150*150 mm. N/A. WW. No. N/A. >80. Polycarbonate. Black. N/A. TM. Cubex",
      "variants": [
        {
          "wattage": "20W",
          "dimension": "151*151*145",
          "packing": "12",
          "price": 1300
        }
      ],
      "lightColours": [
        "Warm White"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-CUBE-60",
      "name": "Cube",
      "category": "Gate Light",
      "categories": [
        "Gate Light"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 1140,
      "previewType": "street",
      "image": "/assets/images/products/GLR-CUBE-60.webp",
      "description": "2 YEARS. TM. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 20W. 151 x 151 x 145 mm. N/A. WW. No. N/A. >80. Polycarbonate. Black. N/A. Cube",
      "variants": [
        {
          "wattage": "20W",
          "dimension": "151*151*145",
          "packing": "12",
          "price": 1140
        }
      ],
      "lightColours": [
        "Warm White"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-MASH-61",
      "name": "Mashal",
      "category": "Gate Light",
      "categories": [
        "Gate Light"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 900,
      "previewType": "street",
      "image": "/assets/images/products/GLR-MASH-61.webp",
      "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. Holder Based (No LED). 315×145×45 mm. N/A. According to LED bulb. No. N/A. N/A. Polycarbonate. Black. N/A. TM. Mashal",
      "variants": [
        {
          "dimension": "315*145*45",
          "packing": "12",
          "price": 900,
          "wattage": "LED"
        }
      ],
      "lightColours": [
        "Warm White"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-FREE-62",
      "name": "Freedom",
      "category": "Gate Light",
      "categories": [
        "Gate Light"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 1640,
      "previewType": "street",
      "image": "/assets/images/products/GLR-FREE-62.webp",
      "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 20W. 275×120×55 mm. N/A. 3000k / 6500k. No. N/A. >80. Polycarbonate. Black. N/A. TM. Freedom",
      "variants": [
        {
          "wattage": "20W",
          "dimension": "160*230*65",
          "packing": "12",
          "price": 1640
        }
      ],
      "lightColours": [
        "Warm White"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-RUBI-63",
      "name": "Rubik",
      "category": "Gate Light",
      "categories": [
        "Gate Light"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 1850,
      "previewType": "street",
      "image": "/assets/images/products/GLR-RUBI-63.webp",
      "description": "2 YEARS. TM. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 12W. 130*130*120mm. N/A. 3000k / 6500k. No. N/A. >80. Aluminium with PC Diffuser. Sand Black. N/A. Rubik",
      "variants": [
        {
          "price": 1850
        }
      ],
      "lightColours": [
        "Warm White"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-TEMP-64",
      "name": "Temple",
      "category": "Gate Light",
      "categories": [
        "Gate Light"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 1850,
      "previewType": "street",
      "image": "/assets/images/products/GLR-TEMP-64.webp",
      "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 15W. 200MM / 300MM. 3000k / 6500k. N/A. N/A. >80. Aluminium. Grey. N/A. N/A. TM. Temple",
      "variants": [
        {
          "price": 1850
        }
      ],
      "lightColours": [
        "Warm White"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-LEGA-65",
      "name": "Legacy",
      "category": "Gate Light",
      "categories": [
        "Gate Light"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 1850,
      "previewType": "street",
      "image": "/assets/images/products/GLR-LEGA-65.webp",
      "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 15W. 200MM / 300MM. 3000k / 6500k. N/A. N/A. >80. Aluminium. Grey. N/A. N/A. TM. Legacy",
      "variants": [
        {
          "price": 1850
        }
      ],
      "lightColours": [
        "Warm White"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-FOUR-66",
      "name": "Four Pillar",
      "category": "Gate Light",
      "categories": [
        "Gate Light"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 1850,
      "previewType": "street",
      "image": "/assets/images/products/GLR-FOUR-66.webp",
      "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 15W. 300 mm / 600 mm / 900 mm. N/A. 3000k / 6500k. N/A. N/A. >80. Alluminium. Grey. N/A. TM. Four Pillar",
      "variants": [
        {
          "price": 1850
        }
      ],
      "lightColours": [
        "Warm White"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-SQUA-67",
      "name": "Square",
      "category": "Gate Light",
      "categories": [
        "Gate Light"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 1850,
      "previewType": "street",
      "image": "/assets/images/products/GLR-SQUA-67.webp",
      "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 15W. 300 mm / 600 mm / 900 mm. N/A. 3000k / 6500k. N/A. N/A. >80. Alluminium. Grey. N/A. TM. Square. BEAUTIFULLY.",
      "variants": [
        {
          "price": 1850
        }
      ],
      "lightColours": [
        "Warm White"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-RING-68",
      "name": "Ring",
      "category": "Gate Light",
      "categories": [
        "Gate Light"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 1850,
      "previewType": "street",
      "image": "/assets/images/products/GLR-RING-68.webp",
      "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 15W. 300 mm / 600 mm / 900 mm. N/A. 3000k / 6500k. N/A. N/A. >80. Alluminium. Grey. N/A. TM. Ring",
      "variants": [
        {
          "price": 1850
        }
      ],
      "lightColours": [
        "Warm White"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-ROUN-69",
      "name": "Round",
      "category": "Gate Light",
      "categories": [
        "Gate Light"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 1850,
      "previewType": "street",
      "image": "/assets/images/products/GLR-ROUN-69.webp",
      "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 15W. 300 mm / 600 mm / 900 mm. N/A. 3000k / 6500k. N/A. N/A. >80. Alluminium. Grey. N/A. TM. Round",
      "variants": [
        {
          "price": 1850
        }
      ],
      "lightColours": [
        "Warm White"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-OVAL-70",
      "name": "Oval",
      "category": "Gate Light",
      "categories": [
        "Gate Light"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 1850,
      "previewType": "street",
      "image": "/assets/images/products/GLR-OVAL-70.webp",
      "description": "2 YEARS. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 15W. 300 mm / 600 mm / 900 mm. N/A. 3000k / 6500k. N/A. N/A. >80. Alluminium. Grey. N/A. TM. Oval",
      "variants": [
        {
          "price": 1850
        }
      ],
      "lightColours": [
        "Warm White"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-PCTR-71",
      "name": "PC Track",
      "category": "Track Light",
      "categories": [
        "Track Light"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 210,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-TRAC-24.webp",
      "description": "PC Track. Sold by length in 1 m and 2 m sections, at Rs.210 per metre. Body colour black or white.",
      "bodyColours": [
        "BLACK",
        "WHITE"
      ],
      "variants": [
        {
          "wattage": "1M",
          "packing": "100",
          "price": 210
        },
        {
          "wattage": "2M",
          "packing": "100",
          "price": 420
        }
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-METR-72",
      "name": "Metal Track",
      "category": "Track Light",
      "categories": [
        "Track Light"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 350,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-TRAC-24.webp",
      "description": "Metal Track. Sold by length in 1 m and 2 m sections, at Rs.350 per metre. Body colour black or white.",
      "bodyColours": [
        "BLACK",
        "WHITE"
      ],
      "variants": [
        {
          "wattage": "1M",
          "packing": "50",
          "price": 350
        },
        {
          "wattage": "2M",
          "packing": "50",
          "price": 700
        }
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-LUXC-73",
      "name": "Lux Concealed",
      "category": "Concealed",
      "categories": [
        "Concealed"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 340,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-CONC-23.webp",
      "description": "Lux Concealed 7W. 108*53 mm, 70 mm cut-out. Warm white or cool white.",
      "lightColours": [
        "Warm White",
        "Cool White"
      ],
      "variants": [
        {
          "wattage": "7W",
          "dimension": "108*53",
          "cutout": "70",
          "packing": "100",
          "price": 340
        }
      ],
      "warranty": "1 Year"
    },
    {
      "id": "GLR-RCRD-74",
      "name": "Rope Cord",
      "category": "Rope & Striped Light",
      "categories": [
        "Rope & Striped Light"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 120,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-ROPE-37.webp",
      "description": "The cord that drives a Mello Rope run. Regular, or the 6-in-1 multi controller for the colour-changing rope.",
      "warranty": "1 Year",
      "variants": [
        {
          "wattage": "Regular",
          "packing": "100",
          "price": 120
        },
        {
          "wattage": "Multi Controller (6 in 1)",
          "packing": "100",
          "price": 170
        }
      ]
    },
    {
      "id": "GLR-NIVO-75",
      "name": "Nivo",
      "category": "COB",
      "categories": [
        "COB"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 1400,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-NIVO-75.webp",
      "description": "TM. Nivo. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 8W / 12W / 15W. 63×78 mm / 73×80 mm / 83×81 mm. 55 mm / 65 mm / 75 mm. 3000k / 4000k / 6500k. Available. 38°. >80. Aluminium Die-casting. BK / WH. N/A. 2 YEARS",
      "variants": [
        {
          "wattage": "8W",
          "dimension": "63*78",
          "cutout": "55",
          "price": 1400
        },
        {
          "wattage": "12W",
          "dimension": "73*80",
          "cutout": "65",
          "price": 1640
        },
        {
          "wattage": "15W",
          "dimension": "83*81",
          "cutout": "75",
          "price": 2240
        }
      ],
      "bodyColours": [
        "BK",
        "WH"
      ],
      "lightColours": [
        "Cool White",
        "Natural White",
        "Warm White",
        "3 In 1",
        "Dimmable-Tunable"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-PLUT-76",
      "name": "Pluto",
      "category": "COB",
      "categories": [
        "COB"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 1300,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-PLUT-76.webp",
      "description": "TM. Pluto. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 18W. 43×65 mm / 63×94 mm / 83×103 mm. 35 mm / 55 mm / 75 mm. 3000k / 4000k / 6500k. Available. 38°. >80. Aluminium Die-casting. WH / BK. N/A. 2 YEARS",
      "variants": [
        {
          "wattage": "7W",
          "dimension": "43*65",
          "cutout": "35",
          "price": 1300
        },
        {
          "wattage": "12W",
          "dimension": "63*94",
          "cutout": "55",
          "price": 1720
        },
        {
          "wattage": "18W",
          "dimension": "83*103",
          "cutout": "75",
          "price": 2600
        }
      ],
      "bodyColours": [
        "WH",
        "BK"
      ],
      "lightColours": [
        "Cool White",
        "Natural White",
        "Warm White",
        "3 In 1",
        "Dimmable-Tunable"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-TERA-77",
      "name": "Tera",
      "category": "COB",
      "categories": [
        "COB"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 1200,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-TERA-77.webp",
      "description": "TM. Tera. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 10W / 12W / 15W. 52×71 mm / 62×80 mm / 72×90 mm / 82×90 mm. 45 mm / 55 mm / 65 mm / 75 mm. 3000k / 4000k / 6500k. Available. 38°. >80. Aluminium Die-casting. WH / BK. N/A. 2 YEARS",
      "variants": [
        {
          "wattage": "7W",
          "dimension": "52*71",
          "cutout": "45",
          "price": 1200
        },
        {
          "wattage": "10W",
          "dimension": "62*80",
          "cutout": "55",
          "price": 1400
        },
        {
          "wattage": "12W",
          "dimension": "72*90",
          "cutout": "65",
          "price": 1540
        },
        {
          "wattage": "15W",
          "dimension": "82*90",
          "cutout": "75",
          "price": 1740
        }
      ],
      "bodyColours": [
        "WH",
        "BK"
      ],
      "lightColours": [
        "Cool White",
        "Natural White",
        "Warm White",
        "3 In 1",
        "Dimmable-Tunable"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-MIRA-78",
      "name": "Mirage",
      "category": "COB",
      "categories": [
        "COB"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 1220,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-MIRA-78.webp",
      "description": "TM. Mirage. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 18W. 35×75 mm / 45×90 mm / 55×120 mm. 30 mm / 40 mm / 50 mm. 3000k / 4000k / 6500k. Available. 38°. >80. Aluminium Die-casting. MW / MB / SATIN BLACK. N/A. 2 YEARS",
      "variants": [
        {
          "wattage": "7W",
          "dimension": "35*75",
          "cutout": "30",
          "price": 1220
        },
        {
          "wattage": "12W",
          "dimension": "45*90",
          "cutout": "40",
          "price": 1520
        },
        {
          "wattage": "18W",
          "dimension": "55*120",
          "cutout": "50",
          "price": 1880
        }
      ],
      "bodyColours": [
        "MW",
        "MB",
        "SATIN BLACK"
      ],
      "lightColours": [
        "Cool White",
        "Natural White",
        "Warm White",
        "3 In 1",
        "Dimmable-Tunable"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-AERO-79",
      "name": "Aero",
      "category": "COB",
      "categories": [
        "COB"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 1160,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-AERO-79.webp",
      "description": "TM. Aero. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 18W. 62×80 mm / 72×80 mm / 82×80 mm. 57 mm / 67 mm / 77 mm. 3000k / 4000k / 6500k. Available. 38°. >80. Aluminium Die-casting. MW / MB / SATIN BLACK / BRASS. N/A. 2 YEARS",
      "variants": [
        {
          "wattage": "7W",
          "dimension": "62*80",
          "cutout": "57",
          "price": 1160
        },
        {
          "wattage": "12W",
          "dimension": "72*80",
          "cutout": "67",
          "price": 1380
        },
        {
          "wattage": "18W",
          "dimension": "82*80",
          "cutout": "77",
          "price": 1760
        }
      ],
      "bodyColours": [
        "MW",
        "MB",
        "SATIN BLACK",
        "BRASS"
      ],
      "lightColours": [
        "Cool White",
        "Natural White",
        "Warm White",
        "3 In 1",
        "Dimmable-Tunable"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-CRES-80",
      "name": "Cresta",
      "category": "COB",
      "categories": [
        "COB"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 1020,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-CRES-80.webp",
      "description": "TM. Cresta. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 18W. 50×60 mm / 55×70 mm / 70×90 mm. 55 mm / 70 mm / 80 mm. 3000k / 4000k / 6500k. Available. 38°. >80. Aluminium Die-casting. MW / MB. N/A. 2 YEARS",
      "variants": [
        {
          "wattage": "7W",
          "dimension": "50*60",
          "cutout": "55",
          "price": 1020
        },
        {
          "wattage": "12W",
          "dimension": "55*70",
          "cutout": "70",
          "price": 1320
        },
        {
          "wattage": "18W",
          "dimension": "70*90",
          "cutout": "80",
          "price": 1560
        }
      ],
      "bodyColours": [
        "MW",
        "MB"
      ],
      "lightColours": [
        "Cool White",
        "Natural White",
        "Warm White",
        "3 In 1",
        "Dimmable-Tunable"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-GALA-81",
      "name": "Galaxy",
      "category": "COB",
      "categories": [
        "COB"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 900,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-GALA-81.webp",
      "description": "TM. Galaxy. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 7W / 12W / 18W. 39×52 mm / 60×63 mm / 80×73 mm. 35 mm / 55 mm / 75 mm. 3000k / 4000k / 6500k. Available. 38°. >80. Aluminium Die-casting. MW / MB / WH+GREY / GD / GB. N/A. 2 YEARS",
      "variants": [
        {
          "wattage": "7W",
          "dimension": "39*52",
          "cutout": "35",
          "price": 900
        },
        {
          "wattage": "12W",
          "dimension": "60*63",
          "cutout": "55",
          "price": 1300
        },
        {
          "wattage": "18W",
          "dimension": "80*73",
          "cutout": "75",
          "price": 1840
        }
      ],
      "bodyColours": [
        "MW",
        "MB",
        "WH/GREY",
        "GD",
        "GB"
      ],
      "lightColours": [
        "Cool White",
        "Natural White",
        "Warm White",
        "3 In 1",
        "Dimmable-Tunable"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-LINS-82",
      "name": "Linea - S",
      "category": "COB",
      "categories": [
        "COB"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 1620,
      "previewType": "panel",
      "image": "/assets/images/products/GLR-LINS-82.webp",
      "description": "TM. Linea - S. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. Beam Angle. CRI (Ra). Material. Body Color. Reflector. 12W / 24W. 135×35×55 mm / 270×35×55 mm. N/A. 3000k / 4000k / 6500k. N/A. 24°. >80. Aluminium Die-casting. PKW / BK. MW / MB. 2 YEARS",
      "variants": [
        {
          "wattage": "12W",
          "dimension": "135*35*55",
          "price": 1620
        },
        {
          "wattage": "24W",
          "dimension": "270*35*55",
          "price": 2150
        }
      ],
      "bodyColours": [
        "PKW",
        "BK"
      ],
      "lightColours": [
        "Cool White",
        "Natural White",
        "Warm White",
        "3 In 1",
        "Dimmable-Tunable"
      ],
      "warranty": "2 Years"
    },
    {
      "id": "GLR-LEAF-83",
      "name": "Leaf Street",
      "category": "Street",
      "categories": [
        "Street"
      ],
      "status": "In Stock",
      "stock": 100,
      "price": 3200,
      "previewType": "street",
      "image": "/assets/images/products/GLR-LEAF-83.webp",
      "description": "2 YEARS. Leaf Street. Wattage. Dimension. Cut Out. CCT (K). Tunable/Dimmable. CRI (Ra). Material. Body Color. IP Rating. 24W / 36W / 50W. 275×120×55 mm / 315×135×55 mm / 360×170×55 mm. N/A. 6500K. No. >80. Aluminium Die-casting. Grey. IP66. TM. Leaf Street",
      "variants": [
        {
          "price": 3200
        }
      ],
      "lightColours": [
        "Cool White"
      ],
      "warranty": "2 Years"
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

  /**
   * Reconciles a stored product with the 1 July 2026 catalogue.
   *
   * Everything here is a correction the printed sheet settles, so it runs for
   * every product rather than a listed few:
   *
   *   - Striker and Strip Light had each other's names. The rates and options
   *     under them were right; only the names were crossed, which meant a
   *     quotation could print "Strip Light" over a Striker's price.
   *   - Movable no longer lists 7W or 30W.
   *   - The finish moves off the option and onto the product, where it is now
   *     chosen from. The sheet's own BODY COLOUR column wins; where it is
   *     silent, whatever the old free-text cell said is parsed across, so a
   *     product the sheet does not cover keeps the finishes it had.
   *   - `model`, `colorSize` and `bodyColour` come off the option for good.
   *
   * Returns true when the document still needs the change saved.
   */
  private applyCatalogue2026(p: Product): boolean {
    if (p.catalogue2026) return false;

    if (p.id === 'GLR-STRI-30' && p.name === 'Striker') p.name = 'Strip Light';
    else if (p.id === 'GLR-STRI-35' && p.name === 'Strip Light') p.name = 'Striker';

    if (p.id === 'GLR-MOVA-15' && p.variants) {
      p.variants = p.variants.filter(v => {
        const w = String(v.wattage || '').trim().toUpperCase();
        return w !== '7W' && w !== '30W';
      });
    }

    const def = this.defaultProducts.find(dp => dp.id === p.id);
    if (def?.bodyColours?.length) {
      p.bodyColours = [...def.bodyColours];
    } else if (!p.bodyColours?.length) {
      // Nothing printed for it: keep whatever the option used to say.
      const gathered: string[] = [];
      for (const v of (p.variants || [])) {
        gathered.push(...parseBodyColours((v as { bodyColour?: string }).bodyColour));
      }
      const seen = new Set<string>();
      const kept: string[] = [];
      for (const c of gathered) {
        const k = c.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        kept.push(c);
      }
      if (kept.length) p.bodyColours = kept;
    }

    for (const v of (p.variants || [])) {
      const loose = v as { model?: string; colorSize?: string; bodyColour?: string };
      delete loose.model;
      delete loose.colorSize;
      delete loose.bodyColour;
    }

    p.catalogue2026 = true;
    return true;
  }

  /**
   * Re-derives the finishes under the corrected cross-product reading.
   *
   * Only the products the price sheet actually prints a BODY COLOUR column for
   * are touched, and the list is taken from the seed — which is derived from
   * that column. A product the sheet is silent about keeps whatever it has:
   * the free text it was originally read from is gone by now, so re-deriving
   * it is not possible and guessing would be worse than leaving it.
   *
   * Returns true when the document still needs the change saved.
   */
  private applyBodyColoursV2(p: Product): boolean {
    if (p.bodyColoursV2) return false;
    const def = this.defaultProducts.find(dp => dp.id === p.id);
    if (def?.bodyColours?.length) p.bodyColours = [...def.bodyColours];
    p.bodyColoursV2 = true;
    return true;
  }

  /**
   * The finishes the July 2026 catalogue prints for the ranges whose stored
   * product carried none — read straight off each page's BODY COLOUR row,
   * crossed with its REFLECTOR row the way the sheet is meant to be read (see
   * parseBodyColours): "BK/WH" against "GBK/RGD/GD/CH" is the eight
   * combinations, not two. A range already listing its finishes is not here;
   * this only fills the blanks, so nothing already set is overwritten.
   */
  private static readonly BODY_COLOURS_V3: { [id: string]: string[] } = {
    'GLR-GLAR-6': ['MW', 'MB', 'RG', 'SILVER', 'GB'],
    'GLR-DELT-7': ['BK/GBK', 'BK/RGD', 'BK/GD', 'BK/CH', 'WH/GBK', 'WH/RGD', 'WH/GD', 'WH/CH'],
    'GLR-VOGU-8': ['MW', 'MB'],
    'GLR-GLON-9': ['MW', 'MB', 'RG', 'SB', 'ANTIQUE BRASS'],
    'GLR-ELEG-10': ['White', 'Black'],
    'GLR-ORBI-11': ['White', 'Black'],
    'GLR-PRIS-12': ['BK/RGD', 'BK/GBK', 'WH/RGD', 'WH/GBK'],
    'GLR-DUO-13': ['Black', 'White'],
    'GLR-DUOR-14': ['MW/GBK', 'MW/RG', 'MW/WH', 'BK/GBK', 'BK/RG', 'BK/WH'],
    'GLR-PULL-16': ['BK', 'WH'],
    'GLR-LINE-17': ['PKW/MW', 'PKW/MB', 'PKW/RG', 'PKW/GB', 'BK/MW', 'BK/MB', 'BK/RG', 'BK/GB'],
    'GLR-DEEP-19': ['White', 'Black'],
    'GLR-NEXU-21': ['PKW/WH', 'PKW/SB', 'PKW/RG', 'PKW/MB', 'PKW/MW', 'BK/WH', 'BK/SB', 'BK/RG', 'BK/MB', 'BK/MW'],
    'GLR-NOVA-22': ['PKW', 'BK'],
    'GLR-CONC-23': ['White'],
    'GLR-TRAC-25': ['MW', 'MB'],
    'GLR-STRE-26': ['PKW', 'BK'],
    'GLR-MOVA-27': ['MW/GBK', 'MW/RG', 'MB/GBK', 'MB/RG'],
    'GLR-MAGN-29': ['BRASS GOLD', 'MESH BLACK'],
    'GLR-SLIM-31': ['White'],
    'GLR-SURF-32': ['White'],
    'GLR-TRIM-33': ['White', 'Black'],
    'GLR-TILE-34': ['White'],
    'GLR-PROF-38': ['Aluminium Finish', 'Black', 'White'],
    'GLR-MAGN-39': ['Black', 'White'],
    'GLR-LINE-40': ['Black'],
    'GLR-CURV-43': ['Matt Black'],
    'GLR-CASE-44': ['Gloss Black'],
    'GLR-UPDO-45': ['Gloss Black'],
    'GLR-RUBI-46': ['Black'],
    'GLR-SPIK-48': ['Black'],
    'GLR-WALL-49': ['Black', 'Grey'],
    'GLR-INGR-50': ['Silver Chrome'],
    'GLR-SWIM-51': ['Silver Chrome'],
    'GLR-GMFL-52': ['Grey'],
    'GLR-SLIM-53': ['Grey'],
    'GLR-HIBA-54': ['Matt Grey'],
    'GLR-STRE-55': ['Grey'],
    'GLR-SOLA-56': ['Black'],
    'GLR-AURA-57': ['Black'],
    'GLR-VIST-58': ['Grey'],
    'GLR-CUBE-59': ['Black'],
    'GLR-CUBE-60': ['Black'],
    'GLR-MASH-61': ['Black'],
    'GLR-FREE-62': ['Black'],
    'GLR-RUBI-63': ['Sand Black'],
    'GLR-TEMP-64': ['Grey'],
    'GLR-LEGA-65': ['Grey'],
    'GLR-FOUR-66': ['Grey'],
    'GLR-SQUA-67': ['Grey'],
    'GLR-RING-68': ['Grey'],
    'GLR-ROUN-69': ['Grey'],
    'GLR-OVAL-70': ['Grey'],
    'GLR-LUXC-73': ['White'],
  };

  /**
   * Fills in the finishes for a range that had none, from the catalogue map
   * above. Never touches a product that already lists finishes.
   *
   * Returns true when the document still needs the change saved.
   */
  private applyBodyColoursV3(p: Product): boolean {
    if (p.bodyColoursV3) return false;
    const add = ProductService.BODY_COLOURS_V3[p.id];
    if (add && !(p.bodyColours && p.bodyColours.length)) {
      p.bodyColours = [...add];
    }
    p.bodyColoursV3 = true;
    return true;
  }

  /**
   * Folds an option's `type` into its `wattage`, and drops the field.
   *
   * Returns true when the document still needs the change saved.
   */
  private applyOptionFieldMerge(p: Product): boolean {
    if (p.optionFieldMerged) return false;
    for (const v of (p.variants || [])) {
      const loose = v as { type?: string; wattage?: string };
      const type = (loose.type || '').trim();
      const wattage = (loose.wattage || '').trim();
      if (type && !wattage) loose.wattage = type;
      delete loose.type;
    }
    // Two Rope Light rows were never named in either field, so they would show
    // as a blank option. The sheet names them.
    if (p.id === 'GLR-ROPE-37') {
      for (const v of (p.variants || [])) {
        if ((v.wattage || '').trim()) continue;
        if (v.price === 120) v.wattage = 'ROPE CORD';
        else if (v.price === 170) v.wattage = 'MULTI CONTROLLER (6 IN 1)';
      }
    }
    p.optionFieldMerged = true;
    return true;
  }

  /**
   * Puts the catalogue's shades onto a stored product.
   *
   * Taken from the seed, which holds the assignment, so there is one rule
   * rather than two. A product the seed does not know — one an admin added —
   * is left exactly as it is. Two products also have their category corrected
   * here: the Striker / Strip Light name swap left each pointing at the
   * other's category.
   *
   * Returns true when the document still needs the change saved.
   */
  private applyLightColours2026(p: Product): boolean {
    if (p.lightColours2026) return false;
    const def = this.defaultProducts.find(dp => dp.id === p.id);
    if (!def) return false;
    if (def.lightColours?.length) p.lightColours = [...def.lightColours];
    else delete p.lightColours;
    if (def.categories?.length) {
      p.categories = [...def.categories];
      p.category = def.categories.join(', ');
    }
    p.lightColours2026 = true;
    return true;
  }

  /**
   * Takes the rail rows off the tracklight. The rail is its own product now.
   *
   * Returns true when the document still needs the change saved.
   */
  private applyTrackSplit(p: Product): boolean {
    if (p.trackSplit) return false;
    if (p.id !== 'GLR-TRAC-24') { p.trackSplit = true; return true; }
    const before = (p.variants || []).length;
    p.variants = (p.variants || []).filter(v => !/\dM\b/i.test(String(v.wattage || '').trim()));
    p.trackSplit = true;
    return before !== p.variants.length || true;
  }

  /**
   * The catalogue tidy-up, on a stored product.
   *
   * Categories, name, options and shades are taken from the seed for the few
   * products the sheet settles — Mashal is a gate light, Streak is the Leaf
   * Street fitting, and Concealed is two products rather than one with four
   * rows that all read "7W". Every product, seeded or not, also has the
   * import's "DimensionW" labels cleared: a blank option reads as "Option 1"
   * on a card, which is honest, where the junk read as a real choice.
   *
   * Returns true when the document still needs the change saved.
   */
  private applyCatalogueTidy(p: Product): boolean {
    if (p.catalogueTidy) return false;

    const RESHAPED = ['GLR-MASH-61', 'GLR-STRE-26', 'GLR-CONC-23'];
    if (RESHAPED.includes(p.id)) {
      const def = this.defaultProducts.find(dp => dp.id === p.id);
      if (def) {
        p.name = def.name;
        p.categories = def.categories ? [...def.categories] : p.categories;
        p.category = (def.categories || []).join(', ') || p.category;
        p.variants = def.variants ? JSON.parse(JSON.stringify(def.variants)) : p.variants;
        if (def.lightColours) p.lightColours = [...def.lightColours];
        if (def.lightColourPrice) p.lightColourPrice = { ...def.lightColourPrice };
        if (def.price != null) p.price = def.price;
        if (def.description) p.description = def.description;
      }
    }

    for (const v of (p.variants || [])) {
      if (/dimension/i.test(String(v.wattage || ''))) delete v.wattage;
    }

    p.catalogueTidy = true;
    return true;
  }

  /** Products superseded by a catalogue one, removed on sight. */
  private static readonly SUPERSEDED = new Set([
    'GLR-MSYMX7N4-2779',   // "Track Patti - PC"     -> GLR-PCTR-71 PC Track
    'GLR-MSYNTUCV-2363',   // "Track Patti - Metal " -> GLR-METR-72 Metal Track
  ]);

  /**
   * Puts the sheet's warranty on a stored product.
   *
   * Two years unless the seed says otherwise, which it does for the ten
   * products whose own table carries a note.
   *
   * Returns true when the document still needs the change saved.
   */
  private applyWarranty(p: Product): boolean {
    if (p.warrantySet) return false;
    const def = this.defaultProducts.find(dp => dp.id === p.id);
    p.warranty = def?.warranty || p.warranty || '2 Years';
    p.warrantySet = true;
    return true;
  }

  /**
   * Re-reads the rope and the strip from the seed.
   *
   * Returns true when the document still needs the change saved.
   */
  private applyRopeStripFix(p: Product): boolean {
    if (p.ropeStripFixed) return false;
    if (p.id === 'GLR-ROPE-37' || p.id === 'GLR-STRI-30') {
      const def = this.defaultProducts.find(dp => dp.id === p.id);
      if (def) {
        p.name = def.name;
        p.variants = def.variants ? JSON.parse(JSON.stringify(def.variants)) : p.variants;
        if (def.lightColours) p.lightColours = [...def.lightColours];
        if (def.lightColourPrice) p.lightColourPrice = { ...def.lightColourPrice };
        else delete p.lightColourPrice;
        if (def.price != null) p.price = def.price;
        if (def.description) p.description = def.description;
      }
    }
    p.ropeStripFixed = true;
    return true;
  }

  /**
   * Gives the ball light's auto option the shade it actually cycles.
   *
   * Returns true when the document still needs the change saved.
   */
  private applyBallRgbp(p: Product): boolean {
    if (p.ballRgbpFixed) return false;
    if (p.id === 'GLR-BALL-42') {
      for (const v of (p.variants || [])) {
        if (/RGBP/i.test(String(v.wattage || ''))) v.lightColours = ['RGBP'];
      }
    }
    p.ballRgbpFixed = true;
    return true;
  }

  /**
   * The per-wattage rates from the August 2026 hand-written price sheet.
   *
   * The office finally wrote out what each wattage costs — the sheet the repo
   * had always lacked, which is why every one of these ranges shipped with a
   * single placeholder option at one headline price. Each entry is the full
   * option list the sheet prices, one row per wattage. Ranges the sheet leaves
   * blank (Elegance, Prism, Track Wall's upper wattages, the outdoor pages) are
   * not here and keep what they had.
   */
  private static readonly PRICE_SHEET_2026: { [id: string]: ProductVariant[] } = {
    'GLR-GLAR-6':  [{ wattage: '7W', dimension: '55*55*60', cutout: '50', price: 1370 }, { wattage: '12W', dimension: '55*55*70', cutout: '50', price: 1550 }],
    'GLR-DELT-7':  [{ wattage: '7W', dimension: '75*60', cutout: '65', price: 950 }, { wattage: '12W', dimension: '85*76', cutout: '75', price: 1120 }, { wattage: '18W', dimension: '95*100', cutout: '85', price: 1380 }],
    'GLR-VOGU-8':  [{ wattage: '7W', dimension: '42*42*60', cutout: '35', price: 1180 }, { wattage: '12W', dimension: '62*62*60', cutout: '55', price: 1780 }],
    'GLR-GLON-9':  [{ wattage: '7W', dimension: '63*43', cutout: '55', price: 820 }, { wattage: '12W', dimension: '80*44', cutout: '75', price: 980 }, { wattage: '18W', dimension: '94*51', cutout: '85', price: 1240 }],
    'GLR-ORBI-11': [{ wattage: '7W', dimension: '63*32', cutout: '60', price: 760 }, { wattage: '12W', dimension: '80*40', cutout: '75', price: 1080 }, { wattage: '18W', dimension: '95*40', cutout: '85', price: 1320 }],
    'GLR-DUO-13':  [{ wattage: '2×7W', dimension: '65*122', cutout: '113*55', price: 2640 }, { wattage: '2×15W', dimension: '85*162', cutout: '153*75', price: 3680 }],
    'GLR-DUOR-14': [{ wattage: '2×7W', dimension: '68*134', cutout: '55*122', price: 1820 }, { wattage: '2×12W', dimension: '85*170', cutout: '75*160', price: 2380 }],
    'GLR-PULL-16': [{ wattage: '7W', dimension: '62*93', cutout: '55', price: 1480 }, { wattage: '12W', dimension: '84*104', cutout: '75', price: 1580 }, { wattage: '2×12W', dimension: '194*104', cutout: '177*88', price: 3180 }],
    'GLR-LINE-17': [{ wattage: '6W', dimension: '68*45', cutout: '58*35', price: 620 }, { wattage: '8W', dimension: '95*45', cutout: '85*35', price: 740 }, { wattage: '10W', dimension: '144*41', cutout: '138*35', price: 980 }, { wattage: '12W', dimension: '146*45', cutout: '137*35', price: 1100 }, { wattage: '20W', dimension: '276*41', cutout: '272*35', price: 1480 }],
    'GLR-NEXU-21': [{ wattage: '12W', dimension: '92*75', price: 1180 }, { wattage: '18W', dimension: '122*75', price: 1540 }, { wattage: '24W', dimension: '142*75', price: 1920 }],
    'GLR-NOVA-22': [{ wattage: '7W', dimension: '51*45', price: 920 }, { wattage: '12W', dimension: '80*46', price: 1180 }, { wattage: '18W', dimension: '90*48', price: 1420 }],
    'GLR-MOVA-27': [{ wattage: '7W', dimension: '63*92', price: 980 }, { wattage: '12W', dimension: '74*98', price: 1280 }, { wattage: '18W', dimension: '83*105', price: 1580 }],
    // Magna (GLR-MAGN-29) is deliberately absent: the hand sheet prices it at
    // 7W/12W/18W, the catalogue prints it as a 10W/15W ball, and the two cannot
    // be reconciled. Its August-sheet rates were applied in the first pass and
    // are left as they are until the office settles which wattages Magna sells.
  };

  /**
   * Puts the August 2026 sheet's per-wattage prices onto a stored product.
   *
   * A rebuild, not a fill: the range's whole option list becomes the sheet's,
   * so a product that had one placeholder option now carries every wattage the
   * sheet prices, each at its own rate, and the headline price drops to the
   * lowest of them. Ranges the sheet is silent about are left untouched.
   *
   * Returns true when the document still needs the change saved.
   */
  private applyPriceSheet2026(p: Product): boolean {
    if (p.priceSheet2026v2) return false;
    const rows = ProductService.PRICE_SHEET_2026[p.id];
    if (rows && rows.length) {
      p.variants = rows.map(r => ({ ...r }));
      p.price = Math.min(...rows.map(r => r.price ?? p.price));
    }
    p.priceSheet2026v2 = true;
    return true;
  }

  /**
   * Option dimensions and cut-outs lifted from the July 2026 catalogue.
   *
   * `patch` fills a single blank option, field by field and only where empty.
   * `replace` rebuilds the whole option list. See `variantDetails2026`.
   */
  private static readonly VARIANT_DETAILS_2026: {
    [id: string]: { patch?: Partial<ProductVariant>; replace?: ProductVariant[] };
  } = {
    // A single blank option, filled from the catalogue's base row. No price.
    'GLR-GLAR-6':  { patch: { wattage: '7W',    dimension: '55*55*60',   cutout: '50' } },
    'GLR-VOGU-8':  { patch: { wattage: '7W',    dimension: '42*42*60',   cutout: '35' } },
    'GLR-GLON-9':  { patch: { wattage: '7W',    dimension: '63*63*43',   cutout: '55' } },
    'GLR-PRIS-12': { patch: { wattage: '7W',    dimension: '68*48',      cutout: '60' } },
    'GLR-DUO-13':  { patch: { wattage: '2*10W', cutout: '113*55' } },
    'GLR-DUOR-14': { patch: { wattage: '2*7W',  dimension: '68*134',     cutout: '55*122' } },
    'GLR-PULL-16': { patch: { wattage: '7W',    dimension: '68*48',      cutout: '60' } },
    'GLR-LINE-17': { patch: { wattage: '6W',    dimension: '68*45*32',   cutout: '58*35' } },
    'GLR-NEXU-21': { patch: { wattage: '12W',   dimension: '92*75' } },
    'GLR-TRAC-25': { patch: { wattage: '10W',   dimension: '30*30*110' } },
    'GLR-MOVA-27': { patch: { wattage: '7W',    dimension: '85*90',      cutout: '75' } },
    'GLR-MAGN-29': { patch: { wattage: '10W',   dimension: '85*85*65' } },
    'GLR-CASE-44': { patch: { wattage: '6W',    dimension: '160*100*25' } },
    'GLR-UPDO-45': { patch: { wattage: '6W',    dimension: '80*65*75' } },
    'GLR-RUBI-46': { patch: { wattage: '6W',    dimension: '110*110*85' } },
    'GLR-WALL-49': { patch: { wattage: '18W',   dimension: '50*55*500' } },
    'GLR-INGR-50': { patch: { wattage: '3W',    dimension: '65*65*75',   cutout: '32' } },
    'GLR-SWIM-51': { patch: { wattage: '3W',    dimension: '85',         cutout: '60' } },
    'GLR-HIBA-54': { patch: { wattage: '100W',  dimension: '315*145*175' } },
    'GLR-STRE-55': { patch: { wattage: '24W',   dimension: '275*120*55' } },
    'GLR-LINE-40': { patch: { wattage: '20W',   dimension: '2ft' } },
    'GLR-RUBI-63': { patch: { wattage: '12W',   dimension: '130*130*120' } },
    'GLR-TEMP-64': { patch: { wattage: '15W',   dimension: '200' } },
    'GLR-LEGA-65': { patch: { wattage: '15W',   dimension: '200' } },
    'GLR-FOUR-66': { patch: { wattage: '15W',   dimension: '300' } },
    'GLR-SQUA-67': { patch: { wattage: '15W',   dimension: '300' } },
    'GLR-RING-68': { patch: { wattage: '15W',   dimension: '300' } },
    'GLR-ROUN-69': { patch: { wattage: '15W',   dimension: '300' } },
    'GLR-OVAL-70': { patch: { wattage: '15W',   dimension: '300' } },
    // Option lists rebuilt from the catalogue (stored options were the wrong
    // product's). Prices kept only where the wattages still line up.
    'GLR-STRE-26': { replace: [{ wattage: '7W', dimension: '35*35*120' }] },
    'GLR-NOVA-22': { replace: [
      { wattage: '7W',  dimension: '51*51*45' },
      { wattage: '12W', dimension: '80*80*46' },
      { wattage: '18W', dimension: '90*90*48' },
      { wattage: '24W', dimension: '128*128*50' },
    ] },
    'GLR-TILE-34': { replace: [
      { wattage: '24W', dimension: '285*285', cutout: '300*300' },
      { wattage: '30W', dimension: '285*285', cutout: '300*300' },
      { wattage: '40W', dimension: '575*575', cutout: '595*595' },
      { wattage: '50W', dimension: '575*575', cutout: '595*595' },
    ] },
    'GLR-FREE-62': { replace: [
      { wattage: '20W', dimension: '275*120*55', packing: '12', price: 1640 },
    ] },
    'GLR-SOLA-56': { replace: [
      { wattage: '70W',  dimension: '275*120*55', packing: '20', price: 3400 },
      { wattage: '120W', dimension: '315*135*55', packing: '10', price: 4800 },
    ] },
  };

  /**
   * Puts the catalogue's option dimensions and cut-outs onto a stored product.
   *
   * Returns true when the document still needs the change saved.
   */
  private applyVariantDetails2026(p: Product): boolean {
    if (p.variantDetails2026) return false;
    const d = ProductService.VARIANT_DETAILS_2026[p.id];
    if (d?.replace) {
      p.variants = d.replace.map(v => ({ ...v }));
    } else if (d?.patch && p.variants && p.variants.length) {
      const v = p.variants[0] as { [k: string]: unknown };
      for (const [k, val] of Object.entries(d.patch)) {
        if (!v[k]) v[k] = val;
      }
    }
    p.variantDetails2026 = true;
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
      // Deleted-product tombstones, shared across every device so a removed
      // catalogue product is never re-seeded by another client. Public-read
      // like the products themselves; only the admin's writes land.
      const metaRef = doc(this.firestore, 'meta', 'products');
      onSnapshot(metaRef, (snap) => {
        const ids = (snap.data()?.['deletedIds'] as string[]) || [];
        let changed = false;
        ids.forEach(id => {
          if (!this.deletedIds.has(id)) { this.deletedIds.add(id); changed = true; }
        });
        if (changed) {
          this.saveDeletedIds();
          this.reconcileDeletions();
        }
      }, () => {});

      const prodCollection = collection(this.firestore, 'products');
      onSnapshot(prodCollection, (snapshot) => {
        if (!snapshot.empty) {
          const remoteProducts: Product[] = [];
          snapshot.forEach(docSnap => {
            const p = docSnap.data() as Product;
            // A product the admin has deleted must never reappear, even if an
            // older client re-seeded it before the tombstone reached it. Drop
            // it from the list and, where we can write, remove it for good.
            if (this.deletedIds.has(p.id)) {
              if (this.firestore) deleteDoc(doc(this.firestore, 'products', p.id)).catch(() => {});
              return;
            }
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
            // The 2026 catalogue reconciliation, on the same terms.
            if (this.applyCatalogue2026(p) && this.firestore) {
              setDoc(doc(this.firestore, 'products', p.id), p).catch(() => {});
            }
            // ...and the corrected reading of its finishes.
            if (this.applyBodyColoursV2(p) && this.firestore) {
              setDoc(doc(this.firestore, 'products', p.id), p).catch(() => {});
            }
            // ...and the finishes the catalogue prints that were never stored.
            if (this.applyBodyColoursV3(p) && this.firestore) {
              setDoc(doc(this.firestore, 'products', p.id), p).catch(() => {});
            }
            // ...and the option's two identity fields folded into one.
            if (this.applyOptionFieldMerge(p) && this.firestore) {
              setDoc(doc(this.firestore, 'products', p.id), p).catch(() => {});
            }
            // ...and the shades the catalogue sells it in.
            if (this.applyLightColours2026(p) && this.firestore) {
              setDoc(doc(this.firestore, 'products', p.id), p).catch(() => {});
            }
            // ...and the rail taken off the tracklight.
            if (this.applyTrackSplit(p) && this.firestore) {
              setDoc(doc(this.firestore, 'products', p.id), p).catch(() => {});
            }
            // ...and the categories, Concealed split and junk labels.
            if (this.applyCatalogueTidy(p) && this.firestore) {
              setDoc(doc(this.firestore, 'products', p.id), p).catch(() => {});
            }
            // A hand-made product the catalogue has since superseded is
            // removed rather than listed beside the one that replaced it.
            if (ProductService.SUPERSEDED.has(p.id)) {
              if (this.firestore) deleteDoc(doc(this.firestore, 'products', p.id)).catch(() => {});
              return;
            }
            if (this.applyWarranty(p) && this.firestore) {
              setDoc(doc(this.firestore, 'products', p.id), p).catch(() => {});
            }
            // ...and the rope and strip read off the MODEL column.
            if (this.applyRopeStripFix(p) && this.firestore) {
              setDoc(doc(this.firestore, 'products', p.id), p).catch(() => {});
            }
            // ...and the ball light's auto option cycling RGBP.
            if (this.applyBallRgbp(p) && this.firestore) {
              setDoc(doc(this.firestore, 'products', p.id), p).catch(() => {});
            }
            // ...and the option dimensions and cut-outs from the catalogue.
            if (this.applyVariantDetails2026(p) && this.firestore) {
              setDoc(doc(this.firestore, 'products', p.id), p).catch(() => {});
            }
            // ...and the per-wattage prices from the August 2026 sheet.
            if (this.applyPriceSheet2026(p) && this.firestore) {
              setDoc(doc(this.firestore, 'products', p.id), p).catch(() => {});
            }
            remoteProducts.push(p);
          });

          // A product added to the seed after this collection was first written
          // would otherwise never appear: the branch below only runs when the
          // collection is empty. Anything in the seed and not here is added.
          // Nothing already stored is touched, so an admin's own products and
          // edits are safe.
          const stored = new Set(remoteProducts.map(p => p.id));
          this.defaultProducts.forEach(p => {
            if (stored.has(p.id) || this.deletedIds.has(p.id)) return;
            const fresh = JSON.parse(JSON.stringify(p)) as Product;
            remoteProducts.push(fresh);
            if (this.firestore) {
              setDoc(doc(this.firestore, 'products', fresh.id), fresh).catch(() => {});
            }
          });

          if (remoteProducts.length > 0) {
            this.productsSignal.set(remoteProducts);
            this.saveToStorage(remoteProducts);
          }
        } else {
          // Seed Firestore with defaultProducts if database is empty
          this.defaultProducts.forEach(p => {
            if (this.deletedIds.has(p.id)) return;
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
          this.applyCatalogue2026(p);
          this.applyBodyColoursV2(p);
          this.applyBodyColoursV3(p);
          this.applyOptionFieldMerge(p);
          this.applyLightColours2026(p);
          this.applyTrackSplit(p);
          this.applyCatalogueTidy(p);
          this.applyWarranty(p);
          this.applyRopeStripFix(p);
          this.applyBallRgbp(p);
          this.applyVariantDetails2026(p);
          this.applyPriceSheet2026(p);
          return p;
        });
        // Keep the superseded duplicates — and anything the admin has deleted —
        // off the first paint too, or they show for a moment before the
        // Firestore sync removes them.
        parsed = parsed.filter((p: any) =>
          !ProductService.SUPERSEDED.has(p.id) && !this.deletedIds.has(p.id));
        // Immediately rewrite the cache without its images, so a store bloated
        // by an older build is shrunk on this very load — freeing the room
        // Firestore needs for its own writes before the admin tries to save.
        this.saveToStorage(parsed);
        return parsed;
      }
    } catch (e) {
      console.error('Error loading products from localStorage', e);
    }
    this.saveToStorage(this.defaultProducts);
    return this.defaultProducts;
  }

  // localStorage tops out near 5 MB, and a single product's inline base64 image
  // is ~0.7 MB, so persisting the whole catalogue here overran the quota. That
  // did more than lose the cache: Firestore keeps its own pending writes in
  // localStorage too (the `firestore_mutations_...` keys), so a full store made
  // EVERY Firestore write crash with QuotaExceededError / INTERNAL ASSERTION —
  // add, edit and delete all failed with a "connection" error. The cache only
  // needs enough to paint the list instantly and to fall back on when Firestore
  // is down; the heavy images are dropped and served from Firestore instead
  // (its IndexedDB cache holds them, and offline the images simply wait).
  private slimForStorage(products: Product[]): Product[] {
    return products.map(p => {
      if (!p.image) return p;
      const { image, ...rest } = p;
      return rest as Product;
    });
  }

  private saveToStorage(products: Product[]) {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.slimForStorage(products)));
    } catch (e) {
      // Out of quota even without images: drop the cache rather than leave a
      // stale oversized copy wedged in front of Firestore's own writes.
      console.error('Error saving products to localStorage', e);
      try { localStorage.removeItem(this.STORAGE_KEY); } catch {}
    }
  }

  private loadDeletedIds(): string[] {
    try {
      const raw = localStorage.getItem(this.DELETED_KEY);
      const ids = raw ? JSON.parse(raw) : [];
      return Array.isArray(ids) ? ids : [];
    } catch {
      return [];
    }
  }

  private saveDeletedIds() {
    try {
      localStorage.setItem(this.DELETED_KEY, JSON.stringify([...this.deletedIds]));
    } catch (e) {
      console.error('Error saving deleted product ids to localStorage', e);
    }
  }

  // Drops any tombstoned product still sitting in the current list (and, where
  // we can write, in Firestore), so a deletion synced from another device takes
  // effect on this one too.
  private reconcileDeletions() {
    const current = this.productsSignal();
    const kept = current.filter(p => !this.deletedIds.has(p.id));
    if (kept.length !== current.length) {
      this.productsSignal.set(kept);
      this.saveToStorage(kept);
    }
    const fs = this.firestore;
    if (fs) {
      current.forEach(p => {
        if (this.deletedIds.has(p.id)) deleteDoc(doc(fs, 'products', p.id)).catch(() => {});
      });
    }
  }

  // The order the products are printed in the August 2026 catalogue, by id. The
  // list is shown in this sequence rather than the order Firestore hands the
  // documents back (by document id), which is not the catalogue's. Every id in
  // defaultProducts is here; the four that have no catalogue page of their own
  // — the two track rails, Lux Concealed and Rope Cord — sit beside the
  // product they were split from. An id not in this list (a product an admin
  // adds later) sorts to the end, keeping its own order.
  private static readonly CATALOGUE_ORDER: string[] = [
    'GLR-DELT-3', 'GLR-CURV-4', 'GLR-GEM-5', 'GLR-GLAR-6', 'GLR-DELT-7', 'GLR-VOGU-8',
    'GLR-GLON-9', 'GLR-ELEG-10', 'GLR-ORBI-11', 'GLR-PRIS-12', 'GLR-PLUT-76', 'GLR-NIVO-75',
    'GLR-TERA-77', 'GLR-MIRA-78', 'GLR-AERO-79', 'GLR-CRES-80', 'GLR-GALA-81', 'GLR-SPOT-18',
    'GLR-LINE-17', 'GLR-LINS-82', 'GLR-DUO-13', 'GLR-DUOR-14', 'GLR-MOVA-15', 'GLR-PULL-16',
    'GLR-DEEP-19', 'GLR-NEXU-20', 'GLR-NEXU-21', 'GLR-NOVA-22', 'GLR-CONC-23', 'GLR-LUXC-73',
    'GLR-TRAC-24', 'GLR-TRAC-25', 'GLR-PCTR-71', 'GLR-METR-72', 'GLR-STRE-26', 'GLR-MOVA-27',
    'GLR-CYLI-28', 'GLR-MAGN-29', 'GLR-STRI-35', 'GLR-SLIM-31', 'GLR-SURF-32', 'GLR-TRIM-33',
    'GLR-TILE-34', 'GLR-STRI-30', 'GLR-SMPS-36', 'GLR-ROPE-37', 'GLR-RCRD-74', 'GLR-PROF-38',
    'GLR-MAGN-39', 'GLR-LINE-40', 'GLR-KTYP-41', 'GLR-BALL-42', 'GLR-CURV-43', 'GLR-CASE-44',
    'GLR-UPDO-45', 'GLR-FOOT-47', 'GLR-RUBI-46', 'GLR-WALL-49', 'GLR-SPIK-48', 'GLR-SWIM-51',
    'GLR-INGR-50', 'GLR-SLIM-53', 'GLR-GMFL-52', 'GLR-HIBA-54', 'GLR-LEAF-83', 'GLR-STRE-55',
    'GLR-AURA-57', 'GLR-VIST-58', 'GLR-SOLA-56', 'GLR-CUBE-59', 'GLR-MASH-61', 'GLR-CUBE-60',
    'GLR-RUBI-63', 'GLR-FREE-62', 'GLR-LEGA-65', 'GLR-TEMP-64', 'GLR-SQUA-67', 'GLR-FOUR-66',
    'GLR-ROUN-69', 'GLR-RING-68', 'GLR-OVAL-70',
  ];
  private catalogueIndex?: Map<string, number>;
  private sortedCacheSource: Product[] | null = null;
  private sortedCache: Product[] = [];

  // Order a list by CATALOGUE_ORDER. A stable sort, so any ids not on the list
  // keep their incoming order after those that are.
  private sortByCatalogue(list: Product[]): Product[] {
    if (!this.catalogueIndex) {
      this.catalogueIndex = new Map(
        ProductService.CATALOGUE_ORDER.map((id, i) => [id, i]),
      );
    }
    const idx = this.catalogueIndex;
    const END = Number.MAX_SAFE_INTEGER;
    return [...list].sort(
      (a, b) => (idx.get(a.id) ?? END) - (idx.get(b.id) ?? END),
    );
  }

  get products(): Product[] {
    // Sort once per underlying list, not on every read: the signal hands back a
    // new array only when the data actually changes, so a reference check tells
    // a fresh list from a repeat read and keeps the returned reference stable.
    const src = this.productsSignal();
    if (src !== this.sortedCacheSource) {
      this.sortedCacheSource = src;
      this.sortedCache = this.sortByCatalogue(src);
    }
    return this.sortedCache;
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
    // Tombstone first, so the Firestore snapshot that follows the delete below
    // (and every future seed-fill) knows not to bring this product back.
    this.deletedIds.add(id);
    this.saveDeletedIds();

    this.productsSignal.update(products => {
      const newList = products.filter(p => p.id !== id);
      this.saveToStorage(newList);
      return newList;
    });

    if (this.firestore) {
      deleteDoc(doc(this.firestore, 'products', id))
        .catch(err => console.warn('Firestore delete notice:', err?.message || err));
      // Share the tombstone so no other client re-seeds this catalogue product.
      setDoc(doc(this.firestore, 'meta', 'products'), { deletedIds: [...this.deletedIds] }, { merge: true })
        .catch(err => console.warn('Firestore tombstone notice:', err?.message || err));
    }
  }
}
