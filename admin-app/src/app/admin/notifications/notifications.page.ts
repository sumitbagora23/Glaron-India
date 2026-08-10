import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import {
  NotificationService, PushNotification,
  notificationTargetLabel, notificationAudienceLabel
} from '../notification.service';

/**
 * Push Notifications — its own sidebar tab.
 *
 * Lists what has been broadcast to dealer and agent devices, newest first.
 * Composing a new one opens its own full page (see NotificationFormPage).
 */
@Component({
  selector: 'app-admin-notifications',
  templateUrl: './notifications.page.html',
  styleUrls: ['./notifications.page.scss'],
  standalone: true,
  imports: [CommonModule, IonContent]
})
export class NotificationsPage implements OnInit {
  constructor(
    private notificationService: NotificationService,
    private router: Router
  ) {}

  ngOnInit() {
    this.notificationService.startAdminFeed();
  }

  // Live feed from Firestore.
  get notifications(): PushNotification[] {
    return this.notificationService.recent;
  }

  trackById(_index: number, n: PushNotification): string {
    return n.id;
  }

  newNotification() {
    this.router.navigate(['/admin/notifications/new']);
  }

  // Friendly name of the screen a tap opens — admin-side label only. Resolved
  // against the app that received it, since the two have different tabs.
  targetLabel(n: PushNotification): string {
    return notificationTargetLabel(n.target, n.audience);
  }

  // "Dealers", "Agents" or "Both" — who the broadcast went to.
  audienceLabel(n: PushNotification): string {
    return notificationAudienceLabel(n.audience);
  }

  removeNotification(n: PushNotification, event: Event) {
    event.stopPropagation();
    if (!confirm('Delete this notification from the sent list?')) return;
    this.notificationService.remove(n.id);
  }

  // A short human-readable "time ago" label for the sent list.
  timeAgo(ts: number): string {
    const diff = Date.now() - (ts || 0);
    if (diff < 60_000) return 'just now';
    const mins = Math.floor(diff / 60_000);
    if (mins < 60) return mins + (mins === 1 ? ' min ago' : ' mins ago');
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago');
    const days = Math.floor(hours / 24);
    return days + (days === 1 ? ' day ago' : ' days ago');
  }
}
