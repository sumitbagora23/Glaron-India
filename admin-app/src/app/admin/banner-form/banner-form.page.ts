import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { SettingsService } from '../settings.service';

/**
 * Add Banner — the full page behind the "Add Banner" button.
 *
 * Images are downscaled in the browser and kept as compact JPEG data URLs, the
 * same way category and product images are, so no Firebase Storage is involved.
 * Saving appends them to the end of the existing carousel.
 */
@Component({
  selector: 'app-admin-banner-form',
  templateUrl: './banner-form.page.html',
  styleUrls: ['./banner-form.page.scss'],
  standalone: true,
  imports: [CommonModule, IonContent]
})
export class BannerFormPage {
  // Banners picked in this session, waiting to be saved.
  pending: string[] = [];
  errorMsg = '';
  saving = false;

  constructor(
    private settingsService: SettingsService,
    private router: Router
  ) {}

  onBannerSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = input.files ? Array.from(input.files) : [];
    input.value = '';
    if (!files.length) return;
    if (files.some(f => !f.type.startsWith('image/'))) {
      this.errorMsg = 'Please select image files only.';
      return;
    }
    this.errorMsg = '';
    files.forEach(file => this.addFromFile(file));
  }

  private addFromFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // Banners are wide rectangles displayed at ~440px, so a 1000px-wide
        // image is already crisp on high-DPI phones. Keeping each banner small
        // keeps the Firestore settings document light, so banners sync and
        // render almost instantly in the installed PWA (several banners are
        // stored inline as data URLs).
        const maxWidth = 1000;
        const maxHeight = 500;
        let width = img.width, height = img.height;
        if (width > maxWidth || height > maxHeight) {
          const scale = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          // JPEG has no alpha channel: transparent PNG pixels would encode as
          // black, so a logo-style banner arrived as a black rectangle. Paint a
          // white background before drawing.
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
        }
        this.pending = [...this.pending, canvas.toDataURL('image/jpeg', 0.72)];
      };
      img.onerror = () => (this.errorMsg = 'That image could not be read.');
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  removePending(index: number) {
    this.pending = this.pending.filter((_, i) => i !== index);
  }

  moveUp(index: number) {
    if (index <= 0) return;
    const list = [...this.pending];
    [list[index - 1], list[index]] = [list[index], list[index - 1]];
    this.pending = list;
  }

  moveDown(index: number) {
    if (index >= this.pending.length - 1) return;
    const list = [...this.pending];
    [list[index + 1], list[index]] = [list[index], list[index + 1]];
    this.pending = list;
  }

  async save() {
    if (!this.pending.length) {
      this.errorMsg = 'Please add at least one banner image.';
      return;
    }

    // New banners join the end of the carousel; order is adjusted from the list.
    const next = [...this.settingsService.offerBanners, ...this.pending];

    // Every banner is stored inline in the single settings document, so the set
    // as a whole has to fit inside Firestore's 1 MB limit. Refuse up front —
    // otherwise the write fails and the banners never reach the dealers.
    if (this.settingsService.estimatedSizeWith(next) > 900_000) {
      this.errorMsg = 'There is no room left for these banners. Please delete some existing banners first, then add these.';
      return;
    }

    this.saving = true;
    this.errorMsg = '';
    try {
      await this.settingsService.updateOfferBanners(next);
      this.router.navigate(['/admin/banners']);
    } catch (e) {
      this.errorMsg = 'Could not save the banners to the server. Check your connection and try again.';
      this.saving = false;
    }
  }

  cancel() {
    this.router.navigate(['/admin/banners']);
  }
}
