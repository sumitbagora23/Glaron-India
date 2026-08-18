import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent } from '@ionic/angular/standalone';
import { Router } from '@angular/router';
import { SearchService } from '../search.service';
import { ProductService, Product } from '../product.service';
import { CategoryService } from '../category.service';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.page.html',
  styleUrls: ['./dashboard.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonContent
  ]
})
export class DashboardPage implements OnInit {
  currentPage = 1;
  totalPages = 3;
  categoryFilterOpen = false;
  selectedCategories: string[] = [];
  selectedModalImage: string | null = null;
  selectedModalImageTitle = '';
  selectedVariantProduct: Product | null = null;

  constructor(
    private router: Router,
    private searchService: SearchService,
    private productService: ProductService,
    private categoryService: CategoryService
  ) {}

  // Returns the category list for a product (new array field, falling back to
  // the legacy comma-joined string).
  private productCategories(p: Product): string[] {
    if (p.categories && p.categories.length) return p.categories.map(c => c.trim()).filter(Boolean);
    return (p.category || '').split(',').map(c => c.trim()).filter(Boolean);
  }

  // If an image fails to load, hide it so a clean blank-white box shows
  // instead of a broken-image icon.
  onImgError(event: any) {
    if (event?.target) event.target.style.display = 'none';
  }

  // Keeps Angular from rebuilding every table row (and re-downloading every
  // product image) each time the products signal is replaced by a Firestore
  // sync or the filter getter returns a new array.
  trackByProductId(_index: number, product: Product): string {
    return product.id;
  }

  ngOnInit() {}

  // Fetch products from the shared ProductService
  get allProducts(): Product[] {
    return this.productService.products;
  }

  // Filter options come from the managed Categories tab only (not derived from
  // whatever strings happen to be on products).
  get categories(): string[] {
    return this.categoryService.categories.map(c => c.name);
  }

  // Filter products by selected categories (multi-select) + search keyword
  get filteredProducts(): Product[] {
    let list = this.allProducts;

    if (this.selectedCategories.length > 0) {
      // A product matches if ANY of its categories is selected.
      list = list.filter(p => {
        const cats = this.productCategories(p);
        return cats.some(c => this.selectedCategories.includes(c));
      });
    }

    const searchVal = this.searchService.searchKeyword();
    if (searchVal.trim()) {
      const keyword = searchVal.toLowerCase().trim();
      list = list.filter(product =>
        product.name.toLowerCase().includes(keyword) ||
        product.id.toLowerCase().includes(keyword) ||
        (product.category || '').toLowerCase().includes(keyword) ||
        product.status.toLowerCase().includes(keyword)
      );
    }

    return list;
  }

  // ---- Category multi-select filter ----
  toggleCategoryFilter() {
    this.categoryFilterOpen = !this.categoryFilterOpen;
  }

  closeCategoryFilter() {
    this.categoryFilterOpen = false;
  }

  isCategorySelected(cat: string): boolean {
    return this.selectedCategories.includes(cat);
  }

  toggleCategory(cat: string) {
    this.selectedCategories = this.selectedCategories.includes(cat)
      ? this.selectedCategories.filter(c => c !== cat)
      : [...this.selectedCategories, cat];
  }

  clearCategoryFilter() {
    this.selectedCategories = [];
  }

  // Button Actions
  addProduct() {
    this.router.navigate(['/admin/products/new']);
  }

  // The Light Colours page — the shades every product's Light Colour picker
  // offers, added to and edited there. "Done" comes back to this list.
  manageLightColours() {
    this.router.navigate(['/admin/light-colours'], {
      queryParams: { returnTo: '/admin/dashboard' }
    });
  }

  editProduct(product: Product) {
    this.router.navigate(['/admin/products/edit', product.id]);
  }

  deleteProduct(product: Product, event?: Event) {
    if (event) event.stopPropagation();
    if (confirm(`Delete "${product.name}" (${product.id})? This cannot be undone.`)) {
      this.productService.deleteProduct(product.id);
    }
  }

  setPage(page: number) {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
      console.log('Pagination Page changed to:', page);
    }
  }

  exportCSV() {
    alert('UX Microcopy: "Downloading Inventory Overview CSV sheet. Saving details to local device."');
  }

  openImageModal(imgUrl: string | undefined, name: string) {
    if (imgUrl) {
      this.selectedModalImage = imgUrl;
      this.selectedModalImageTitle = name;
    }
  }

  closeImageModal() {
    this.selectedModalImage = null;
    this.selectedModalImageTitle = '';
  }

  openVariantsModal(product: Product) {
    // Only open if the product actually has variants
    if (product.variants && product.variants.length > 0) {
      this.selectedVariantProduct = product;
    }
  }

  closeVariantsModal() {
    this.selectedVariantProduct = null;
  }
}
