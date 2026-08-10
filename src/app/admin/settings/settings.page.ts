import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent } from '@ionic/angular/standalone';
import { SettingsService } from '../settings.service';
import { APP_VERSION } from '../../version';

/**
 * Settings — app-wide options for the dealer panel.
 *
 * Offer banners, push notifications and share posts each have their own sidebar
 * tab now (see BannersPage / NotificationsPage / PostsPage); what's left here is
 * configuration rather than content.
 */
@Component({
  selector: 'app-admin-settings',
  templateUrl: './settings.page.html',
  styleUrls: ['./settings.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent]
})
export class SettingsPage implements OnInit {
  callNumber = '';
  saved = false;
  errorMsg = '';
  appVersion = APP_VERSION;

  constructor(private settingsService: SettingsService) {}

  ngOnInit() {
    this.callNumber = this.settingsService.callNumber;
  }

  save() {
    this.errorMsg = '';
    const value = (this.callNumber || '').trim();
    // Allow digits, spaces, +, -, and parentheses only.
    if (value && !/^[+]?[0-9\s\-()]{6,20}$/.test(value)) {
      this.errorMsg = 'Please enter a valid phone number.';
      return;
    }
    this.settingsService.updateCallNumber(value)
      .catch(err => console.warn('Firestore settings notice:', err?.message || err));
    this.callNumber = value;
    this.saved = true;
    setTimeout(() => (this.saved = false), 2500);
  }
}
