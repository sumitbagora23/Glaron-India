import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { CategoryService } from '../category.service';

@Component({
  selector: 'app-category-form',
  templateUrl: './category-form.page.html',
  styleUrls: ['./category-form.page.scss'],
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, IonContent]
})
export class CategoryFormPage implements OnInit {
  categoryForm!: FormGroup;
  isEditMode = false;
  categoryId = '';
  isLoading = false;
  submitted = false;
  saveError = '';

  // Category image (data URL). Preloaded in edit mode, replaced on upload.
  imagePreview: string | null = null;

  constructor(
    private fb: FormBuilder,
    private route: ActivatedRoute,
    private router: Router,
    private categoryService: CategoryService
  ) {}

  ngOnInit() {
    this.categoryForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2)]]
    });

    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.isEditMode = true;
      this.categoryId = id;
      const category = this.categoryService.getCategoryById(id);
      if (category) {
        this.categoryForm.patchValue({ name: category.name });
        this.imagePreview = category.image || null;
      }
    }
  }

  // Read the chosen file, downscale via canvas, store as a compact data URL —
  // same approach as products, so no Firebase Storage setup is needed.
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
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
    input.value = '';
  }

  // Produce a JPEG data URL guaranteed to stay under Firestore's ~1 MB per-
  // document limit. The category (with the image inline) is stored as a single
  // Firestore doc, so an oversized image makes the whole write fail — and that
  // failure was previously silent, which is why large category images never
  // reached the dealer app. We shrink quality first, then dimensions, until the
  // encoded string fits comfortably under the limit (base64 length ≈ byte size).
  private compressToDataUrl(img: HTMLImageElement, maxBytes = 900_000): string {
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
        // JPEG has no alpha channel, so transparent PNG pixels encode as black
        // and the tile renders as a black box. Paint white underneath first.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
      }
      dataUrl = canvas.toDataURL('image/jpeg', quality);
      if (dataUrl.length <= maxBytes) return dataUrl;
      // Still too big: drop quality first, then start shrinking the dimensions.
      if (quality > 0.5) quality -= 0.15;
      else maxDim = Math.round(maxDim * 0.85);
    }
    return dataUrl; // Best effort; onSubmit still guards the final size.
  }

  removeImage() {
    this.imagePreview = null;
  }

  async onSubmit() {
    this.submitted = true;
    this.saveError = '';
    if (this.categoryForm.invalid) {
      this.categoryForm.markAllAsTouched();
      return;
    }

    const name = (this.categoryForm.value.name || '').trim();
    const image = this.imagePreview || undefined;

    // Final safety guard: even after adaptive compression, refuse to save an
    // image that would exceed Firestore's document limit — otherwise the write
    // fails and the image silently never reaches the dealer app.
    if (image && image.length > 1_000_000) {
      this.saveError = 'This image is too large to save. Please choose a smaller or less detailed image.';
      return;
    }

    this.isLoading = true;
    try {
      if (this.isEditMode) {
        const existing = this.categoryService.getCategoryById(this.categoryId);
        if (existing) {
          await this.categoryService.updateCategory({ ...existing, name, image });
        }
      } else {
        await this.categoryService.addCategory({ name, image });
      }
      this.router.navigate(['/admin/categories']);
    } catch (e: any) {
      // The Firestore write failed (commonly the 1 MB limit). Tell the admin so
      // they don't believe an image saved when it didn't reach the dealers.
      this.saveError = /longer than|size|invalid/i.test(e?.message || '')
        ? 'This image is too large to save. Please choose a smaller or less detailed image.'
        : 'Could not save to the server. Check your connection and try again.';
    } finally {
      this.isLoading = false;
    }
  }

  discard() {
    if (this.categoryForm.dirty || this.imagePreview) {
      if (!confirm('You have unsaved changes. Discard them?')) return;
    }
    this.router.navigate(['/admin/categories']);
  }
}
