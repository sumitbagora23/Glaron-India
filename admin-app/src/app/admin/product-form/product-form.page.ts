import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, FormArray, Validators, ReactiveFormsModule, FormsModule, AbstractControl, ValidationErrors } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { Product, ProductService, ProductVariant } from '../product.service';
import { CategoryService, Category } from '../category.service';
import { LightColourService } from '../light-colour.service';
import { NO_COLOUR, lightColourSwatch } from '../light-colours';
import { orderableBodyColours, readBodyColourInput } from '../body-colours';
import { buildSpecTabs } from '../product-spec-tabs';

@Component({
  selector: 'app-product-form',
  templateUrl: './product-form.page.html',
  styleUrls: ['./product-form.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    IonContent
  ]
})
export class ProductFormPage implements OnInit {

  // The box of colour drawn before a light colour name. Worked out from the
  // name itself, so a shade added today is painted without a code change.
  swatch(colour: string): string {
    return lightColourSwatch(colour);
  }

  productForm!: FormGroup;
  isEditMode = false;
  productId = '';
  isLoading = false;
  submitted = false;
  // Surfaced when a save (or an image read) fails, so a failed sync is never
  // mistaken for a successful one.
  saveError = '';

  // Product image (data URL). Preloaded in edit mode, replaced on upload.
  imagePreview: string | null = null;

  // Multi-select categories (managed outside the reactive form for simple
  // checkbox handling). A product can belong to several categories.
  selectedCategories: string[] = [];
  categoryDropdownOpen = false;

  // Multi-select light colours ("Warm White", "Cool White", ...). Held outside
  // the reactive form like the categories above, for the same checkbox handling.
  // Every catalogue card reads these back behind the wattage / dimension tabs.
  selectedLightColours: string[] = [];

  /**
   * The finishes this product is sold in, as the admin types them.
   *
   * Free text rather than a picker: the finishes vary too much by range to be
   * worth a managed list the way light colours are. A comma separates them, and
   * so does the "|" the price sheet uses, so a cell can be pasted in whole.
   * What is stored is the parsed list — see readBodyColourInput().
   */
  bodyColoursText = '';

  /** What the typed text will actually be stored as, shown back as chips. */
  get bodyColourPreview(): string[] {
    return readBodyColourInput(this.bodyColoursText);
  }
  lightColourDropdownOpen = false;
  // What each shade costs, keyed by colour name. An absolute price, not a
  // surcharge. Blank means that shade is sold at the option's own price.
  lightColourPrices: { [colour: string]: number } = {};

  // Which target the picker is writing to: -1 is the product itself, anything
  // else is that variant's index. A 7W sold in warm white alone, next to a 12W
  // sold in three shades, is one product with one option overridden — so the
  // picker carries a strip of tabs, one per option, above it.
  lightColourTab = -1;
  // Those tabs, labelled the way the dealer card labels them (the wattage, and
  // whatever separates two options that read the same). Rebuilt whenever the
  // variants below change, so a wattage typed in shows on its tab at once.
  variantTabs: { index: number; label: string; detail: string }[] = [];

  // Where a half-filled product waits while the admin is off on the Light
  // Colours page. sessionStorage, so it lives exactly as long as the tab and
  // never turns into a stale draft on the next visit.
  private static readonly DRAFT_KEY = 'glaron_product_form_draft';

  constructor(
    private fb: FormBuilder,
    private route: ActivatedRoute,
    private router: Router,
    private productService: ProductService,
    private categoryService: CategoryService,
    private lightColourService: LightColourService
  ) {}

  // The shades on offer, managed on the Light Colours page. A getter, not a
  // copy: a colour added over there shows up here the moment we come back.
  get lightColourOptions(): string[] {
    return this.lightColourService.names;
  }

  // Category options for the dropdown, managed in the Categories tab.
  get categories(): Category[] {
    return this.categoryService.categories;
  }

  toggleCategoryDropdown() {
    this.categoryDropdownOpen = !this.categoryDropdownOpen;
    // Only one panel open at a time — two expanded lists push the form around.
    if (this.categoryDropdownOpen) this.lightColourDropdownOpen = false;
  }

  closeCategoryDropdown() {
    this.categoryDropdownOpen = false;
  }

  // Slows down scrolling inside the categories dropdown panel (applies a reduced
  // scroll delta), so it scrolls gently instead of jumping several rows at once.
  onCategoryWheel(event: WheelEvent) {
    const panel = event.currentTarget as HTMLElement;
    if (!panel) return;
    event.preventDefault();
    panel.scrollTop += event.deltaY * 0.35;
  }

  isCategorySelected(name: string): boolean {
    return this.selectedCategories.includes(name);
  }

  toggleCategory(name: string) {
    this.selectedCategories = this.isCategorySelected(name)
      ? this.selectedCategories.filter(c => c !== name)
      : [...this.selectedCategories, name];
  }

  // ---- Light colours ----
  //
  // Which shades this product can be ordered in. Optional: a product with no
  // colours picked simply shows its price on the dealer card, unchanged.
  //
  // The picker writes to one target at a time — the product, or one of its
  // options (see lightColourTab). An option holds a list of its own only once
  // the admin actually changes something under its tab; until then it is sold
  // in the product's shades, which is how every product saved before this
  // existed still reads.
  toggleLightColourDropdown() {
    this.lightColourDropdownOpen = !this.lightColourDropdownOpen;
    if (this.lightColourDropdownOpen) this.categoryDropdownOpen = false;
  }

  // The tabs above the picker, one per option, labelled like the dealer card.
  private rebuildVariantTabs() {
    const variants = this.variantsArray.getRawValue() as ProductVariant[];
    this.variantTabs = buildSpecTabs({ id: 'form', variants } as Product)
      .map(tab => ({ index: tab.index, label: tab.label, detail: tab.detail }));
    // An option removed while its own tab was open must not leave the picker
    // writing to an index that is now a different option, or gone.
    if (this.lightColourTab >= variants.length) this.lightColourTab = -1;
  }

  selectLightColourTab(index: number) {
    this.lightColourTab = index;
    this.lightColourDropdownOpen = false;
  }

  private variantGroup(index: number): FormGroup | null {
    return index >= 0 && index < this.variantsArray.length
      ? this.variantsArray.at(index) as FormGroup
      : null;
  }

  // The shades written against one option — empty while it follows the product.
  private ownColours(index: number): string[] {
    return (this.variantGroup(index)?.get('lightColours')?.value as string[]) || [];
  }

  private ownPrices(index: number): { [colour: string]: number } {
    return (this.variantGroup(index)?.get('lightColourPrice')?.value as { [colour: string]: number }) || {};
  }

  private writeOwn(index: number, colours: string[], prices: { [colour: string]: number }) {
    const group = this.variantGroup(index);
    if (!group) return;
    group.patchValue({ lightColours: colours, lightColourPrice: prices });
    group.markAsDirty();
  }

  // True when this option carries shades of its own rather than the product's.
  variantTabHasOwn(index: number): boolean {
    return this.ownColours(index).length > 0;
  }

  // True while the open option is still sold in whatever the product is sold in.
  get followsProduct(): boolean {
    return this.lightColourTab >= 0 && this.ownColours(this.lightColourTab).length === 0;
  }

  // What the picker is showing: the product's list, or this option's own.
  get activeLightColours(): string[] {
    if (this.lightColourTab < 0) return this.selectedLightColours;
    const own = this.ownColours(this.lightColourTab);
    return own.length ? own : this.selectedLightColours;
  }

  private get activePrices(): { [colour: string]: number } {
    return this.lightColourTab < 0 ? this.lightColourPrices : this.ownPrices(this.lightColourTab);
  }

  /**
   * Matched without regard to case: the managed list has picked up entries in
   * mixed case over time ("multi" beside "Cool White"), and a product naming a
   * shade one way should still tick the box that names it the other.
   */
  isLightColourSelected(name: string): boolean {
    const key = (name || '').trim().toLowerCase();
    return this.activeLightColours.some(c => (c || '').trim().toLowerCase() === key);
  }

  /**
   * Write a list back to whatever the picker is open on.
   *
   * An option is given a list of its own at the moment it is first changed —
   * the product's ticks are copied across, so what was on screen is what it
   * keeps — and it is never given an empty one: an option with no shades left
   * is an option sold in no shade at all, which is what NO_COLOUR records.
   */
  private setActive(colours: string[], prices: { [colour: string]: number }) {
    if (this.lightColourTab < 0) {
      this.selectedLightColours = colours;
      this.lightColourPrices = prices;
      return;
    }
    this.writeOwn(this.lightColourTab, colours.length ? colours : [NO_COLOUR], prices);
  }

  toggleLightColour(name: string) {
    let colours = [...this.activeLightColours];
    const prices = { ...this.activePrices };

    const key = (name || '').trim().toLowerCase();
    const already = colours.find(c => (c || '').trim().toLowerCase() === key);
    if (already) {
      colours = colours.filter(c => c !== already);
      // A dropped colour must not leave its price behind for the next pick.
      delete prices[already];
      this.setActive(colours, prices);
      return;
    }

    // Picking a shade ends "no shade to choose" — the two together would put a
    // "No Colour" tab next to a "Cool White" tab on the dealer card.
    if (colours.includes(NO_COLOUR)) {
      delete prices[NO_COLOUR];
      colours = colours.filter(c => c !== NO_COLOUR);
    }

    this.setActive([...colours, name], prices);
  }

  // True once the picker has been cleared — what is open here has no shade to
  // choose (a driver, a profile, an accessory), shown on the card as no shades
  // at all rather than a row reading "No Colour".
  get isNoColour(): boolean {
    return this.activeLightColours.includes(NO_COLOUR);
  }

  // The picker's clear (×). "No Colour" is not offered as a tick in the list —
  // it is not a shade — so clearing the picker is how a product, or one option
  // of it, is marked as having none. Pressing it again undoes that: the product
  // is left unset, an option goes back to the product's shades.
  clearLightColours() {
    if (this.isNoColour) {
      if (this.lightColourTab < 0) {
        this.selectedLightColours = [];
        this.lightColourPrices = {};
      } else {
        this.writeOwn(this.lightColourTab, [], {});
      }
      return;
    }
    if (this.lightColourTab < 0) {
      this.lightColourPrices = {};
      this.selectedLightColours = [NO_COLOUR];
    } else {
      this.writeOwn(this.lightColourTab, [NO_COLOUR], {});
    }
    this.lightColourDropdownOpen = false;
  }

  // Hands the open option back to the product's shades.
  followProductColours() {
    if (this.lightColourTab < 0) return;
    this.writeOwn(this.lightColourTab, [], {});
    this.lightColourDropdownOpen = false;
  }

  // The value shown in the colour's price box ('' when it costs the same).
  priceFor(colour: string): number | string {
    const value = this.activePrices[colour];
    return value ? value : '';
  }

  /**
   * What a blank box means: the shade sells at the option's own rate.
   *
   * Shown as that rate rather than a bare 0, so it is obvious the shade is
   * priced at all — the rope reads 104 behind an empty box and 120 in the box
   * for multi, which is exactly what the sheet says.
   */
  pricePlaceholder(_colour: string): string {
    const first = this.variantsArray.length ? this.variantsArray.at(0).value : null;
    const rate = Number(first?.price) || Number(this.productForm?.get('price')?.value) || 0;
    return rate > 0 ? String(rate) : '0';
  }

  setLightColourPrice(colour: string, event: Event) {
    const raw = (event.target as HTMLInputElement).value;
    const value = Number(raw);
    const prices = { ...this.activePrices };
    if (!raw.trim() || !isFinite(value) || value <= 0) delete prices[colour];
    else prices[colour] = value;
    // Pricing a shade under an option's tab is a change to that option, so it
    // takes the product's ticks as its own along with the price.
    this.setActive([...this.activeLightColours], prices);
  }

  // Opens the Light Colours page, where the list itself is added to, renamed,
  // reordered and deleted. The product being written is parked first and picked
  // back up by restoreDraft() when that page hands control back — leaving the
  // form would otherwise throw away everything typed so far.
  manageLightColours() {
    this.saveDraft();
    this.router.navigate(['/admin/light-colours'], {
      queryParams: { returnTo: this.router.url.split('?')[0] }
    });
  }

  get lightColourButtonLabel(): string {
    if (this.isNoColour) return 'No light colour';
    const colours = this.activeLightColours;
    if (colours.length === 0) return 'Select light colours';
    if (colours.length <= 2) return colours.join(', ');
    return colours.length + ' light colours selected';
  }

  // The line under the tab strip — which option the ticks below belong to, and
  // whether it is carrying the product's shades or its own.
  get lightColourTargetLabel(): string {
    if (this.lightColourTab < 0) return 'Every option of this product, unless it is given its own below.';
    const tab = this.variantTabs.find(t => t.index === this.lightColourTab);
    const name = tab ? tab.detail : 'Option ' + (this.lightColourTab + 1);
    return this.followsProduct
      ? name + " — sold in the product's shades. Tick or untick one to give it its own."
      : name + ' — sold in its own shades.';
  }

  // Label shown on the dropdown button
  get categoryButtonLabel(): string {
    if (this.selectedCategories.length === 0) return 'Select categories';
    if (this.selectedCategories.length <= 2) return this.selectedCategories.join(', ');
    return `${this.selectedCategories.length} categories selected`;
  }

  // True when the form was submitted without picking any category
  get categoryMissing(): boolean {
    return this.submitted && this.selectedCategories.length === 0;
  }

  ngOnInit() {
    this.productForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(3)]],
      description: ['', [Validators.required, Validators.minLength(10)]],
      warranty: ['2 Years'],
      // Base price is optional when variant pricing is supplied (handled by the
      // form-level pricingValidator). If a value IS entered it must be >= 1.
      price: [null, [Validators.min(1)]],
      variants: this.fb.array([])
    }, { validators: this.pricingValidator });

    // The light colour tabs read the variants, so a wattage typed in below
    // shows on its tab straight away.
    this.variantsArray.valueChanges.subscribe(() => this.rebuildVariantTabs());

    // Check routing parameters for Edit vs Add Mode
    this.route.paramMap.subscribe(params => {
      const id = params.get('id');
      if (id) {
        this.isEditMode = true;
        this.productId = id;
        this.loadProductDetails(id);
      }
    });

    // Runs last, so a draft left behind by a trip to the Light Colours page
    // wins over whatever was just loaded from the catalogue.
    this.restoreDraft();
  }

  // The console runs on <ion-router-outlet>, which keeps this page alive while
  // the Light Colours page sits on top of it — coming back does not re-run
  // ngOnInit. This fires either way, so the draft is always picked back up (and
  // always cleared, instead of waiting to re-fill some later blank form).
  ionViewWillEnter() {
    this.restoreDraft();
  }

  // ---- Draft, for the round trip to the Light Colours page ----
  // Which product the draft belongs to, so an edit form never picks up a draft
  // left by a different product (or by "New Product").
  private draftKey(): string {
    return this.isEditMode ? this.productId : 'new';
  }

  private saveDraft() {
    try {
      // getRawValue, not value: the base price control is disabled while the
      // product has variants and would otherwise be dropped.
      sessionStorage.setItem(ProductFormPage.DRAFT_KEY, JSON.stringify({
        key: this.draftKey(),
        values: this.productForm.getRawValue(),
        categories: this.selectedCategories,
        lightColours: this.selectedLightColours,
        lightColourPrices: this.lightColourPrices,
        image: this.imagePreview
      }));
    } catch (e) {
      // A full sessionStorage (a large image) costs the draft, not the form.
      console.warn('Could not hold the product draft:', e);
    }
  }

  // Reads the draft back exactly once — leaving it behind would re-fill the
  // form the next time this page is opened.
  private restoreDraft() {
    let draft: any;
    try {
      const raw = sessionStorage.getItem(ProductFormPage.DRAFT_KEY);
      sessionStorage.removeItem(ProductFormPage.DRAFT_KEY);
      if (!raw) return;
      draft = JSON.parse(raw);
    } catch (e) {
      return;
    }
    if (!draft || draft.key !== this.draftKey()) return;

    const values = draft.values || {};
    this.productForm.patchValue({
      name: values.name || '',
      description: values.description || ''
    });

    // Variants first: adding them disables the base price, so patching the
    // price before this point would be undone.
    const available = this.lightColourOptions;
    this.variantsArray.clear();
    (values.variants || []).forEach((v: ProductVariant) => this.addVariant({
      ...v,
      // Same rule as the product's list below: a shade deleted while we were
      // away does not come back on one option either.
      lightColours: (v.lightColours || []).filter(c => c === NO_COLOUR || available.includes(c))
    }));
    const priceCtrl = this.productForm.get('price');
    if (priceCtrl?.enabled) priceCtrl.setValue(values.price ?? null);

    this.selectedCategories = draft.categories || [];
    // A shade deleted while we were away must not come back on this product
    // just because it was ticked before the trip. "No Colour" is never in the
    // managed list and is kept regardless — it is not a shade, it is the record
    // of having none.
    this.selectedLightColours = (draft.lightColours || [])
      .filter((c: string) => c === NO_COLOUR || available.includes(c));
    this.lightColourPrices = draft.lightColourPrices || {};
    this.imagePreview = draft.image || null;

    // The typing that produced this draft was real: keep discard() asking.
    this.productForm.markAsDirty();
  }

  get variantsArray(): FormArray {
    return this.productForm.get('variants') as FormArray;
  }

  // Form-level rule: a product needs pricing from EITHER a base price OR at least
  // one variant that has a price / price-per-metre. If neither exists → invalid.
  private pricingValidator = (group: AbstractControl): ValidationErrors | null => {
    const price = group.get('price')?.value;
    const hasBasePrice = price !== null && price !== '' && Number(price) > 0;

    const variants = (group.get('variants') as FormArray)?.controls || [];
    const hasVariantPrice = variants.some(v => {
      const p = v.get('price')?.value;
      const ppm = v.get('pricePerMtr')?.value;
      return (p !== null && p !== '' && Number(p) > 0) ||
             (ppm !== null && ppm !== '' && Number(ppm) > 0);
    });

    return hasBasePrice || hasVariantPrice ? null : { pricingMissing: true };
  };

  // True when the base price field is the ONLY missing pricing source
  get pricingMissing(): boolean {
    return !!this.productForm?.errors?.['pricingMissing'];
  }

  createVariantGroup(variant?: ProductVariant): FormGroup {
    return this.fb.group({
      wattage: [variant?.wattage || ''],
      dimension: [variant?.dimension || ''],
      cutout: [variant?.cutout || ''],
      packing: [variant?.packing || ''],
      // One rate, and a switch for whether it is charged by the piece or by the
      // metre. They were two fields, which meant a rate could be typed into the
      // wrong one and silently priced at zero.
      price: [variant?.price ?? variant?.pricePerMtr ?? null],
      perMetre: [variant?.pricePerMtr != null],
      // Not typed into the row below — written by the light colour picker
      // above, under this option's own tab. Empty means this option is sold in
      // whatever shades the product is sold in.
      lightColours: [variant?.lightColours ? [...variant.lightColours] : []],
      lightColourPrice: [variant?.lightColourPrice ? { ...variant.lightColourPrice } : {}]
    });
  }

  addVariant(variant?: ProductVariant) {
    this.variantsArray.push(this.createVariantGroup(variant));
    this.syncBasePriceWithVariants();
    this.rebuildVariantTabs();
  }

  removeVariant(index: number) {
    this.variantsArray.removeAt(index);
    // Everything after the removed option shifts down a place; the picker has
    // to follow it, or it would quietly start writing to its neighbour.
    if (this.lightColourTab === index) this.lightColourTab = -1;
    else if (this.lightColourTab > index) this.lightColourTab -= 1;
    this.syncBasePriceWithVariants();
    this.rebuildVariantTabs();
  }

  // True once the product carries variants — it is then priced per variant.
  get hasVariants(): boolean {
    return this.variantsArray.length > 0;
  }

  // A variant-priced product has no base price of its own. Blank the field and
  // lock it while variants exist, so the panel never shows a leftover placeholder
  // (the catalogue seed put 580 / 1850 on every product, variants or not). A
  // disabled control is dropped from productForm.value, so the save writes 0.
  private syncBasePriceWithVariants() {
    const priceCtrl = this.productForm.get('price');
    if (!priceCtrl) return;
    if (this.hasVariants) {
      if (priceCtrl.value !== null && priceCtrl.value !== '') {
        priceCtrl.setValue(null, { emitEvent: false });
      }
      if (priceCtrl.enabled) priceCtrl.disable({ emitEvent: false });
    } else if (priceCtrl.disabled) {
      priceCtrl.enable({ emitEvent: false });
    }
    this.productForm.updateValueAndValidity({ emitEvent: false });
  }

  // Handle image file selection: read, downscale via canvas, store as data URL
  onImageSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files && input.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        this.imagePreview = this.compressToDataUrl(img);
      };
      img.onerror = () => { this.saveError = 'That image could not be read.'; };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
    input.value = '';
  }

  // Produce a JPEG data URL guaranteed to stay well under Firestore's ~1 MB
  // per-document limit. The product (with the image inline) is a single
  // Firestore doc, so an oversized image makes the whole write fail. Shrink
  // quality first, then dimensions, until the encoded string fits.
  private compressToDataUrl(img: HTMLImageElement, maxBytes = 700_000): string {
    let maxDim = 800;
    let quality = 0.85;
    let dataUrl = '';
    for (let attempt = 0; attempt < 10; attempt++) {
      let width = img.width, height = img.height;
      if (width > maxDim || height > maxDim) {
        const scale = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // JPEG has no alpha channel: transparent PNG pixels would encode as
        // black. Paint a white background before drawing.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
      }
      dataUrl = canvas.toDataURL('image/jpeg', quality);
      if (dataUrl.length <= maxBytes) return dataUrl;
      if (quality > 0.5) quality -= 0.15;
      else maxDim = Math.round(maxDim * 0.85);
    }
    return dataUrl; // Best effort; onSubmit still guards the final size.
  }

  removeImage() {
    this.imagePreview = null;
  }

  // Pre-load details in edit mode
  loadProductDetails(id: string) {
    const product = this.productService.getProductById(id);
    if (product) {
      this.productForm.patchValue({
        name: product.name,
        description: product.description,
        // A 0 / missing base price (variant-priced products) loads as blank so the
        // "min 1" rule doesn't flag it — base price stays optional when variants exist.
        price: product.price ? product.price : null
      });

      // Load existing categories: prefer the array, fall back to the legacy
      // comma-joined single string.
      if (product.categories && product.categories.length) {
        this.selectedCategories = [...product.categories];
      } else if (product.category && product.category.trim()) {
        this.selectedCategories = product.category.split(',').map(c => c.trim()).filter(Boolean);
      } else {
        this.selectedCategories = [];
      }

      this.productForm.patchValue({ warranty: product.warranty || '2 Years' });
      this.selectedLightColours = product.lightColours ? [...product.lightColours] : [];
      this.lightColourPrices = { ...(product.lightColourPrice || {}) };

      // A product that has never been edited has no list of its own yet, so the
      // finishes are read back off whatever the import left on its variants.
      // The admin sees them already filled in and can correct them in place —
      // which is also how the imported text gets replaced by a real list.
      this.bodyColoursText = orderableBodyColours(product).join(', ');

      this.imagePreview = product.image || null;

      this.variantsArray.clear();
      if (product.variants && product.variants.length > 0) {
        product.variants.forEach(variant => this.addVariant(variant));
      }
      console.log('Preloaded details for edit mode:', product);
    } else {
      console.warn('Product not found in catalog, using empty form');
    }
  }

  // Save/Confirm action
  async onSubmit() {
    this.submitted = true;
    this.saveError = '';
    // At least one category must be selected.
    if (this.productForm.invalid || this.selectedCategories.length === 0) {
      this.productForm.markAllAsTouched();
      return;
    }

    // Final safety guard: even after adaptive compression, refuse to save an
    // image that would exceed Firestore's document limit — otherwise the write
    // fails and the product silently never reaches the dealer app.
    if (this.imagePreview && this.imagePreview.length > 900_000) {
      this.saveError = 'This image is too large to save. Please choose a smaller or less detailed image.';
      return;
    }

    this.isLoading = true;
    const formData = this.productForm.value;
    // Filter out completely empty variants. Shades of its own count as content:
    // an option can be nothing but "this one is warm white only".
    const cleanedVariants = (formData.variants || [])
      .filter((v: any) =>
        v.wattage || v.dimension || v.cutout ||
        v.packing || v.price ||
        (v.lightColours && v.lightColours.length)
      )
      // An option with no shades of its own is written without the fields at
      // all, so it keeps following the product rather than storing an empty
      // list — which would read as "sold in no shade".
      .map((v: any) => {
        const colours: string[] = (v.lightColours || []).filter(Boolean);
        const priced: { [colour: string]: number } = {};
        colours.forEach(colour => {
          const value = (v.lightColourPrice || {})[colour];
          if (value > 0) priced[colour] = value;
        });
        // The one rate goes back into whichever field the rest of the app
        // reads: pricePerMtr for the goods sold by length, price otherwise.
        // Only ever one of the two, so nothing downstream has to guess.
        const rate = Number(v.price) || undefined;
        const byMetre = !!v.perMetre;
        const { perMetre, ...rest } = v;
        return {
          ...rest,
          price: byMetre ? undefined : rate,
          pricePerMtr: byMetre ? rate : undefined,
          lightColours: colours.length ? colours : undefined,
          lightColourPrice: Object.keys(priced).length ? priced : undefined
        };
      });

    // A new product's id doubles as its Firestore document id, so a repeat would
    // overwrite an existing product instead of adding one. Four random digits
    // gave only 9000 possibilities; a timestamp makes a repeat impossible.
    const id = this.isEditMode
      ? this.productId
      : 'GLR-' + Date.now().toString(36).toUpperCase() + '-' + Math.floor(1000 + Math.random() * 9000);

    // Store the (downscaled) image inline as a data URL. It's saved in the product
    // document and renders everywhere via <img src>. Kept small on upload so it
    // stays well under Firestore's 1MB limit — no Firebase Storage setup needed.
    const imageUrl: string | undefined = this.imagePreview || undefined;

    // Persist the multi-category selection as an array plus a joined string for
    // legacy single-category displays/badges.
    const categories = [...this.selectedCategories];
    const categoryJoined = categories.join(', ');

    // Left out of the document entirely when nothing is picked, so a product
    // without light colours has no field rather than an empty list to render.
    const lightColours = this.selectedLightColours.length ? [...this.selectedLightColours] : undefined;

    // Only the colours still selected, and only the ones priced on their own.
    const prices: { [colour: string]: number } = {};
    this.selectedLightColours.forEach(colour => {
      const value = this.lightColourPrices[colour];
      if (value > 0) prices[colour] = value;
    });
    const lightColourPrice = Object.keys(prices).length ? prices : undefined;

    // The finishes, as typed. Left off the document when there are none, so a
    // product with nothing to choose quotes exactly as it did before.
    const parsedBodyColours = readBodyColourInput(this.bodyColoursText);
    const bodyColours = parsedBodyColours.length ? parsedBodyColours : undefined;

    try {
      if (this.isEditMode) {
        const existing = this.productService.getProductById(this.productId);
        if (existing) {
          await this.productService.updateProduct({
            ...existing,
            name: formData.name,
            description: formData.description,
            price: formData.price || 0,
            category: categoryJoined,
            categories,
            lightColours,
            lightColourPrice,
            bodyColours,
            warranty: (formData.warranty || '').trim() || '2 Years',
            image: imageUrl,
            variants: cleanedVariants.length > 0 ? cleanedVariants : undefined
          });
        }
      } else {
        await this.productService.addProduct({
          id,
          name: formData.name,
          description: formData.description,
          price: formData.price || 0,
          category: categoryJoined,
          categories,
          lightColours,
          lightColourPrice,
          bodyColours,
          warranty: (formData.warranty || '').trim() || '2 Years',
          stock: 999,
          image: imageUrl,
          previewType: 'panel',
          variants: cleanedVariants.length > 0 ? cleanedVariants : undefined
        });
      }
      this.router.navigate(['/admin/dashboard']);
    } catch (e: any) {
      // The Firestore write failed. Tell the admin, so they don't believe a
      // product saved when it never reached the dealers.
      this.saveError = /longer than|size|invalid/i.test(e?.message || '')
        ? 'This product is too large to save — please choose a smaller image.'
        : 'Could not save to the server. Check your connection and try again.';
    } finally {
      this.isLoading = false;
    }
  }

  // Discard action
  discard() {
    if (this.productForm.dirty) {
      const confirmDiscard = confirm('You have unsaved changes. Are you sure you want to discard them?');
      if (!confirmDiscard) {
        return;
      }
    }
    this.router.navigate(['/admin/dashboard']);
  }
}
