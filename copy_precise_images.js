const fs = require('fs');
const path = require('path');

const manifest = JSON.parse(fs.readFileSync('pdf_images_manifest.json', 'utf8'));
const artDir = 'C:\\Users\\DELL\\.gemini\\antigravity\\brain\\eb12d900-ed92-4eb5-87f1-b2f568972240\\pdf_all_images';
const targetDir = 'src/assets/images/products';

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

// Explicit mappings for every page 3 through 70 to ensure 100% precision
const pageImageSelection = {
  3: null, // Delta has no separate embedded image, fallback to Delta Pro
  4: 'page_4_Curve_img_6_560x560_162095b.png',
  5: 'page_5_Gem_img_6_480x480_145902b.png',
  6: 'page_6_Glare_img_6_516x295_114065b.png',
  7: 'page_7_DeltaPro_img_6_800x532_77891b.png',
  8: 'page_8_Vogue_img_6_640x427_171326b.png',
  9: 'page_9_Glon_img_6_480x480_123862b.png',
  10: 'page_10_Elegance_img_6_560x479_233298b.png',
  11: 'page_11_Orbit_img_6_588x278_87353b.png',
  12: 'page_12_Prism_img_6_427x640_170657b.png',
  13: 'page_13_Duo_img_6_658x184_116014b.png',
  14: 'page_14_DuoR_img_7_560x341_160249b.png',
  15: 'page_15_Movable_img_7_560x451_235293b.png',
  16: 'page_16_PullOut_img_5_505x240_142438b.png',
  17: 'page_17_Linea_img_6_625x357_98704b.png',
  18: 'page_18_Spot_img_6_640x367_87872b.png',
  19: 'page_19_DeepDownlight_img_5_474x146_94694b.png',
  20: 'page_20_NexusPro_img_5_480x480_82380b.png',
  21: 'page_21_Nexussurface_img_5_640x640_105746b.png',
  22: 'page_22_Nova_img_5_480x480_104989b.png',
  23: 'page_23_Concealed_img_5_480x480_124748b.png',
  24: 'page_24_Tracklight_img_6_400x400_84419b.png',
  25: 'page_25_TrackWall_img_5_480x480_124577b.png',
  26: 'page_26_Streak_img_5_480x480_144476b.png',
  27: 'page_27_MovableCylinder_img_5_427x640_43663b.png',
  28: 'page_28_Cylinder_img_5_640x427_164331b.png',
  29: 'page_29_Magna_img_5_412x343_91478b.png',
  30: 'page_30_Striker_img_5_560x560_193193b.png',
  31: 'page_31_SlimPanel_img_5_400x400_41326b.png',
  32: 'page_32_SurfacePanel_img_5_440x250_29541b.png',
  33: 'page_33_TrimlessSurface_img_5_480x480_103038b.png',
  34: 'page_34_Tile_img_6_560x374_100808b.png',
  35: 'page_35_StripLight_img_6_480x480_121411b.png',
  36: 'page_36_SMPS_img_5_219x560_171546b.png',
  37: 'page_37_RopeLight_img_5_540x720_157866b.png',
  38: 'page_38_Profile_img_5_560x308_213813b.png',
  39: 'page_39_Magnetic_img_5_560x448_55312b.png',
  40: 'page_40_LinearHanging_img_6_250x250_36860b.png',
  41: 'page_41_KType_img_6_431x560_35500b.png',
  42: 'page_42_BallLight_img_5_800x800_103919b.png',
  43: 'page_43_CurveWall_img_5_368x376_105540b.png',
  44: 'page_44_Casette_img_5_395x630_78455b.png',
  45: 'page_45_UpdownWall_img_6_800x800_111999b.png',
  46: 'page_46_RubikSquare_img_6_480x480_45732b.png',
  47: 'page_47_FootLights_img_6_480x480_93498b.png',
  48: 'page_48_Spike_img_5_400x400_51553b.png',
  49: 'page_49_WallWasher_img_7_560x560_116215b.png',
  50: 'page_50_Inground_img_6_560x315_85101b.png',
  51: 'page_51_SwimmingPool_img_6_492x244_101343b.png',
  52: 'page_52_GMFlood_img_6_480x480_197972b.png',
  53: 'page_53_SlimFlood_img_6_420x560_155504b.png',
  54: 'page_54_HiBay_img_5_560x560_163009b.png',
  55: 'page_55_Street_img_5_480x480_93104b.png',
  56: 'page_56_SolarStreet_img_5_480x480_122834b.png',
  57: null, // Aura Max has no separate image, fallback to Vista
  58: 'page_58_Vista_img_5_449x800_75283b.png',
  59: 'page_59_Cubex_img_5_362x448_99453b.png',
  60: 'page_60_Cube_img_5_558x520_74825b.png',
  61: 'page_61_Mashal_img_5_640x640_196544b.png',
  62: 'page_62_Freedom_img_5_640x640_140344b.png',
  63: 'page_63_Rubik_img_5_480x480_103102b.png',
  64: 'page_64_Temple_img_6_560x560_162323b.png',
  65: 'page_65_Legacy_img_5_560x560_150549b.png',
  66: 'page_66_FourPillar_img_5_720x720_157816b.png',
  67: 'page_67_Square_img_5_720x480_55773b.png',
  68: 'page_68_Ring_img_5_427x640_60085b.png',
  69: 'page_69_Round_img_5_427x640_45291b.png',
  70: 'page_70_Oval_img_5_640x599_17363b.png'
};

const productNames = {
  3: 'Delta', 4: 'Curve', 5: 'Gem', 6: 'Glare', 7: 'Delta Pro', 8: 'Vogue', 9: 'Glon', 10: 'Elegance',
  11: 'Orbit', 12: 'Prism', 13: 'Duo', 14: 'Duo R', 15: 'Movable', 16: 'Pull Out', 17: 'Linea', 18: 'Spot',
  19: 'Deep Downlight', 20: 'Nexus Pro', 21: 'Nexus surface', 22: 'Nova', 23: 'Concealed', 24: 'Tracklight',
  25: 'Track Wall', 26: 'Streak', 27: 'Movable Cylinder', 28: 'Cylinder', 29: 'Magna', 30: 'Striker',
  31: 'Slim Panel', 32: 'Surface Panel', 33: 'Trimless Surface', 34: 'Tile', 35: 'Strip Light', 36: 'SMPS',
  37: 'Rope Light', 38: 'Profile', 39: 'Magnetic', 40: 'Linear Hanging', 41: 'K-Type', 42: 'Ball Light',
  43: 'Curve Wall', 44: 'Casette', 45: 'Updown Wall', 46: 'Rubik Square', 47: 'Foot Lights', 48: 'Spike',
  49: 'Wall Washer', 50: 'Inground', 51: 'Swimming Pool', 52: 'GM Flood', 53: 'Slim Flood', 54: 'Hi-Bay',
  55: 'Street', 56: 'Solar Street', 57: 'Aura Max', 58: 'Vista', 59: 'Cubex', 60: 'Cube', 61: 'Mashal',
  62: 'Freedom', 63: 'Rubik', 64: 'Temple', 65: 'Legacy', 66: 'Four Pillar', 67: 'Square', 68: 'Ring',
  69: 'Round', 70: 'Oval'
};

// Copy selected image files
for (let p = 3; p <= 70; p++) {
  const name = productNames[p];
  const formattedName = name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const targetFileName = `GLR-${formattedName.substring(0, 4)}-${p}.png`;
  const destPath = path.join(targetDir, targetFileName);

  let sourceFn = pageImageSelection[p];
  if (!sourceFn) {
    if (p === 3) sourceFn = pageImageSelection[7]; // Delta -> Delta Pro
    if (p === 57) sourceFn = pageImageSelection[58]; // Aura Max -> Vista
  }

  const srcPath = path.join(artDir, sourceFn);
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, destPath);
    console.log(`Page ${p} (${name}) -> Copied ${sourceFn} to ${targetFileName}`);
  } else {
    console.error(`Page ${p} source missing: ${srcPath}`);
  }
}

console.log('All product images accurately mapped and copied to assets!');
