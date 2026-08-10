import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { ProductService } from '../product.service';

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

  constructor(
    private fb: FormBuilder,
    private route: ActivatedRoute,
    private router: Router,
    private productService: ProductService
  ) {}

  ngOnInit() {
    this.productForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(3)]],
      description: ['', [Validators.required, Validators.minLength(10)]],
      price: [null, [Validators.required, Validators.min(1)]],
      category: ['Indoor', [Validators.required]],
      stock: [null, [Validators.required, Validators.min(0)]]
    });

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

  // Pre-load details in edit mode
  loadProductDetails(id: string) {
    const product = this.productService.getProductById(id);
    if (product) {
      this.productForm.patchValue({
        name: product.name,
        description: product.description,
        price: product.price,
        category: product.category,
        stock: product.stock
      });
      console.log('Preloaded details for edit mode:', product);
    } else {
      console.warn('Product not found in catalog, using empty form');
    }
  }

  // Save/Confirm action
  onSubmit() {
    if (this.productForm.invalid) {
      this.productForm.markAllAsTouched();
      return;
    }

    this.isLoading = true;
    const formData = this.productForm.value;
    console.log('Submitting Product Data:', formData);

    if (this.isEditMode) {
      const existing = this.productService.getProductById(this.productId);
      if (existing) {
        this.productService.updateProduct({
          ...existing,
          name: formData.name,
          description: formData.description,
          price: formData.price,
          category: formData.category,
          stock: formData.stock,
          status: formData.stock > 100 ? 'In Stock' : formData.stock > 0 ? 'Low Stock' : 'Out of Stock'
        });
      }
    } else {
      const randomId = 'GLR-' + Math.floor(1000 + Math.random() * 9000);
      this.productService.addProduct({
        id: randomId,
        name: formData.name,
        description: formData.description,
        price: formData.price,
        category: formData.category,
        stock: formData.stock,
        previewType: 'panel'
      });
    }

    // Simulate backend response delay
    setTimeout(() => {
      this.isLoading = false;
      this.router.navigate(['/admin/dashboard']);
    }, 1200);
  }

  // Discard action
  discard() {
    if (this.productForm.dirty) {
      const confirmDiscard = confirm('UX Microcopy: "You have unsaved changes. Are you sure you want to discard them?"');
      if (!confirmDiscard) {
        return;
      }
    }
    this.router.navigate(['/admin/dashboard']);
  }
}
