import { Injectable, signal, inject } from '@angular/core';
import { Firestore, doc, setDoc, onSnapshot } from '@angular/fire/firestore';

export interface AppSettings {
  // Phone number used by the "Call" button in the dealer panel.
  callNumber: string;
  // Legacy single promotional banner (data URL). Kept for backward
  // compatibility with older saved data; new code uses offerBanners.
  offerBannerImage: string;
  // Promotional banners (data URLs) shown as an auto-rotating carousel above the
  // categories in the dealer panel home tab. Empty = no banners configured.
  offerBanners: string[];
  // Ids of the dealers allowed to see the offer banners. Empty = nobody sees
  // them; only dealers whose id appears here get the banners.
  offerDealerIds: string[];
}

@Injectable({
  providedIn: 'root'
})
export class SettingsService {
  private STORAGE_KEY = 'glaron_app_settings_v1';
  private firestore = inject(Firestore, { optional: true });

  // Single settings document lives at settings/app in Firestore.
  private readonly DOC_ID = 'app';

  private settingsSignal = signal<AppSettings>(this.loadFromStorage());

  constructor() {
    this.initFirestoreSync();
  }

  private initFirestoreSync() {
    if (!this.firestore) return;
    try {
      const ref = doc(this.firestore, 'settings', this.DOC_ID);
      onSnapshot(ref, (snap) => {
        if (snap.exists()) {
          const data = snap.data() as Partial<AppSettings>;
          const merged: AppSettings = {
            callNumber: data.callNumber || '',
            offerBannerImage: data.offerBannerImage || '',
            offerBanners: this.normalizeBanners(data.offerBanners, data.offerBannerImage),
            offerDealerIds: Array.isArray(data.offerDealerIds) ? data.offerDealerIds : []
          };
          this.settingsSignal.set(merged);
          this.saveToStorage(merged);
        }
      }, (err) => {
        console.warn('Firestore settings notice (using local fallback):', err?.message || err);
      });
    } catch (e) {
      console.warn('Firestore settings init notice:', e);
    }
  }

  private loadFromStorage(): AppSettings {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<AppSettings>;
        return {
          callNumber: parsed.callNumber || '',
          offerBannerImage: parsed.offerBannerImage || '',
          offerBanners: this.normalizeBanners(parsed.offerBanners, parsed.offerBannerImage),
          offerDealerIds: Array.isArray(parsed.offerDealerIds) ? parsed.offerDealerIds : []
        };
      }
    } catch (e) {
      console.error('Error loading settings from localStorage', e);
    }
    return { callNumber: '', offerBannerImage: '', offerBanners: [], offerDealerIds: [] };
  }

  // Produces the banner list from stored data, migrating a legacy single
  // offerBannerImage into the array when no array exists yet.
  private normalizeBanners(banners: unknown, legacy: unknown): string[] {
    const list = Array.isArray(banners)
      ? banners.filter((b): b is string => typeof b === 'string' && !!b)
      : [];
    if (list.length) return list;
    return typeof legacy === 'string' && legacy ? [legacy] : [];
  }

  private saveToStorage(settings: AppSettings) {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
      console.error('Error saving settings to localStorage', e);
    }
  }

  // Persists the current settings signal to localStorage and Firestore.
  // Returns a promise that rejects when the Firestore write fails, so a caller
  // that can report it (the banner form) doesn't show a success screen for
  // settings the dealers never received. Every banner is stored inline in this
  // one document, so it is the write most likely to hit the 1 MB limit.
  private persist(updated: AppSettings): Promise<void> {
    this.settingsSignal.set(updated);
    this.saveToStorage(updated);

    if (this.firestore) {
      return setDoc(doc(this.firestore, 'settings', this.DOC_ID), updated, { merge: true });
    }
    return Promise.resolve();
  }

  // Rough encoded size of the settings document, used to refuse a banner set
  // that would blow Firestore's 1 MB per-document limit.
  estimatedSizeWith(banners: string[]): number {
    const next: AppSettings = {
      ...this.settingsSignal(),
      offerBanners: banners,
      offerBannerImage: banners[0] || ''
    };
    return JSON.stringify(next).length;
  }

  get settings(): AppSettings {
    return this.settingsSignal();
  }

  get callNumber(): string {
    return this.settingsSignal().callNumber || '';
  }

  get offerBannerImage(): string {
    return this.settingsSignal().offerBannerImage || '';
  }

  // The banners to show (already migrated from any legacy single image).
  get offerBanners(): string[] {
    return this.settingsSignal().offerBanners || [];
  }

  get offerDealerIds(): string[] {
    return this.settingsSignal().offerDealerIds || [];
  }

  updateCallNumber(callNumber: string): Promise<void> {
    const clean = (callNumber || '').trim();
    return this.persist({ ...this.settingsSignal(), callNumber: clean });
  }

  // Stores (or clears) the legacy single offer banner image. Pass '' to remove.
  updateOfferBannerImage(image: string): Promise<void> {
    return this.persist({ ...this.settingsSignal(), offerBannerImage: image || '' });
  }

  // Stores the full list of offer banners (carousel). The legacy single-image
  // field is kept in sync with the first banner for backward compatibility.
  updateOfferBanners(images: string[]): Promise<void> {
    const clean = (images || []).filter(b => typeof b === 'string' && !!b);
    return this.persist({
      ...this.settingsSignal(),
      offerBanners: clean,
      offerBannerImage: clean[0] || ''
    });
  }

  // Stores the list of dealer ids that should see the offer banner.
  updateOfferDealerIds(ids: string[]): Promise<void> {
    const clean = Array.from(new Set((ids || []).filter(Boolean)));
    return this.persist({ ...this.settingsSignal(), offerDealerIds: clean });
  }
}
