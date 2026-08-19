/**
 * The body colours a fitting can be ordered in.
 *
 * A body colour is the finish of the housing — black, white, rose gold. It is
 * NOT a light colour: the shade the lamp throws is picked separately and can
 * carry its own price, whereas a body colour never moves the price. A 12W
 * Cylinder costs the same in black as in white, so body colour is deliberately
 * kept out of every pricing path (see QuotationDraftService.unitPrice, which
 * takes a light colour and not this).
 *
 * It still belongs on the LINE, though: a customer who asks for six in black
 * and four in white has asked for two different things, and the quotation has
 * to read that way. So the chosen body colour goes into the line key and the
 * line label exactly as a light colour does — it just never reaches the price.
 *
 * The list is free text per product, typed by the admin on the product form.
 * There is no managed collection behind it the way there is for light colours;
 * the finishes vary too much by range to be worth a global list.
 */

/**
 * Body colours read off the free-text the catalogue import left on a variant.
 *
 * The sheet writes a finish as one or more POSITIONS joined by "+" — a body and
 * a reflector — and lists the alternatives for a position with "/". What is
 * actually sold is every combination, so the options are the CROSS PRODUCT of
 * the positions:
 *
 *   "BK/WH + RG / GBK / MW / MB"  ->  BK/RG  BK/GBK  BK/MW  BK/MB
 *                                     WH/RG  WH/GBK  WH/MW  WH/MB
 *
 * "|" is the awkward one: the sheet uses it both for alternatives inside a
 * position and for spelling whole options out one by one. The two are told
 * apart by how many of the "|" segments carry a "+":
 *
 *   more than one  ->  the sheet is listing complete options, so each segment
 *                      is one option. "BK + GBK | WH + RG" is exactly two
 *                      finishes, NOT the four a cross product would give.
 *   at most one    ->  the tail is more alternatives for the last position.
 *                      "BK/WH + RG | GBK | MW | MB" is the eight above.
 *
 * That distinction is the whole reason the sheet bothers with two notations:
 * Cylinder's "BK/WH + GBK/RG" really is any of four combinations, while Gem's
 * "BK + GBK | WH + RG" really is only those two pairings.
 */
export function parseBodyColours(raw?: string): string[] {
  const text = String(raw || '').trim();
  if (!text) return [];

  const segments = text.split('|').map(s => s.trim()).filter(Boolean);
  const joined = segments.filter(s => s.includes('+'));

  let optionExpressions: string[];
  if (joined.length > 1) {
    // Complete options, spelled out one per segment.
    optionExpressions = segments;
  } else if (segments.length > 1) {
    // One joined expression, then more alternatives for its last position.
    const parts = segments[0].split('+').map(s => s.trim());
    parts[parts.length - 1] = [parts[parts.length - 1], ...segments.slice(1)].join('/');
    optionExpressions = [parts.join(' + ')];
  } else {
    optionExpressions = segments;
  }

  const out: string[] = [];
  for (const expression of optionExpressions) {
    const positions = expression
      .split('+')
      .map(part => part.split('/').map(s => s.trim()).filter(Boolean))
      .filter(group => group.length);
    if (!positions.length) continue;

    let combinations: string[][] = [[]];
    for (const group of positions) {
      const next: string[][] = [];
      for (const combination of combinations) {
        for (const value of group) next.push([...combination, value]);
      }
      combinations = next;
    }
    for (const combination of combinations) out.push(combination.join('/'));
  }

  return dedupe(out);
}

/** Same name twice — from two variants, or a repeat in one cell — is one option. */
function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(v.trim());
  }
  return out;
}

/**
 * Values the import left in the body-colour column that are not colours at all.
 *
 * The same bad sheet that put the literal word "Dimension" in wattage cells put
 * these here. They are dropped rather than offered as a finish nobody can order.
 */
const NOT_A_COLOUR = /^(fixtures?|reflectors?|n\/?a|-|dimension)$/i;

/**
 * The finishes a product is sold in.
 *
 * One list serves the whole product. It is set on the product form, and was
 * seeded from the price sheet's BODY COLOUR column by the 2026 catalogue
 * migration — which also parsed whatever the old per-variant text said, so
 * nothing was lost when that field went away.
 */
export function orderableBodyColours(product: { bodyColours?: string[] }): string[] {
  const picked = (product.bodyColours || []).map(c => c.trim()).filter(Boolean);
  return dedupe(picked).filter(c => !NOT_A_COLOUR.test(c));
}

/**
 * What the admin types on the product form, turned into the stored list.
 *
 * Two kinds of text arrive here and they must not be treated alike:
 *
 *   a cell pasted from the sheet — "BK/WH + GBK/RG" — is an expression, and
 *   the combinations it stands for are worked out by parseBodyColours above;
 *
 *   the list this field shows back — "BK/GBK, BK/RG, WH/GBK" — is already
 *   those combinations, and each comma-separated item is one finish, whole.
 *
 * The two are told apart by "+" and "|", which only ever appear in an
 * expression. Without that test a finish like "BK/RG" would be read as the
 * alternatives BK and RG and split back into two, so opening a product and
 * saving it would quietly replace eight combinations with six loose tokens.
 */
export function readBodyColourInput(text: string): string[] {
  const out: string[] = [];
  for (const chunk of String(text || '').split(',')) {
    const item = chunk.trim();
    if (!item) continue;
    if (item.includes('+') || item.includes('|')) out.push(...parseBodyColours(item));
    else out.push(item);
  }
  return dedupe(out).filter(c => !NOT_A_COLOUR.test(c));
}
