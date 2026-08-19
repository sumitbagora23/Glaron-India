import { Product, ProductVariant } from './product.service';
import { NO_COLOUR } from './light-colours';

// The swatch drawn before a light colour name, re-exported so the pages that
// already take their tabs from here do not need a second import for it.
export { lightColourSwatch, lightColourSwatchRgb, splitLightColourLabel } from './light-colours';

/**
 * The wattage tabs shown on a product card.
 *
 * A fitting is picked by its wattage, so that — and nothing else — is what the
 * tabs across a card read; a strip picked by its supply reads "12V/3A" the same
 * way, and an option the catalogue records neither for falls back to its own
 * name. The cut-out, the body colour and the rest of the sheet sit behind the ⓘ
 * beside them, where they can be read without turning the card back into a
 * table.
 *
 * Every option gets a tab, whatever it carries, so one card shape serves the
 * dealer app, the sales panel, the catalogue link and both admin screens, and
 * nothing in the range becomes unreachable.
 */
export interface SpecTab {
  /** `productId#index` — identifies the one open tab across the whole page. */
  key: string;
  index: number;
  /** The bare spec, without anything added to tell it from its neighbours. */
  label: string;
  /**
   * What the tab prints — the spec, plus whatever it takes to make it unique.
   *
   * Four options can all be 7W and differ only in the hole they fit or the way
   * they throw light. A card that printed "7W" three times over gave a dealer
   * nothing to choose between, so a clashing group takes on the one spec that
   * really separates it: "7W · COB". Equal to `label` when nothing clashes,
   * which is the usual case.
   *
   * The tabs carry this and the sheet under them carries none of it — an
   * option is named once, on the tab that opens it.
   */
  detail: string;
  variant: ProductVariant;
}

/** One line of the sheet behind the ⓘ: "Cut-out", "63 mm". */
export interface SpecDetail {
  label: string;
  value: string;
}

// The catalogue seed left the literal word "Dimension" in some wattage cells;
// treat those as empty rather than printing them.
function isBlank(value?: string): boolean {
  const v = (value || '').trim();
  return !v || v === '-' || /dimension/i.test(v);
}

/**
 * True of "12V/3A", "24V", "350mA" — a type that is really an electrical
 * rating, and so is something a fitting is picked by.
 *
 * A strip is chosen by the supply it runs on exactly as a downlight is chosen
 * by its wattage, so a rating earns a tab. A type that is a shape or a
 * technology — "Round", "COB", "SMD" — does not: it describes the option
 * rather than separating it from its siblings, and a row of those reads as
 * noise on a card. Those options are priced straight instead.
 */
export function isRatingLabel(value?: string): boolean {
  return /\d\s*(?:m?[AV]|VA|W)\b/i.test((value || '').trim());
}

/** "7W", or "12V/3A" where the option is picked by its rating instead. */
export function specTabLabel(variant: ProductVariant): string {
  if (!isBlank(variant.wattage)) return variant.wattage!.trim();
  const type = clean(variant.type);
  return isRatingLabel(type) ? type : '';
}

/** "63×61 mm" — always with its unit, however the size was typed in. */
export function dimensionLabel(variant: ProductVariant): string {
  if (isBlank(variant.dimension)) return '';
  const d = variant.dimension!.trim();
  return /mm|cm|inch|"/i.test(d) ? d : `${d} mm`;
}

/** Everything known about one option — what the ⓘ opens. */
export function specDetails(variant: ProductVariant): SpecDetail[] {
  const rows: SpecDetail[] = [];
  const push = (label: string, value?: string) => {
    if (!isBlank(value)) rows.push({ label, value: value!.trim() });
  };

  push('Wattage', variant.wattage);
  const size = dimensionLabel(variant);
  if (size) rows.push({ label: 'Dimension', value: size });
  push('Cut-out', variant.cutout);
  push('Type', variant.type);
  push('Packing', variant.packing);
  return rows;
}

function clean(value?: string): string {
  return isBlank(value) ? '' : value!.trim();
}

/**
 * What a tab reads when the option carries neither a wattage nor a rating.
 *
 * The model is the option's name — "CB DELTA" is what the catalogue calls that
 * one fitting — so it comes first, and the specs that merely describe it come
 * after. A type that is a shape or a technology ("Round", "2 WAY") sits far
 * down the list: it is a poor name, but still a better tab than a number.
 *
 * The size is not on the list at all, here or in the separators below. It is a
 * measurement rather than a way of choosing, it is long enough to push a tab
 * off the row, and it is already the second line of the ⓘ sheet.
 *
 * The catalogue import left placeholder words ("Dimension", "W") in some cells,
 * so the old joined label printed "Duo · DimensionW" on the card. Only fields
 * that survive `isBlank` are considered, and a bare option number is a better
 * tab than a line of noise.
 */
function fallbackLabel(variant: ProductVariant, index: number): string {
  return clean(variant.type) || `Option ${index + 1}`;
}

/**
 * The specs a clash is broken by, best first.
 *
 * Order matters: what usually separates two fittings of the same wattage is the
 * way they throw light, then their finish, then the hole they fit. The size is
 * deliberately absent — a tab never carries one.
 */
const SEPARATORS: Array<(v: ProductVariant) => string> = [
  v => clean(v.type),
  v => clean(v.cutout),
  v => clean(v.dimension),
];

/**
 * The spec that actually tells a group of same-reading options apart.
 *
 * Picking the first field that merely has a value is not enough — every Ball
 * Light is black, so "· BLACK" separated nothing and the tabs fell back to
 * "(2)", "(3)". So a separator is only taken if its values genuinely differ
 * across the group, preferring one that is different on every single option.
 */
function separatorFor(variants: ProductVariant[]): ((v: ProductVariant) => string) | null {
  const distinct = (get: (v: ProductVariant) => string) => new Set(variants.map(get));
  return (
    SEPARATORS.find(get => {
      const values = distinct(get);
      return values.size === variants.length && !values.has('');
    }) ||
    SEPARATORS.find(get => distinct(get).size > 1) ||
    null
  );
}

/**
 * One tab per option — always, so every product card in every app reads the
 * same way and no option can fall off a card. A product with no options at all
 * gets an empty list; its card then prices the product itself, shade by shade.
 */
export function buildSpecTabs(product: Product): SpecTab[] {
  const variants = product.variants || [];
  if (!variants.length) return [];

  // The spec the option is picked by — its wattage, or a rating like 12V/3A —
  // and its name when the catalogue records neither.
  const base = variants.map((variant, index) =>
    specTabLabel(variant) || fallbackLabel(variant, index));

  // Several variants can share a wattage and differ only by the hole they fit,
  // their finish or the way they throw light. Left alone the card showed the
  // same tab two or three times over, so every clashing group takes on the one
  // spec that really separates it.
  const clashes = new Map<string, number[]>();
  base.forEach((label, index) => {
    const group = clashes.get(label) || [];
    group.push(index);
    clashes.set(label, group);
  });

  const suffix: string[] = new Array(variants.length).fill('');
  clashes.forEach(group => {
    if (group.length < 2) return;
    const separator = separatorFor(group.map(i => variants[i]));
    if (separator) group.forEach(i => { suffix[i] = separator(variants[i]); });
  });

  // A number is the last resort, for options that are identical on every spec
  // the catalogue records.
  const used = new Map<string, number>();

  return variants.map((variant, index) => {
    let detail = suffix[index] ? `${base[index]} · ${suffix[index]}` : base[index];
    const seen = (used.get(detail) || 0) + 1;
    used.set(detail, seen);
    if (seen > 1) detail = `${detail} (${seen})`;

    return { key: `${product.id}#${index}`, index, label: base[index], detail, variant };
  });
}/**
 * Holds the tabs for every card on a page and which one is open.
 *
 * The tabs are cached per product because the templates ask for them on every
 * change-detection pass; the cache is keyed on the variants array itself, so a
 * fresh copy from Firestore rebuilds them instead of serving a stale list.
 */
export class SpecTabState {
  private cache = new Map<string, { src: ProductVariant[] | undefined; tabs: SpecTab[] }>();
  private openKey: string | null = null;
  /** Products whose ⓘ sheet is open, by product id. */
  private sheets = new Set<string>();

  tabs(product: Product): SpecTab[] {
    const hit = this.cache.get(product.id);
    if (hit && hit.src === product.variants) return hit.tabs;
    const tabs = buildSpecTabs(product);
    this.cache.set(product.id, { src: product.variants, tabs });
    return tabs;
  }

  /** The open tab of this product, or the first one — a card is never blank. */
  openTab(product: Product): SpecTab | null {
    const tabs = this.tabs(product);
    if (!tabs.length) return null;
    return tabs.find(t => t.key === this.openKey) || tabs[0];
  }

  isOpen(product: Product, tab: SpecTab): boolean {
    return this.openTab(product)?.key === tab.key;
  }

  /** Tapping the open tab again leaves it open: the card always shows a price. */
  toggle(tab: SpecTab) {
    this.openKey = tab.key;
  }

  isSheetOpen(product: Product): boolean {
    return this.sheets.has(product.id);
  }

  /** The ⓘ: the sheet stays with the card until it is tapped shut again. */
  toggleSheet(product: Product) {
    if (!this.sheets.delete(product.id)) this.sheets.add(product.id);
  }

  trackByKey = (_: number, tab: SpecTab) => tab.key;
}

/**
 * The shades one option can actually be ordered in.
 *
 * A variant carries its own list only when it is sold differently from the rest
 * of the product — a 7W that comes in warm white alone while the 12W and 18W
 * come in three shades. With no list of its own an option is sold in whatever
 * the product is sold in, which is how every product saved before per-option
 * shades existed still reads.
 *
 * "No Colour" is not a shade — it is how the catalogue records a fitting that
 * has none — so it must never reach a product card as a row labelled with those
 * words. A product (or one option of it) marked that way simply has no shades,
 * and its card falls back to the single priced line.
 */
export function orderableLightColours(product: Product, variant?: ProductVariant): string[] {
  const own = variant?.lightColours;
  const list = own && own.length ? own : (product.lightColours || []);
  return list.filter(
    colour => (colour || '').trim().toLowerCase() !== NO_COLOUR.toLowerCase());
}

/**
 * What the catalogue records a shade costs, on this option, or 0.
 *
 * The option's own price for the colour wins; without one the product's price
 * for that colour still applies, so an admin who prices "Warm White" once for
 * the whole product does not have to repeat it on every option. 0 means the
 * shade is simply sold at the option's own price.
 */
export function lightColourCatalogPrice(product: Product, colour: string, variant?: ProductVariant): number {
  const own = variant?.lightColourPrice?.[colour];
  if (own && own > 0) return own;
  const shared = product.lightColourPrice?.[colour];
  return shared && shared > 0 ? shared : 0;
}
