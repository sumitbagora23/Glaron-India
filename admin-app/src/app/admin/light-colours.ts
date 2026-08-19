/**
 * The light colours a fitting can be ordered in.
 *
 * The admin picks them per product on the add/edit form; every catalogue card
 * (dealer, agent, public link) shows the picked ones behind the product's
 * wattage · dimension tabs. The names are what Glaron sells and what a dealer
 * asks for; a small box of the colour is drawn before each one, worked out from
 * the name itself — see lightColourSwatch() at the bottom of this file.
 *
 * The list itself is no longer fixed in code. It lives in Firestore and is
 * managed on the Light Colours page (Add Light Colour, on the product form and
 * on the product list) — see LightColourService. What is left here is the seed
 * the collection starts from on first run, plus the one name the app itself
 * knows about.
 *
 * "No Colour" is not one of the shades and is deliberately NOT in the seed: it
 * is what the form stores for the things in the range that have no shade to
 * choose — drivers, profiles, accessories. It is never listed for picking or
 * managing. The picker's clear (×) writes it, picking any shade clears it, and
 * LightColourService strips it from the managed list. See NO_COLOUR below,
 * clearLightColours() and toggleLightColour() in the product form.
 */
export const NO_COLOUR = 'No Colour';

export const LIGHT_COLOUR_OPTIONS: string[] = [
  'Cool White',
  'Warm White',
  'Natural White',
  '3 In 1',
  'Dimmable-Tunable',
  'Smart',
  // The rope's own range. It is the one product sold in actual colours rather
  // than colour temperatures, and the sheet lists these for it by name.
  'Blue',
  'Green',
  'Red',
  'Amber',
  'Pink',
  'Ice Blue',
  'Multi'
];

/**
 * The swatch shown next to a shade's name.
 *
 * Wherever a light colour is written — the Light Colours page, the product
 * form's picker, every catalogue card, every saved order and quotation line,
 * and the quotation PDFs — a small box of that colour sits before the name. The
 * colour is worked out from the name itself, so a shade the admin types today
 * is painted without anyone adding it to a list in code:
 *
 *   1. the names Glaron sells in, which are colour temperatures rather than
 *      colours ("Warm White" is not white), and the mixed ones that need more
 *      than one colour in the box ("3 In 1", "Smart");
 *   2. words the trade uses that CSS has never heard of — amber, ice, lemon;
 *   3. anything the browser itself can read as a colour, tried as the whole
 *      name run together ("Sky Blue" -> skyblue), then word pairs, then single
 *      words — the plain "Red", "Green", "Pink" and their kin come out here;
 *   4. and when the name says nothing about a colour, a plain grey box, so the
 *      row still lines up with the ones around it.
 *
 * A shade resolves to a LIST of colours, because some are more than one: "3 In
 * 1" is warm, natural and cool. lightColourSwatch() turns that list into a CSS
 * background for the screen; lightColourSwatchRgb() turns it into the numbers
 * jsPDF wants, so the box on paper is the box on screen.
 */

// Two greys, for a name that says nothing about a colour.
const UNKNOWN_STOPS = ['#e2e8f0', '#cbd5e1'];

// Whole names. Colour temperatures first — "Cool White" is a white with blue in
// it, not the CSS `white` its last word would otherwise find at step 3.
const NAMED_STOPS: Record<string, string[]> = {
  'warm white': ['#ffc98a'],
  'warm': ['#ffc98a'],
  'soft white': ['#ffdcae'],
  'natural white': ['#ffeed4'],
  'neutral white': ['#ffeed4'],
  'pure white': ['#ffffff'],
  'cool white': ['#dcefff'],
  'cool day light': ['#e6f4ff'],
  'cool daylight': ['#e6f4ff'],
  'day light': ['#eaf6ff'],
  'daylight': ['#eaf6ff'],
  'golden yellow': ['#ffc107'],
  'golden': ['#f0b429'],
  // Sold in more than one shade at once, so the box carries all of them.
  '3 in 1': ['#ffc98a', '#ffeed4', '#dcefff'],
  '3in1': ['#ffc98a', '#ffeed4', '#dcefff'],
  '3 in one': ['#ffc98a', '#ffeed4', '#dcefff'],
  'three in one': ['#ffc98a', '#ffeed4', '#dcefff'],
  '2 in 1': ['#ffc98a', '#dcefff'],
  '2in1': ['#ffc98a', '#dcefff'],
  'smart': ['#ff4d4d', '#ffb020', '#ffe23d', '#35d07f', '#35b7ff', '#7a5cff', '#ff4d9e'],
  'rgb': ['#ff3b30', '#34c759', '#007aff'],
  'rgbw': ['#ff3b30', '#34c759', '#007aff', '#ffffff'],
  'rgb cct': ['#ff3b30', '#34c759', '#007aff', '#ffc98a', '#dcefff'],
  'multicolour': ['#ff4d4d', '#ffb020', '#ffe23d', '#35d07f', '#35b7ff', '#7a5cff', '#ff4d9e'],
  'multi colour': ['#ff4d4d', '#ffb020', '#ffe23d', '#35d07f', '#35b7ff', '#7a5cff', '#ff4d9e'],
  'multicolor': ['#ff4d4d', '#ffb020', '#ffe23d', '#35d07f', '#35b7ff', '#7a5cff', '#ff4d9e']
};

// Single words the trade names shades by that are not CSS colours.
const WORD_SWATCHES: Record<string, string> = {
  amber: '#ffbf3f',
  ice: '#cfe9ff',
  lemon: '#fff44f',
  peach: '#ffcba4',
  mint: '#9fe8c4',
  rose: '#ff5c78',
  blush: '#ff9fb0',
  copper: '#b87333',
  bronze: '#cd7f32',
  champagne: '#f7e7ce',
  candle: '#ffd39b',
  sunset: '#ff8c42',
  ruby: '#e0115b',
  emerald: '#2ecc71',
  sapphire: '#0f52ba',
  jade: '#00a86b',
  saffron: '#f4c430',
  mustard: '#ffdb58',
  wine: '#722f37',
  neon: '#39ff14',
  pista: '#b6d47a',
  sky: '#7ec8ff'
};

// Words that describe a shade without being one. Passed over on the first sweep
// so "Amber White" is painted amber rather than white.
const VAGUE_WORDS = new Set([
  'white', 'light', 'led', 'lamp', 'shade', 'colour', 'color', 'warm', 'cool',
  'natural', 'neutral', 'pure', 'soft', 'bright', 'day', 'in', 'and', 'the'
]);

// CSS reads these as valid for `color` without any of them being a colour.
const NOT_A_COLOUR = new Set([
  'inherit', 'initial', 'unset', 'revert', 'revert-layer', 'none', 'auto',
  'transparent', 'currentcolor'
]);

function normaliseColourName(name: string): string {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

// Asks the browser whether it can read the word as a colour, so every name CSS
// knows — from `red` to `mediumaquamarine` — works without being listed here.
function cssColour(token: string): string | null {
  if (!token || NOT_A_COLOUR.has(token)) return null;
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return null;
  return CSS.supports('color', token) ? token : null;
}

/** Every colour a shade's box is made of — one for most, several for the mixed. */
export function lightColourStops(name: string): string[] {
  const clean = normaliseColourName(name);
  if (!clean) return UNKNOWN_STOPS;

  if (NAMED_STOPS[clean]) return NAMED_STOPS[clean];

  const words = clean.split(' ');

  // The whole name run together: "Sky Blue" -> skyblue, "Dark Red" -> darkred.
  const joined = words.join('');
  if (WORD_SWATCHES[joined]) return [WORD_SWATCHES[joined]];
  const joinedCss = cssColour(joined);
  if (joinedCss) return [joinedCss];

  // Then neighbouring pairs, for a colour buried in a longer name.
  for (let i = 0; i < words.length - 1; i++) {
    const pair = words[i] + words[i + 1];
    if (WORD_SWATCHES[pair]) return [WORD_SWATCHES[pair]];
    const pairCss = cssColour(pair);
    if (pairCss) return [pairCss];
  }

  // Then single words — the telling ones first, the vague ones only if nothing
  // else in the name says anything.
  for (const pass of [0, 1]) {
    for (const word of words) {
      if (pass === 0 && VAGUE_WORDS.has(word)) continue;
      if (WORD_SWATCHES[word]) return [WORD_SWATCHES[word]];
      const wordCss = cssColour(word);
      if (wordCss) return [wordCss];
    }
  }

  return UNKNOWN_STOPS;
}

/**
 * The shade as a CSS background, ready for [style.background]. Paint it on the
 * shared .lc-swatch class (global.scss), which carries the size and the border
 * a near-white shade needs to be visible at all.
 */
export function lightColourSwatch(name: string): string {
  const stops = lightColourStops(name);
  if (stops.length === 1) return stops[0];

  // Three or fewer are cut hard, so "3 In 1" reads as three shades rather than
  // a blur. More than that is a run of colour — "Smart" is not three of
  // anything, it is all of them.
  if (stops.length > 3) return 'linear-gradient(135deg, ' + stops.join(', ') + ')';

  const step = 100 / stops.length;
  const cuts = stops.map((c, i) => c + ' ' + (i * step).toFixed(2) + '% ' + ((i + 1) * step).toFixed(2) + '%');
  return 'linear-gradient(135deg, ' + cuts.join(', ') + ')';
}

function parseHexOrRgb(value: string): [number, number, number] | null {
  const v = (value || '').trim();

  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v);
  if (short) {
    return [parseInt(short[1] + short[1], 16), parseInt(short[2] + short[2], 16), parseInt(short[3] + short[3], 16)];
  }

  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(v);
  if (long) return [parseInt(long[1], 16), parseInt(long[2], 16), parseInt(long[3], 16)];

  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(v);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];

  return null;
}

/**
 * The same box, in the numbers jsPDF draws with — one entry per colour the
 * shade is made of, so a mixed shade is printed as a box in bands.
 *
 * A stop can be a name only the browser knows (`skyblue`), so a throwaway
 * canvas is asked to normalise it: assigning to fillStyle and reading it back
 * gives `#rrggbb`. Anything that cannot be read comes back grey rather than
 * black, which would print as a hole in the page.
 */
export function lightColourSwatchRgb(name: string): Array<[number, number, number]> {
  const GREY: [number, number, number] = [203, 213, 225];

  return lightColourStops(name).map(stop => {
    const direct = parseHexOrRgb(stop);
    if (direct) return direct;

    if (typeof document === 'undefined') return GREY;
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return GREY;

    ctx.fillStyle = '#000000';
    ctx.fillStyle = stop;
    return parseHexOrRgb(String(ctx.fillStyle)) || GREY;
  });
}

/**
 * Pulls the shade off the end of a saved line's descriptor.
 *
 * A cart line, an order line and a quotation line each keep what was ordered as
 * one string — "7W · 2ft · Cool White" — with the shade last (see lineLabel()
 * on the panels and on QuotationDraftService). To draw the box of colour right
 * before the shade's name rather than in front of the wattage, the string has
 * to be split back apart.
 *
 * Only a tail that is one of the shades the admin manages is taken as a colour.
 * `names` is LightColourService.names — without it a variant's body finish
 * ("... · Black") would be read as the light colour and painted as one.
 */
export function splitLightColourLabel(label: string, names: string[]): { head: string; colour: string } {
  const text = (label || '').trim();
  if (!text) return { head: '', colour: '' };

  const SEPARATOR = ' · ';
  const cut = text.lastIndexOf(SEPARATOR);
  const tail = cut >= 0 ? text.slice(cut + SEPARATOR.length) : text;
  const known = (names || []).some(n => (n || '').trim().toLowerCase() === tail.trim().toLowerCase());

  if (!known) return { head: text, colour: '' };
  return { head: cut >= 0 ? text.slice(0, cut + SEPARATOR.length) : '', colour: tail };
}
