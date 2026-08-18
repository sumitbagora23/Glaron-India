/**
 * The quotation PDF an admin sends back to a customer.
 *
 * Drawn by hand rather than printed from the page, because the two want
 * different things: the screen is a working surface with steppers and inputs,
 * this is the document that leaves the building.
 *
 * The document is orange on white — the Glaron accent carrying the masthead,
 * the customer card and the table head, with the mark itself in full colour on
 * a white ground. Every page is topped the same way, and the column headings
 * are printed once at the top and never again.
 *
 * jsPDF is loaded on demand by whoever calls this, so the console does not
 * carry a PDF writer around for the screens that never make one.
 */

import { splitLightColourLabel, lightColourSwatchRgb } from '../light-colours';

/** One priced line of the quotation. */
export interface QuotePdfLine {
  name: string;
  variant?: string;
  sku?: string;
  /**
   * The product picture, as it is held everywhere else in this console — a data
   * URL. Only the product list prints it; the priced quotation does not.
   */
  image?: string;
  /** Unit MRP, in rupees — the list price the rate is discounted from. */
  mrp: number;
  /** What the unit is actually quoted at, once the discount is off. */
  rate: number;
  quantity: number;
}

export interface QuotePdfDoc {
  /**
   * The shades the admin manages (LightColourService.names). A line keeps what
   * was ordered as one string — "7W · 2ft · Cool White" — so without the list
   * there is no telling the shade at its end from a body finish, and the box of
   * colour is left off rather than guessed at.
   */
  lightColourNames?: string[];
  /** Reference printed on the document, e.g. `QTN-417`. */
  quoteNo: string;
  dateLabel: string;
  customerName: string;
  customerMobile: string;
  lines: QuotePdfLine[];
  subtotal: number;
  /** The one discount across the quotation, e.g. `12%`. Blank if none. */
  discountLabel: string;
  /** The same figure as a number. */
  discountPercent: number;
  discount: number;
  total: number;
}

// The palette: Glaron orange on white, with warm tints for the quiet surfaces.
const ORANGE: [number, number, number] = [244, 124, 32];
const ORANGE_SOFT: [number, number, number] = [250, 186, 130];
const PEACH: [number, number, number] = [255, 245, 236];
const PEACH_LINE: [number, number, number] = [250, 219, 190];
const WAVE: [number, number, number] = [253, 240, 229];
const TEXT: [number, number, number] = [26, 26, 32];
const TEXT_MUTED: [number, number, number] = [90, 92, 100];
const TEXT_SOFT: [number, number, number] = [140, 142, 150];
const LINE: [number, number, number] = [236, 234, 232];
const WHITE: [number, number, number] = [255, 255, 255];

// A4 in points, and the margins everything is measured from.
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 30;
const RIGHT = PAGE_W - M;
const FOOT_Y = PAGE_H - 52;

// The table is a real grid: every column has a left edge and a width, and the
// borders are drawn from these so nothing can drift out of line.
const TABLE_W = RIGHT - M;
const COLS = {
  no:   { x: M,      w: 36 },
  name: { x: M + 36, w: TABLE_W - 36 - 80 - 60 - 100 },
  rate: { x: 0, w: 80 },
  qty:  { x: 0, w: 60 },
  amt:  { x: 0, w: 100 }
};
COLS.rate.x = COLS.name.x + COLS.name.w;
COLS.qty.x = COLS.rate.x + COLS.rate.w;
COLS.amt.x = COLS.qty.x + COLS.qty.w;

/** Inset for a figure in its cell. */
const PAD = 10;

/** Rupees, grouped the Indian way: 12,34,567. */
export function inr(value: number): string {
  const n = Math.round(Number(value) || 0);
  const sign = n < 0 ? '-' : '';
  const digits = String(Math.abs(n));
  if (digits.length <= 3) return sign + digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  return sign + rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
}

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
  'Eighteen', 'Nineteen'
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function underThousand(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) return (TENS[Math.floor(n / 10)] + ' ' + ONES[n % 10]).trim();
  return (ONES[Math.floor(n / 100)] + ' Hundred ' + underThousand(n % 100)).trim();
}

/**
 * The total spelled out, the way an Indian quotation reads it — crore, lakh,
 * thousand. Printed beside the total so the figure cannot be misread.
 */
export function amountInWords(value: number): string {
  const n = Math.round(Number(value) || 0);
  if (n <= 0) return 'Zero Rupees Only';

  const parts: string[] = [];
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;

  if (crore) parts.push(underThousand(crore) + ' Crore');
  if (lakh) parts.push(underThousand(lakh) + ' Lakh');
  if (thousand) parts.push(underThousand(thousand) + ' Thousand');
  if (rest) parts.push(underThousand(rest));

  return parts.join(' ') + ' Rupees Only';
}

/**
 * The logo, as pixels jsPDF can place.
 *
 * The full-colour mark, because this document is white where the console is
 * purple. Fetched rather than imported so the build keeps it an asset; if it
 * cannot be read the wordmark is drawn as text instead, since a missing
 * picture is no reason to withhold a quotation.
 */
async function loadLogo(): Promise<HTMLImageElement | null> {
  try {
    const img = new Image();
    img.src = 'assets/glaron-logo-dark.png';
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

/** A product picture, sized and re-encoded for the page. */
interface Thumb {
  /** JPEG data URL, small enough to sit in a document that gets emailed. */
  data: string;
  w: number;
  h: number;
  /** jsPDF reuses one image object per alias, so a repeated product costs once. */
  alias: string;
}

/**
 * Turn a product picture into something a page can carry.
 *
 * Redrawn through a canvas rather than handed to jsPDF as it comes, for three
 * reasons: the catalogue holds pictures in whatever format they were uploaded
 * in and jsPDF only takes PNG and JPEG; a 2000px photo in a 44pt box is a
 * megabyte of nothing; and a cut-out on transparency turns black in a JPEG
 * unless something white is put behind it first.
 *
 * Anything that cannot be read comes back null, and the row prints its empty
 * slot — a picture that will not load is no reason to withhold the list.
 */
async function loadThumb(src: string, alias: string, max = 200): Promise<Thumb | null> {
  if (!src) return null;
  try {
    const img = new Image();
    // Pictures live in Firestore as data URLs; the few that are served over
    // HTTP have to be fetched openly or the canvas below is tainted and its
    // pixels cannot be read back.
    if (!/^data:/i.test(src)) img.crossOrigin = 'anonymous';
    img.src = src;
    await img.decode();

    const sw = img.naturalWidth || img.width;
    const sh = img.naturalHeight || img.height;
    if (!sw || !sh) return null;

    const scale = Math.min(1, max / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * scale));
    const h = Math.max(1, Math.round(sh * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    return { data: canvas.toDataURL('image/jpeg', 0.72), w, h, alias };
  } catch {
    return null;
  }
}

/**
 * Every distinct picture in the document, read once.
 *
 * Keyed by the source, so a light used in four rooms is decoded once and placed
 * four times. Loaded a handful at a time — a whole flat's worth of data URLs
 * decoded at once is enough to stall the tab.
 */
async function loadThumbs(sources: string[]): Promise<Map<string, Thumb>> {
  const unique = Array.from(new Set(sources.filter(Boolean)));
  const found = new Map<string, Thumb>();

  for (let i = 0; i < unique.length; i += 6) {
    const batch = unique.slice(i, i + 6);
    const thumbs = await Promise.all(
      batch.map((src, n) => loadThumb(src, 'p' + (i + n)))
    );
    thumbs.forEach((thumb, n) => {
      if (thumb) found.set(batch[n], thumb);
    });
  }

  return found;
}

/** How a document is signed. */
export interface QuotePdfOptions {
  /**
   * Whether the house's name goes on it. Default true.
   *
   * Off, nothing on the page says Glaron: no mark in the masthead, no wordmark
   * where the mark would have been, nothing in the footer, and nothing in the
   * file's own properties or its name. The layout, the grid and the orange stay
   * — what goes is the signature, so the same quotation can be sent on by
   * somebody who does not want the source of it read off the top of the page.
   */
  branded?: boolean;
}

/**
 * What jsPDF has to be able to do for the line below. Structural, so the
 * instance the two builders make satisfies it without a type import.
 */
type PdfCanvas = {
  text: (text: string, x: number, y: number) => void;
  getTextWidth: (text: string) => number;
  rect: (x: number, y: number, w: number, h: number, style?: string) => void;
  setFillColor: (r: number, g: number, b: number) => void;
  setDrawColor: (r: number, g: number, b: number) => void;
  setLineWidth: (w: number) => void;
};

/**
 * The "variant · sku" line under a product name, with the box of colour set
 * right before the shade rather than in front of the wattage.
 *
 * `sub` is what gets printed; `variant` is the part of it the shade sits at
 * the end of. A line with no shade — or a document handed no list of shades to
 * recognise one by — is printed as one plain run of text, as it always was.
 */
function drawLineSub(
  doc: PdfCanvas,
  sub: string,
  variant: string | undefined,
  names: string[] | undefined,
  x: number,
  baseline: number
): void {
  const { head, colour } = splitLightColourLabel(variant || '', names || []);
  const rest = colour ? sub.slice(head.length) : '';
  if (!colour || !rest.startsWith(colour)) {
    doc.text(sub, x, baseline);
    return;
  }

  const BOX = 6.5;
  const GAP = 2.5;

  let cursor = x;
  if (head) {
    doc.text(head, cursor, baseline);
    cursor += doc.getTextWidth(head);
  }

  // One band per colour the shade is made of — "3 In 1" prints as three — and
  // a hairline round the lot, so a near-white shade is still a box on white
  // paper rather than nothing at all.
  const bands = lightColourSwatchRgb(colour);
  const top = baseline - BOX + 0.5;
  const band = BOX / bands.length;
  bands.forEach((rgb, i) => {
    doc.setFillColor(rgb[0], rgb[1], rgb[2]);
    doc.rect(cursor, top + i * band, BOX, band, 'F');
  });
  doc.setDrawColor(198, 198, 204);
  doc.setLineWidth(0.4);
  doc.rect(cursor, top, BOX, BOX, 'S');

  doc.text(rest, cursor + BOX + GAP, baseline);
}

/**
 * Build the document and hand back the file.
 *
 * Returns the blob rather than saving it, so the caller decides what to do with
 * it — open it, download it, or both.
 */
export async function createQuotationPdf(
  data: QuotePdfDoc, options: QuotePdfOptions = {}
): Promise<Blob> {
  const branded = options.branded !== false;
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  const logo = branded ? await loadLogo() : null;

  const setFont = (size: number, weight: 'normal' | 'bold' = 'normal') => {
    doc.setFont('helvetica', weight);
    doc.setFontSize(size);
  };
  const fill = (c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2]);
  const stroke = (c: [number, number, number], w = 0.7) => {
    doc.setDrawColor(c[0], c[1], c[2]);
    doc.setLineWidth(w);
  };
  const ink = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);

  /**
   * The masthead: mark on the left, QUOTATION on the right, over a soft wave
   * and the orange tab that runs off the right edge. The same on every page —
   * a document whose later pages are topped differently reads as a different
   * document.
   */
  const drawHeader = (): number => {
    // The wave behind it: a pale ellipse pushed off the top-right corner.
    fill(WAVE);
    doc.ellipse(PAGE_W - 90, -46, 300, 118, 'F');

    // The tab hanging off the right edge.
    fill(ORANGE);
    doc.roundedRect(PAGE_W - 14, 12, 26, 152, 8, 8, 'F');

    const logoH = 56;
    const logoW = logoH * (1540 / 825);
    if (logo) {
      doc.addImage(logo, 'PNG', M + 8, 26, logoW, logoH, undefined, 'FAST');
    } else if (branded) {
      setFont(20, 'bold');
      ink(TEXT);
      doc.text('GLARON', M + 8, 58);
      setFont(9, 'normal');
      ink(TEXT_MUTED);
      doc.text('Lighting Solutions', M + 8, 72);
    }

    // Unsigned, the title takes the corner the mark had — an empty half-page of
    // masthead reads as something that failed to print.
    setFont(24, 'bold');
    ink(ORANGE);
    if (branded) {
      doc.text('QUOTATION', RIGHT - 12, 54, { align: 'right' });
    } else {
      doc.text('QUOTATION', M + 8, 58);
      fill(ORANGE);
      doc.rect(M + 8, 70, 62, 3, 'F');
    }

    setFont(12, 'normal');
    ink(TEXT);
    doc.text(data.quoteNo, RIGHT - 12, 80, { align: 'right' });
    doc.text(data.dateLabel, RIGHT - 12, 102, { align: 'right' });

    // The dotted block that sits to the left of the reference.
    fill(ORANGE_SOFT);
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 6; col++) {
        doc.circle(RIGHT - 190 + col * 11, 66 + row * 11, 1.5, 'F');
      }
    }

    return 128;
  };

  /** The rule and small print that closes every page. */
  const drawFooter = (page: number, pages: number) => {
    fill(ORANGE);
    doc.rect(M, FOOT_Y + 6, 22, 3, 'F');
    // Unsigned, the reference stands where the name did: a loose page still has
    // to say which quotation it came off.
    const lead = branded ? 'GLARON INDIA' : data.quoteNo;
    const tail = branded ? '|  Lighting Solutions' : '|  Quotation';
    setFont(10, 'bold');
    ink(TEXT);
    doc.text(lead, M, FOOT_Y + 26);
    const w = doc.getTextWidth(lead);
    setFont(10, 'normal');
    ink(TEXT_SOFT);
    doc.text(tail, M + w + 8, FOOT_Y + 26);
    doc.text(`${page} / ${pages}`, RIGHT, FOOT_Y + 26, { align: 'right' });
  };

  /** The orange band the columns are named in. Drawn once, on page one. */
  const drawTableHead = (top: number): number => {
    fill(ORANGE);
    doc.roundedRect(M, top, TABLE_W, 30, 5, 5, 'F');
    ink(WHITE);
    setFont(9.5, 'bold');
    doc.text('#', COLS.no.x + PAD + 2, top + 19.5);
    doc.text('PRODUCT', COLS.name.x + PAD, top + 19.5);
    doc.text('RATE', COLS.rate.x + COLS.rate.w / 2, top + 19.5, { align: 'center' });
    doc.text('QTY', COLS.qty.x + COLS.qty.w / 2, top + 19.5, { align: 'center' });
    doc.text('AMOUNT', COLS.amt.x + COLS.amt.w / 2, top + 19.5, { align: 'center' });
    return top + 30;
  };

  /** The verticals for one page's worth of rows, drawn once it is filled. */
  const closeGrid = (top: number, bottom: number) => {
    if (bottom <= top) return;
    stroke(LINE, 0.7);
    for (const c of [COLS.name, COLS.rate, COLS.qty]) {
      doc.line(c.x + c.w, top, c.x + c.w, bottom);
    }
    doc.rect(M, top, TABLE_W, bottom - top, 'S');
  };

  // ---- Page one ----
  let y = drawHeader();

  // Who it is for: a warm card with the mark of a person on it, which is what
  // the eye finds first after the title.
  y += 14;
  const cardH = 76;
  fill(PEACH);
  stroke(PEACH_LINE, 0.8);
  doc.roundedRect(M, y, TABLE_W, cardH, 10, 10, 'FD');

  const cx = M + 40;
  const cy = y + cardH / 2;
  fill(ORANGE);
  doc.circle(cx, cy, 21, 'F');
  fill(WHITE);
  doc.circle(cx, cy - 5.5, 6, 'F');
  doc.roundedRect(cx - 9, cy + 3, 18, 11, 5.5, 5.5, 'F');

  setFont(9, 'bold');
  ink(ORANGE);
  doc.text('QUOTATION FOR', cx + 34, y + 26);
  setFont(15, 'bold');
  ink(TEXT);
  doc.text(data.customerName || 'Customer', cx + 34, y + 48);
  if (data.customerMobile) {
    setFont(11, 'normal');
    ink(TEXT_MUTED);
    doc.text('+91 ' + data.customerMobile, cx + 34, y + 65);
  }

  y += cardH + 20;

  // ---- The table ----
  let page = 1;
  y = drawTableHead(y);
  let gridTop = y;

  let index = 0;
  for (const line of data.lines) {
    index += 1;
    const sub = [line.variant, line.sku].filter(Boolean).join('   ·   ');
    const nameLines = doc.splitTextToSize(line.name || 'Product', COLS.name.w - PAD * 2) as string[];
    const rowH = Math.max(38, 20 + nameLines.length * 12 + (sub ? 11 : 0));

    // A row is never split across pages, and the headings are not repeated —
    // the grid simply carries on under the same masthead.
    if (y + rowH > FOOT_Y - 20) {
      closeGrid(gridTop, y);
      doc.addPage();
      page += 1;
      y = drawHeader() + 10;
      gridTop = y;
    }

    setFont(10, 'normal');
    ink(TEXT_SOFT);
    doc.text(String(index), COLS.no.x + PAD + 2, y + 22);

    setFont(10.5, 'bold');
    ink(TEXT);
    let textY = y + 22;
    for (const l of nameLines) {
      doc.text(l, COLS.name.x + PAD, textY);
      textY += 12;
    }
    if (sub) {
      setFont(8.5, 'normal');
      ink(TEXT_SOFT);
      drawLineSub(doc, sub, line.variant, data.lightColourNames, COLS.name.x + PAD, textY - 1);
    }

    setFont(10.5, 'bold');
    ink(TEXT);
    doc.text(inr(line.rate), COLS.rate.x + COLS.rate.w - PAD, y + 22, { align: 'right' });
    setFont(10, 'normal');
    ink(TEXT_MUTED);
    doc.text(String(line.quantity), COLS.qty.x + COLS.qty.w - PAD, y + 22, { align: 'right' });
    setFont(10.5, 'bold');
    ink(TEXT);
    doc.text(
      inr(Math.round(line.rate * line.quantity)),
      COLS.amt.x + COLS.amt.w - PAD, y + 22, { align: 'right' }
    );

    y += rowH;
    stroke(LINE, 0.7);
    doc.line(M, y, RIGHT, y);
  }

  // ---- What it comes to ----
  // The grid is closed off first, so the total is one unbroken bar underneath
  // it rather than a last row with the column rules cutting through the words.
  closeGrid(gridTop, y);

  const totalH = 40;
  if (y + totalH + 10 > FOOT_Y - 10) {
    doc.addPage();
    page += 1;
    y = drawHeader() + 10;
  } else {
    y += 10;
  }

  // Added up from the amounts printed above rather than taken on trust, so the
  // document can never show a total its own lines do not come to.
  const printedTotal = data.lines.reduce((sum, l) => sum + Math.round(l.rate * l.quantity), 0);

  fill(ORANGE);
  doc.roundedRect(M, y, TABLE_W, totalH, 6, 6, 'F');

  setFont(9.5, 'bold');
  ink(WHITE);
  doc.text('TOTAL', M + PAD + 2, y + 24.5);

  setFont(8.5, 'normal');
  ink([255, 232, 210]);
  const words = doc.splitTextToSize(amountInWords(printedTotal), TABLE_W - 260) as string[];
  doc.text(words[0], M + PAD + 52, y + 24.5);

  setFont(15, 'bold');
  ink(WHITE);
  doc.text('Rs. ' + inr(printedTotal), RIGHT - PAD, y + 26, { align: 'right' });

  // ---- Footers, once the page count is known ----
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    drawFooter(p, pages);
  }

  // The properties are part of the signature too — a reader that shows the
  // title bar would put the name back on an unsigned document.
  doc.setProperties(branded ? {
    title: `Quotation ${data.quoteNo} — Glaron India`,
    subject: `Quotation for ${data.customerName}`,
    creator: 'Glaron India Admin Console'
  } : {
    title: `Quotation ${data.quoteNo}`,
    subject: `Quotation for ${data.customerName}`,
    creator: ''
  });

  return doc.output('blob') as Blob;
}

/**
 * A quiet, unambiguous file name: `Glaron-Quotation-QTN-417-Ravi.pdf`.
 *
 * Unsigned, the house's name comes off this as well — a document with nothing
 * of Glaron on any page of it, sent as `Glaron-Quotation-…pdf`, has been signed
 * by its own file name.
 */
export function quotationFileName(quoteNo: string, customerName: string, branded = true): string {
  const who = (customerName || '').trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const lead = branded ? 'Glaron-Quotation' : 'Quotation';
  return [lead, quoteNo, who].filter(Boolean).join('-') + '.pdf';
}

/** The same, for a document that carries no prices. */
export function areaListFileName(quoteNo: string, customerName: string): string {
  const who = (customerName || '').trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return ['Glaron-Product-List', quoteNo, who].filter(Boolean).join('-') + '.pdf';
}

// ============================================================================
// Area-wise documents
//
// The area-wise link sends the job split by room, and both documents keep that
// split — a customer doing a whole flat reads "Kitchen", not lines 14 to 22.
// Two of them, because they answer two different questions:
//
//   • the product list — what is going where, with no money on it at all. It is
//     what gets handed to the electrician, or checked over with the customer
//     before anybody talks about price.
//   • the quotation — the same areas, priced, with what each room comes to and
//     one total underneath.
//
// They share every drawn part with the quotation above: same masthead, same
// customer card, same footer, same table grid.
// ============================================================================

/** One area's worth of a document. */
export interface AreaPdfArea {
  name: string;
  lines: QuotePdfLine[];
}

export interface AreaPdfDoc {
  /** As on the quotation — see QuotePdfDoc.lightColourNames. */
  lightColourNames?: string[];
  quoteNo: string;
  dateLabel: string;
  customerName: string;
  customerMobile: string;
  areas: AreaPdfArea[];
  /** The one discount across the job, e.g. `12%`. Blank if none. */
  discountLabel: string;
  /** Total at list price, before the discount. */
  subtotal: number;
  /** What comes off. */
  discount: number;
  total: number;
}

/**
 * The columns of the no-price list: number, picture, product, and how many.
 *
 * The picture is the point of this sheet. It is read on site by somebody
 * holding a box, and "12 W COB Spot · 90 mm" settles nothing at that moment —
 * the fitting in the picture does.
 */
const LIST_COLS = {
  no:   { x: M,           w: 30 },
  img:  { x: M + 30,      w: 62 },
  name: { x: M + 92,      w: TABLE_W - 92 - 84 },
  qty:  { x: 0,           w: 84 }
};
LIST_COLS.qty.x = LIST_COLS.name.x + LIST_COLS.name.w;

/** The side of the square a product picture is fitted into. */
const THUMB = 44;

/**
 * Everything both documents draw the same way.
 *
 * Handed a jsPDF instance and what goes in the masthead, it returns the pieces
 * a page is built from. Written as a factory rather than free functions so the
 * palette, the font helpers and the page metrics are captured once.
 */
function chrome(doc: any, logo: HTMLImageElement | null, meta: {
  title: string; quoteNo: string; dateLabel: string; customerName: string; customerMobile: string;
}) {
  const setFont = (size: number, weight: 'normal' | 'bold' = 'normal') => {
    doc.setFont('helvetica', weight);
    doc.setFontSize(size);
  };
  const fill = (c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2]);
  const stroke = (c: [number, number, number], w = 0.7) => {
    doc.setDrawColor(c[0], c[1], c[2]);
    doc.setLineWidth(w);
  };
  const ink = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);

  /** The masthead, identical on every page of both documents. */
  const drawHeader = (): number => {
    fill(WAVE);
    doc.ellipse(PAGE_W - 90, -46, 300, 118, 'F');

    fill(ORANGE);
    doc.roundedRect(PAGE_W - 14, 12, 26, 152, 8, 8, 'F');

    const logoH = 56;
    const logoW = logoH * (1540 / 825);
    if (logo) {
      doc.addImage(logo, 'PNG', M + 8, 26, logoW, logoH, undefined, 'FAST');
    } else {
      setFont(20, 'bold');
      ink(TEXT);
      doc.text('GLARON', M + 8, 58);
      setFont(9, 'normal');
      ink(TEXT_MUTED);
      doc.text('Lighting Solutions', M + 8, 72);
    }

    // The one word that says which document this is.
    setFont(meta.title.length > 12 ? 19 : 24, 'bold');
    ink(ORANGE);
    doc.text(meta.title, RIGHT - 12, 54, { align: 'right' });

    setFont(12, 'normal');
    ink(TEXT);
    doc.text(meta.quoteNo, RIGHT - 12, 80, { align: 'right' });
    doc.text(meta.dateLabel, RIGHT - 12, 102, { align: 'right' });

    fill(ORANGE_SOFT);
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 6; col++) {
        doc.circle(RIGHT - 190 + col * 11, 66 + row * 11, 1.5, 'F');
      }
    }

    return 128;
  };

  const drawFooter = (page: number, pages: number) => {
    fill(ORANGE);
    doc.rect(M, FOOT_Y + 6, 22, 3, 'F');
    setFont(10, 'bold');
    ink(TEXT);
    doc.text('GLARON INDIA', M, FOOT_Y + 26);
    const w = doc.getTextWidth('GLARON INDIA');
    setFont(10, 'normal');
    ink(TEXT_SOFT);
    doc.text('|  Lighting Solutions', M + w + 8, FOOT_Y + 26);
    doc.text(`${page} / ${pages}`, RIGHT, FOOT_Y + 26, { align: 'right' });
  };

  /** Who it is for — the warm card under the masthead on page one. */
  const drawCustomer = (top: number, label: string): number => {
    const cardH = 76;
    fill(PEACH);
    stroke(PEACH_LINE, 0.8);
    doc.roundedRect(M, top, TABLE_W, cardH, 10, 10, 'FD');

    const cx = M + 40;
    const cy = top + cardH / 2;
    fill(ORANGE);
    doc.circle(cx, cy, 21, 'F');
    fill(WHITE);
    doc.circle(cx, cy - 5.5, 6, 'F');
    doc.roundedRect(cx - 9, cy + 3, 18, 11, 5.5, 5.5, 'F');

    setFont(9, 'bold');
    ink(ORANGE);
    doc.text(label, cx + 34, top + 26);
    setFont(15, 'bold');
    ink(TEXT);
    doc.text(meta.customerName || 'Customer', cx + 34, top + 48);
    if (meta.customerMobile) {
      setFont(11, 'normal');
      ink(TEXT_MUTED);
      doc.text('+91 ' + meta.customerMobile, cx + 34, top + 65);
    }
    return top + cardH;
  };

  /**
   * The band naming an area, drawn above its rows.
   *
   * Peach rather than orange, with a solid orange tab on the left: it has to
   * read as a heading over the table below it, not as another row of it.
   */
  const drawAreaBand = (top: number, name: string, right?: string): number => {
    const h = 28;
    fill(PEACH);
    stroke(PEACH_LINE, 0.8);
    doc.roundedRect(M, top, TABLE_W, h, 5, 5, 'FD');
    fill(ORANGE);
    doc.roundedRect(M, top + 6, 4, h - 12, 2, 2, 'F');

    setFont(11, 'bold');
    ink(TEXT);
    doc.text((name || 'Area').toUpperCase(), M + 14, top + 18.5);

    if (right) {
      setFont(9.5, 'bold');
      ink(ORANGE);
      doc.text(right, RIGHT - PAD, top + 18.5, { align: 'right' });
    }
    return top + h;
  };

  return { setFont, fill, stroke, ink, drawHeader, drawFooter, drawCustomer, drawAreaBand };
}

/**
 * The product list: every area, what goes in it and what each one looks like,
 * and not one figure of money anywhere.
 *
 * Deliberately so. This is the sheet that gets checked against the site — the
 * question it answers is "is this the right light in the right room", and a
 * rate column in the margin only invites the other conversation to start early.
 * The pictures are here for the same reason the prices are not: the person
 * holding this sheet is looking at fittings, not at a price list.
 */
export async function createAreaSummaryPdf(data: AreaPdfDoc): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  const logo = await loadLogo();
  const k = chrome(doc, logo, {
    title: 'PRODUCT LIST',
    quoteNo: data.quoteNo,
    dateLabel: data.dateLabel,
    customerName: data.customerName,
    customerMobile: data.customerMobile
  });

  // Every picture in the job, read once before a single row is drawn — the same
  // fitting used in four rooms is decoded once and placed four times.
  const thumbs = await loadThumbs(
    ([] as QuotePdfLine[])
      .concat(...data.areas.map(area => area.lines))
      .map(line => line.image || '')
  );

  const drawHead = (top: number): number => {
    k.fill(ORANGE);
    doc.roundedRect(M, top, TABLE_W, 26, 5, 5, 'F');
    k.ink(WHITE);
    k.setFont(9.5, 'bold');
    doc.text('#', LIST_COLS.no.x + 8, top + 17.5);
    doc.text('PRODUCT', LIST_COLS.img.x + 8, top + 17.5);
    doc.text('QUANTITY', LIST_COLS.qty.x + LIST_COLS.qty.w / 2, top + 17.5, { align: 'center' });
    return top + 26;
  };

  const closeGrid = (top: number, bottom: number) => {
    if (bottom <= top) return;
    k.stroke(LINE, 0.7);
    doc.line(LIST_COLS.name.x + LIST_COLS.name.w, top, LIST_COLS.name.x + LIST_COLS.name.w, bottom);
    doc.rect(M, top, TABLE_W, bottom - top, 'S');
  };

  /**
   * One product's picture, in its own square in the row.
   *
   * The square is drawn whether or not there is anything to put in it, so a
   * catalogue entry with no photograph leaves a blank slot rather than a
   * collapsed row — the column stays a column all the way down the page.
   */
  const drawThumb = (top: number, rowH: number, src?: string) => {
    const bx = LIST_COLS.img.x + (LIST_COLS.img.w - THUMB) / 2;
    const by = top + (rowH - THUMB) / 2;

    k.fill(WHITE);
    k.stroke(PEACH_LINE, 0.7);
    doc.roundedRect(bx, by, THUMB, THUMB, 5, 5, 'FD');

    const thumb = src ? thumbs.get(src) : undefined;
    if (!thumb) {
      k.fill(PEACH);
      doc.roundedRect(bx + 1.5, by + 1.5, THUMB - 3, THUMB - 3, 4, 4, 'F');
      k.fill(ORANGE_SOFT);
      doc.circle(bx + THUMB / 2, by + THUMB / 2, 5.5, 'F');
      return;
    }

    // Fitted inside the square rather than filled to it: these are catalogue
    // shots of different shapes, and a cropped fitting is the wrong fitting.
    const inner = THUMB - 6;
    const fit = Math.min(inner / thumb.w, inner / thumb.h);
    const w = thumb.w * fit;
    const h = thumb.h * fit;
    doc.addImage(
      thumb.data, 'JPEG',
      bx + (THUMB - w) / 2, by + (THUMB - h) / 2, w, h,
      thumb.alias, 'FAST'
    );
  };

  let y = k.drawHeader();
  y = k.drawCustomer(y + 14, 'PRODUCT LIST FOR') + 20;

  for (const area of data.areas) {
    const pieces = area.lines.reduce((sum, l) => sum + (l.quantity || 0), 0);

    // An area starts on a page that has room for its band and a row under it.
    if (y + 96 > FOOT_Y - 20) {
      doc.addPage();
      y = k.drawHeader() + 10;
    }

    y = k.drawAreaBand(y, area.name, `${area.lines.length} ${area.lines.length === 1 ? 'PRODUCT' : 'PRODUCTS'}  ·  ${pieces} ${pieces === 1 ? 'PC' : 'PCS'}`);
    y += 6;
    y = drawHead(y);
    let gridTop = y;

    let index = 0;
    for (const line of area.lines) {
      index += 1;
      const sub = [line.variant, line.sku].filter(Boolean).join('   ·   ');
      const nameLines = doc.splitTextToSize(line.name || 'Product', LIST_COLS.name.w - PAD * 2) as string[];
      // Never shorter than the picture it has to hold.
      const rowH = Math.max(THUMB + 14, 18 + nameLines.length * 12 + (sub ? 11 : 0));

      if (y + rowH > FOOT_Y - 20) {
        closeGrid(gridTop, y);
        doc.addPage();
        y = k.drawHeader() + 10;
        // The area is named again on the new page, so a sheet read on its own
        // still says which room these products are for.
        y = k.drawAreaBand(y, area.name + ' (contd.)');
        y += 6;
        y = drawHead(y);
        gridTop = y;
      }

      // Taller rows now, so everything in one is set against the middle of it
      // rather than hung off the top with the picture floating alongside.
      const mid = y + rowH / 2;

      k.setFont(10, 'normal');
      k.ink(TEXT_SOFT);
      doc.text(String(index), LIST_COLS.no.x + 8, mid + 3.5);

      drawThumb(y, rowH, line.image);

      const blockH = nameLines.length * 12 + (sub ? 11 : 0);
      k.setFont(10.5, 'bold');
      k.ink(TEXT);
      let textY = mid - blockH / 2 + 9;
      for (const l of nameLines) {
        doc.text(l, LIST_COLS.name.x + PAD, textY);
        textY += 12;
      }
      if (sub) {
        k.setFont(8.5, 'normal');
        k.ink(TEXT_SOFT);
        drawLineSub(doc, sub, line.variant, data.lightColourNames, LIST_COLS.name.x + PAD, textY - 1);
      }

      k.setFont(11, 'bold');
      k.ink(TEXT);
      doc.text(String(line.quantity), LIST_COLS.qty.x + LIST_COLS.qty.w / 2, mid + 4, { align: 'center' });

      y += rowH;
      k.stroke(LINE, 0.7);
      doc.line(M, y, RIGHT, y);
    }

    closeGrid(gridTop, y);
    y += 18;
  }

  // What the whole job comes to in pieces — the only total a list like this can
  // honestly carry.
  const areas = data.areas.length;
  const products = data.areas.reduce((sum, a) => sum + a.lines.length, 0);
  const pieces = data.areas.reduce(
    (sum, a) => sum + a.lines.reduce((n, l) => n + (l.quantity || 0), 0), 0
  );

  if (y + 46 > FOOT_Y - 10) {
    doc.addPage();
    y = k.drawHeader() + 10;
  }
  k.fill(ORANGE);
  doc.roundedRect(M, y, TABLE_W, 36, 6, 6, 'F');
  k.setFont(9.5, 'bold');
  k.ink(WHITE);
  doc.text('SUMMARY', M + PAD + 2, y + 22.5);
  k.setFont(11, 'bold');
  doc.text(
    `${areas} ${areas === 1 ? 'area' : 'areas'}   ·   ${products} ${products === 1 ? 'product' : 'products'}   ·   ${pieces} ${pieces === 1 ? 'piece' : 'pieces'}`,
    RIGHT - PAD, y + 22.5, { align: 'right' }
  );

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    k.drawFooter(p, pages);
  }

  doc.setProperties({
    title: `Product List ${data.quoteNo} — Glaron India`,
    subject: `Area-wise product list for ${data.customerName}`,
    creator: 'Glaron India Admin Console'
  });

  return doc.output('blob') as Blob;
}
