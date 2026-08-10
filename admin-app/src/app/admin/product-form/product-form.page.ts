import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, FormArray, Validators, ReactiveFormsModule, AbstractControl, ValidationErrors } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { ProductService, ProductVariant } from '../product.service';
import { CategoryService, Category } from '../category.service';

@Component({
  selector: 'app-product-form',
  templateUrl: './product-form.page.html',
  styleUrls: ['./product-form.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IonContent
  ]
})
export class ProductFormPage implements OnInit {
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

  constructor(
    private fb: FormBuilder,
    private route: ActivatedRoute,
    private router: Router,
    private productService: ProductService,
    private categoryService: CategoryService
  ) {}

  // Category options for the dropdown, managed in the Categories tab.
  get categories(): Category[] {
    return this.categoryService.categories;
  }

  toggleCategoryDropdown() {
    this.categoryDropdownOpen = !this.categoryDropdownOpen;
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
      // Base price is optional when variant pricing is supplied (handled by the
      // form-level pricingValidator). If a value IS entered it must be >= 1.
      price: [null, [Validators.min(1)]],
      variants: this.fb.array([])
    }, { validators: this.pricingValidator });

    // Check routing parameters for Edit vs Add Mode
    this.route.paramMap.subscribe(params => {
      const id = params.get('id');
      if (id) {
        this.isEditMode = true;
        this.productId = id;
        this.loadProductDetails(id);
      }
    });
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
      model: [variant?.model || ''],
      wattage: [variant?.wattage || ''],
      type: [variant?.type || ''],
      dimension: [variant?.dimension || ''],
      cutout: [variant?.cutout || ''],
      bodyColour: [variant?.bodyColour || ''],
      colorSize: [variant?.colorSize || ''],
      packing: [variant?.packing || ''],
      price: [variant?.price || null],
      pricePerMtr: [variant?.pricePerMtr || null]
    });
  }

  addVariant(variant?: ProductVariant) {
    this.variantsArray.push(this.createVariantGroup(variant));
  }

  removeVariant(index: number) {
    this.variantsArray.removeAt(index);
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
    // Filter out completely empty variants
    const cleanedVariants = (formData.variants || []).filter((v: any) =>
      v.model || v.wattage || v.type || v.dimension || v.cutout || v.bodyColour || v.colorSize || v.packing || v.price || v.pricePerMtr
    );

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
