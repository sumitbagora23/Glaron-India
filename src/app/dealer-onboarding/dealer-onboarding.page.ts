import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';

interface Slide {
  key: string;
  title: string;
  desc: string;
}

/**
 * First-launch onboarding carousel (3 slides). Purely presentational — on
 * finish/skip it records that onboarding has been seen and hands off to login.
 * No auth or business logic is touched.
 */
@Component({
  selector: 'app-dealer-onboarding',
  templateUrl: './dealer-onboarding.page.html',
  styleUrls: ['./dealer-onboarding.page.scss'],
  standalone: true,
  imports: [CommonModule, IonContent],
})
export class DealerOnboardingPage implements OnInit {
  private readonly ONBOARD_KEY = 'glaron_dealer_onboarding_seen';

  index = 0;
  private touchStartX: number | null = null;

  readonly slides: Slide[] = [
    {
      key: 'manage',
      title: 'Manage Your Business',
      desc: 'Your full product catalog, contracted pricing and orders — organised in one clean, fast dashboard.',
    },
    {
      key: 'grow',
      title: 'Grow Your Business',
      desc: 'Place orders in seconds, track every shipment stage live, and never miss a fresh offer from Glaron.',
    },
    {
      key: 'everything',
      title: 'Everything in One Place',
      desc: 'Catalog, cart, orders and your profile — a premium mobile workspace built for modern dealers.',
    },
  ];

  constructor(private router: Router) {}

  ngOnInit() {}

  get isLast(): boolean {
    return this.index === this.slides.length - 1;
  }

  goTo(i: number) {
    this.index = Math.max(0, Math.min(this.slides.length - 1, i));
  }

  next() {
    if (this.isLast) {
      this.finish();
      return;
    }
    this.index++;
  }

  skip() {
    this.finish();
  }

  private finish() {
    try {
      localStorage.setItem(this.ONBOARD_KEY, '1');
    } catch (e) {}
    this.router.navigateByUrl('/dealer/login', { replaceUrl: true });
  }

  // ---- Swipe navigation ----
  onTouchStart(e: TouchEvent) {
    this.touchStartX = e.changedTouches[0]?.clientX ?? null;
  }

  onTouchEnd(e: TouchEvent) {
    if (this.touchStartX === null) return;
    const dx = (e.changedTouches[0]?.clientX ?? this.touchStartX) - this.touchStartX;
    if (Math.abs(dx) > 45) {
      if (dx < 0) this.next();
      else this.goTo(this.index - 1);
    }
    this.touchStartX = null;
  }
}
