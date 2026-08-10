import { Injectable } from '@angular/core';

/**
 * Shared language state + translation for the dealer-facing pages.
 *
 * Three kinds of text are handled:
 *  - Static app chrome (labels, buttons) — translated in the components via a
 *    hand-written dictionary (see each page's `translations` map).
 *  - `td()` — MEANING translation for descriptive dynamic text (product/category
 *    descriptions) and fixed statuses (order stages). English "Delivered"
 *    becomes "वितरित".
 *  - `tn()` — NAME transliteration for proper names (product titles, category
 *    names). These are brand names, so their MEANING must NOT change; they are
 *    only rewritten in the Devanagari script with the same pronunciation, e.g.
 *    "Ball Light" -> "बॉल लाइट", "Cube" -> "क्यूब".
 *
 * Both `td()` and `tn()` work the same way at runtime:
 *   1. A curated override wins first (guarantees correct wording).
 *   2. Otherwise a cached result is used.
 *   3. On a cache miss the English text is returned immediately and the Hindi
 *      form is fetched in the background; when it resolves the cache updates and
 *      Angular re-renders it. Results persist to localStorage, so after the
 *      first view every string is instant and available offline.
 */
@Injectable({ providedIn: 'root' })
export class DealerI18nService {
  lang: 'en' | 'hi' = 'en';

  private readonly LANG_KEY = 'glaron_dealer_lang';
  private readonly CACHE_KEY = 'glaron_hi_cache';       // meaning translations
  private readonly NAME_CACHE_KEY = 'glaron_hi_names';  // name transliterations

  // english -> hindi caches, mirrored to localStorage.
  private cache = new Map<string, string>();
  private nameCache = new Map<string, string>();
  // Keys with a request in flight ('t:'/'n:' prefixed), so we never double-fetch.
  private pending = new Set<string>();

  // MEANING overrides for td(): order stages must read exactly right.
  // Worded the way an order status is actually spoken in Hindi, not word-for-word:
  // "Delivered" is डिलीवर हो गया (the package arrived), never वितरित (distributed).
  private readonly translateOverrides: Record<string, string> = {
    'New': 'नया ऑर्डर',
    'Pending': 'ऑर्डर लंबित',
    'Order Received': 'ऑर्डर मिल गया',
    'Confirmed': 'पुष्टि हो गई',
    'Packed': 'पैक हो गया',
    'Dispatched': 'भेज दिया गया',
    'Delivered': 'डिलीवर हो गया',
    'Paid': 'भुगतान हो गया'
  };

  // NAME overrides for tn(): categories and known product-name spellings, given
  // in Devanagari with the SAME pronunciation (transliteration, not meaning).
  // Anything not listed falls through to the transliteration service.
  private readonly nameOverrides: Record<string, string> = {
    // Filter option (this one is a UI phrase, kept readable in Hindi)
    'All Categories': 'सभी श्रेणियाँ',
    // Categories
    'Flood': 'फ्लड',
    'Street': 'स्ट्रीट',
    'Solar': 'सोलर',
    'COB': 'सीओबी',
    'Panel': 'पैनल',
    'Surface': 'सरफेस',
    'Concealed': 'कंसील्ड',
    'Cylinder': 'सिलेंडर',
    'Wall Light': 'वॉल लाइट',
    'Foot Light': 'फुट लाइट',
    'Gate Light': 'गेट लाइट',
    'Track Light': 'ट्रैक लाइट',
    'Rope & Striped Light': 'रोप एंड स्ट्राइप्ड लाइट',
    // Category combinations (a product can list more than one category)
    'COB, Cylinder': 'सीओबी, सिलेंडर',
    'Street, Solar': 'स्ट्रीट, सोलर',
    'Track Light, Wall Light': 'ट्रैक लाइट, वॉल लाइट',
    // Product-name spellings the auto-transliteration gets wrong
    'Aura Max': 'औरा मैक्स',
    'Casette': 'कैसेट',
    'Curve': 'कर्व',
    'Curve Wall': 'कर्व वॉल',
    'Deep Downlight': 'डीप डाउनलाइट',
    'Glare': 'ग्लेयर',
    'Glon': 'ग्लोन',
    'GM Flood': 'जीएम फ्लड',
    'Tracklight': 'ट्रैकलाइट',
    'Elegance': 'एलिगेंस',
    'Inground': 'इनग्राउंड',
    'Magna': 'मैग्ना',
    'Updown Wall': 'अपडाउन वॉल',
    'K-Type': 'के-टाइप',
    'Duo R': 'डुओ आर',
    'Movable Cylinder': 'मूवेबल सिलेंडर'
  };

  constructor() {
    try {
      const savedLang = localStorage.getItem(this.LANG_KEY);
      if (savedLang === 'hi' || savedLang === 'en') this.lang = savedLang;
      this.loadCache(this.CACHE_KEY, this.cache);
      this.loadCache(this.NAME_CACHE_KEY, this.nameCache);
    } catch (e) {}
  }

  private loadCache(key: string, target: Map<string, string>) {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || '{}');
      for (const k of Object.keys(saved)) {
        if (typeof saved[k] === 'string') target.set(k, saved[k]);
      }
    } catch (e) {}
  }

  setLang(lang: 'en' | 'hi') {
    this.lang = lang;
    try {
      localStorage.setItem(this.LANG_KEY, lang);
    } catch (e) {}
  }

  /**
   * MEANING translation for descriptive text and statuses. Returns the original
   * text when English is selected, empty, or while the Hindi form is loading.
   */
  td(text: string | null | undefined): string {
    if (this.lang !== 'hi' || !text) return text || '';
    const key = String(text).trim();
    if (!key) return text;
    if (this.translateOverrides[key]) return this.translateOverrides[key];
    const cached = this.cache.get(key);
    if (cached) return cached;
    this.fetchTranslation(key);
    return text;
  }

  /**
   * NAME transliteration for proper names (product titles, category names).
   * Keeps the pronunciation, only changes the script. Same fallback behaviour
   * as td().
   */
  tn(text: string | null | undefined): string {
    if (this.lang !== 'hi' || !text) return text || '';
    const key = String(text).trim();
    if (!key) return text;
    if (this.nameOverrides[key]) return this.nameOverrides[key];
    const cached = this.nameCache.get(key);
    if (cached) return cached;
    this.fetchTransliteration(key);
    return text;
  }

  private fetchTranslation(text: string) {
    const guard = 't:' + text;
    if (this.pending.has(guard)) return;
    this.pending.add(guard);
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=hi&dt=t&q=' +
      encodeURIComponent(text);
    fetch(url)
      .then(r => r.json())
      .then(data => {
        const segments = Array.isArray(data) && Array.isArray(data[0]) ? data[0] : [];
        const translated = segments.map((s: any) => (s && s[0]) ? s[0] : '').join('').trim();
        if (translated) {
          this.cache.set(text, translated);
          this.persist(this.CACHE_KEY, this.cache);
        }
      })
      .catch(() => { /* keep English on failure */ })
      .finally(() => this.pending.delete(guard));
  }

  // Transliterate a name to Devanagari via Google Input Tools, word by word so
  // multi-word names keep their spacing (e.g. "Wall Light" -> "वॉल लाइट").
  private fetchTransliteration(text: string) {
    const guard = 'n:' + text;
    if (this.pending.has(guard)) return;
    this.pending.add(guard);
    const words = text.split(/\s+/).filter(Boolean);
    Promise.all(words.map(w => this.transliterateWord(w)))
      .then(parts => {
        const joined = parts.join(' ').trim();
        if (joined) {
          this.nameCache.set(text, joined);
          this.persist(this.NAME_CACHE_KEY, this.nameCache);
        }
      })
      .catch(() => { /* keep English on failure */ })
      .finally(() => this.pending.delete(guard));
  }

  // Resolves to the Devanagari form of a single word, or the word unchanged.
  private transliterateWord(word: string): Promise<string> {
    // Preserve tokens that aren't alphabetic words (numbers, "&", symbols).
    if (!/[a-zA-Z]/.test(word)) return Promise.resolve(word);
    const url = 'https://inputtools.google.com/request?text=' + encodeURIComponent(word) +
      '&itc=hi-t-i0-und&num=1&cp=0&cs=1&ie=utf-8&oe=utf-8';
    return fetch(url)
      .then(r => r.json())
      .then(d => {
        if (d && d[0] === 'SUCCESS' && d[1] && d[1][0] && d[1][0][1] && d[1][0][1][0]) {
          return d[1][0][1][0] as string;
        }
        return word;
      })
      .catch(() => word);
  }

  private persist(key: string, source: Map<string, string>) {
    try {
      const obj: Record<string, string> = {};
      source.forEach((v, k) => { obj[k] = v; });
      localStorage.setItem(key, JSON.stringify(obj));
    } catch (e) {}
  }
}
