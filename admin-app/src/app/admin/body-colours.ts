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
 * Body colours read off the free-text `bodyColour` the catalogue import left on
 * a variant.
 *
 * The imported sheet packed several options into one cell, with three levels of
 * punctuation:
 *
 *   "|"  separates whole options    — "WHITE | BLACK" is two finishes
 *   "+"  joins parts of ONE option  — "BK + GBK" is one finish: black body,
 *                                     gold-black reflector
 *   "/"  distributes alternatives positionally across the "+" parts, so
 *        "BK/WH + GBK/RG" is the pair (BK+GBK) and (WH+RG)
 *
 * The distributing rule is what the sheet itself confirms: one product spells a
 * finish out as "BK/WH + GBK/RG" and another writes the identical pair the long
 * way as "BK + GBK | WH + RG". Both have to come out as the same two options,
 * and with this rule they do.
 *
 * Anything that does not fit — a cell whose "/" groups are different lengths,
 * so there is no honest way to pair them — is kept WHOLE as a single option
 * rather than guessed at. It then reads oddly on the card, which is the point:
 * a wrong split is invisible, an unsplit cell asks to be fixed.
 */
export function parseBodyColours(raw?: string): string[] {
  const out: string[] = [];

  for (const option of String(raw || '').split('|').map(s => s.trim()).filter(Boolean)) {
    // A plain finish — "BLACK", "SAND BLACK" — is the whole option.
    if (!option.includes('+')) {
      out.push(option);
      continue;
    }

    const parts = option.split('+').map(s => s.trim()).filter(Boolean);
    const groups = parts.map(p => p.split('/').map(s => s.trim()).filter(Boolean));

    // Every group either names one thing for all the options, or names one
    // thing per option. Two groups that disagree on how many options there are
    // cannot be paired, so the cell is left as it was written.
    const widths = [...new Set(groups.map(g => g.length))].filter(n => n > 1);
    if (widths.length > 1) {
      out.push(option);
      continue;
    }

    const count = widths[0] || 1;
    for (let i = 0; i < count; i++) {
      out.push(groups.map(g => (g.length === 1 ? g[0] : g[i])).join('/'));
    }
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
 * The same punctuation the import used is accepted, plus a comma, so an admin
 * can paste a cell straight out of the price sheet and get the options it means.
 */
export function readBodyColourInput(text: string): string[] {
  const out: string[] = [];
  for (const chunk of String(text || '').split(',')) {
    out.push(...parseBodyColours(chunk));
  }
  return dedupe(out).filter(c => !NOT_A_COLOUR.test(c));
}
