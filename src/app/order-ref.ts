// ────────────────────────────────────────────────────────────────────────────
// ORDER REFERENCE LABEL — the one place that decides how an order is named on
// screen. Everything (dealer app, agent panel, admin console) shows the same
// short "ORD - 417" instead of the raw Firestore document id.
//
// The three digits are hashed out of the document id, so they look random but
// are stable: the same order shows the same number in every app, on every
// device, for life. Nothing is stored, so old orders get a label too.
// ────────────────────────────────────────────────────────────────────────────

/** Three digits (100–999) derived from the order id via FNV-1a. */
export function orderRefDigits(id: string | null | undefined): string {
  const key = String(id ?? '');
  if (!key) return '000';
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return String(100 + (Math.abs(h) % 900));
}

/** Display label for an order, e.g. `ORD - 417`. */
export function orderRefLabel(id: string | null | undefined): string {
  return `ORD - ${orderRefDigits(id)}`;
}
