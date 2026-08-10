import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import {
  NotificationService, NotificationTarget, NotificationAudience,
  NotificationAudienceOption, NOTIFICATION_AUDIENCES,
  DEFAULT_NOTIFICATION_AUDIENCE, notificationTargets, resolveNotificationTarget
} from '../notification.service';

/**
 * New Notification — the full page behind the "New Notification" button.
 *
 * Composes a broadcast: who receives it (dealers, agents or both), title,
 * message, an optional picture, and which screen a tap opens. Sending returns
 * to the notifications list.
 */
@Component({
  selector: 'app-admin-notification-form',
  templateUrl: './notification-form.page.html',
  styleUrls: ['./notification-form.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent]
})
export class NotificationFormPage {
  title = '';
  body = '';
  errorMsg = '';
  sending = false;

  // Optional picture shown inside the dealer's notification, held as a compact
  // JPEG data URL until the notification is sent.
  image: string | null = null;
  imageErrorMsg = '';

  // Who gets the broadcast. Dealers and agents run separate apps with separate
  // push registrations, so this decides both which devices are reached and
  // which tabs can be picked below.
  audiences: NotificationAudienceOption[] = NOTIFICATION_AUDIENCES;
  audience: NotificationAudience = DEFAULT_NOTIFICATION_AUDIENCE;

  // Which screen a tap on the notification opens. The typed tab name is the
  // single source of truth — the chips are shortcuts that fill this box in.
  // The underlying path is never shown to the recipient.
  target = notificationTargets(DEFAULT_NOTIFICATION_AUDIENCE)[0].label;

  constructor(
    private notificationService: NotificationService,
    private router: Router
  ) {}

  // The tabs the chosen audience's app actually has. "Both" narrows this to
  // the screens the dealer and agent apps share.
  get targets(): NotificationTarget[] {
    return notificationTargets(this.audience);
  }

  // What the typed tab name currently resolves to — null while the text
  // matches no tab of the chosen audience's app, which is what drives the
  // inline warning.
  get resolvedTarget(): NotificationTarget | null {
    return resolveNotificationTarget(this.target, this.audience);
  }

  isAudienceActive(option: NotificationAudienceOption): boolean {
    return this.audience === option.key;
  }

  // Switching audience can strand the tab that was picked — Orders exists only
  // in the dealer app, Commission only in the agent one — so fall back to that
  // audience's first tab rather than leaving an error showing.
  pickAudience(option: NotificationAudienceOption) {
    this.audience = option.key;
    if (!this.resolvedTarget) this.target = this.targets[0].label;
  }

  get audienceMessage(): string {
    const chosen = this.audiences.find((a) => a.key === this.audience);
    return chosen ? chosen.hint : '';
  }

  // Highlights the chip matching whatever is typed in the box.
  isTargetActive(target: NotificationTarget): boolean {
    return this.resolvedTarget?.key === target.key;
  }

  // The message shown under the tab-name box: the destination once it resolves,
  // or what to type when it doesn't.
  get targetMessage(): string {
    const target = this.resolvedTarget;
    const who = this.audience === 'agent' ? 'Agents' : this.audience === 'both' ? 'Recipients' : 'Dealers';
    if (target) {
      return `Tapping the notification opens the ${target.label} screen. ${who} only see the title, message and any image.`;
    }
    const typed = (this.target || '').trim();
    const app = this.audience === 'agent'
      ? 'an agent tab'
      : this.audience === 'both'
        ? 'a tab both apps have'
        : 'a dealer tab';
    return typed
      ? `"${typed}" is not ${app} — type ${this.targetNameList}.`
      : `Type a tab name: ${this.targetNameList}.`;
  }

  // "Home, Products, Orders or Profile" — used in the hint and error text.
  get targetNameList(): string {
    const names = this.targets.map((t) => t.label);
    return names.slice(0, -1).join(', ') + ' or ' + names[names.length - 1];
  }

  // Chips just fill the box in, so there is only ever one source of truth.
  pickTarget(target: NotificationTarget) {
    this.target = target.label;
  }

  // Read the chosen picture and downscale it to a compact JPEG data URL, the
  // same way banners are handled. Only one image per notification — picking
  // another replaces it.
  onImageSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.imageErrorMsg = 'Please select an image file.';
      return;
    }
    this.imageErrorMsg = '';

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // Android draws the notification picture as a wide 2:1 banner about
        // 1000px across, so anything larger is wasted bytes — and the image
        // has to stay small enough to sit inside the Firestore document.
        const maxWidth = 1024;
        const maxHeight = 512;
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
          // black. Paint a white background before drawing.
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
        }
        this.image = canvas.toDataURL('image/jpeg', 0.72);
      };
      img.onerror = () => (this.imageErrorMsg = 'That image could not be read.');
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  removeImage() {
    this.image = null;
    this.imageErrorMsg = '';
  }

  async send() {
    this.errorMsg = '';
    const title = (this.title || '').trim();
    const body = (this.body || '').trim();
    if (!title) {
      this.errorMsg = 'Please enter a notification title.';
      return;
    }
    // Refuse to send rather than quietly defaulting to Home — a typo would
    // otherwise land everyone on the wrong screen with no clue why. The box
    // already shows what to type, so just put the cursor back in it.
    if (!this.resolvedTarget) {
      document.getElementById('notifTarget')?.focus();
      return;
    }
    this.sending = true;
    try {
      await this.notificationService.send(title, body, this.target, this.image, this.audience);
      this.router.navigate(['/admin/notifications']);
    } catch (e) {
      this.errorMsg = 'Could not send the notification. Please try again.';
      this.sending = false;
    }
  }

  cancel() {
    this.router.navigate(['/admin/notifications']);
  }
}
