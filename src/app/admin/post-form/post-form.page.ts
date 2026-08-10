import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { PostService } from '../post.service';

/**
 * Add Post — the full page behind the "Add Post" button.
 *
 * Publishes artwork every dealer and agent can forward to their own customers.
 * They stamp their OWN logo and shop details onto it at share time (set inside
 * their app), so nothing branding-related is configured here.
 */
@Component({
  selector: 'app-admin-post-form',
  templateUrl: './post-form.page.html',
  styleUrls: ['./post-form.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent]
})
export class PostFormPage {
  image: string | null = null;
  caption = '';
  errorMsg = '';
  publishing = false;

  constructor(
    private postService: PostService,
    private router: Router
  ) {}

  // Read the chosen picture and downscale it to a data URL. A post is the
  // artwork dealers forward to their customers, so it keeps more detail than a
  // banner — but it still has to fit inside a Firestore document, hence the
  // step down through lower JPEG qualities until it does.
  onImageSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.errorMsg = 'Please select an image file.';
      return;
    }
    this.errorMsg = '';

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // Portrait-friendly bounds — most posts are shared to WhatsApp status
        // and phone screens, so height is allowed to run taller than width.
        const maxWidth = 1080;
        const maxHeight = 1350;
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
          // JPEG has no alpha channel: transparent PNG artwork would encode as
          // black. Paint a white background before drawing.
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
        }

        // A Firestore document caps out at 1 MB, so leave clear headroom.
        const budget = 700_000;
        let dataUrl = '';
        for (const quality of [0.82, 0.72, 0.62, 0.5]) {
          dataUrl = canvas.toDataURL('image/jpeg', quality);
          if (dataUrl.length <= budget) break;
        }
        if (dataUrl.length > budget) {
          this.errorMsg = 'That image is too large. Please use a smaller one.';
          return;
        }
        this.image = dataUrl;
      };
      img.onerror = () => (this.errorMsg = 'That image could not be read.');
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  removeImage() {
    this.image = null;
    this.errorMsg = '';
  }

  async publish() {
    this.errorMsg = '';
    if (!this.image) {
      this.errorMsg = 'Please add an image for the post.';
      return;
    }
    this.publishing = true;
    try {
      await this.postService.publish(this.image, this.caption);
      this.router.navigate(['/admin/posts']);
    } catch (e) {
      this.errorMsg = 'Could not publish the post. Please try again.';
      this.publishing = false;
    }
  }

  cancel() {
    this.router.navigate(['/admin/posts']);
  }
}
