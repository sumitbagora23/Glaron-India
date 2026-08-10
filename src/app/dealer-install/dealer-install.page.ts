import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { PwaInstallService } from '../pwa-install.service';
import { DealerI18nService } from '../dealer-i18n.service';
import { APP_VERSION } from '../version';

/**
 * Install wall for the dealer portal.
 *
 * The dealer panel is an app-only experience: opening the dealer site in a
 * normal browser tab lands here instead. Once the PWA is installed and launched
 * from the home screen (standalone display-mode), the guard lets the dealer
 * through to the real portal.
 */
@Component({
  selector: 'app-dealer-install',
  templateUrl: './dealer-install.page.html',
  styleUrls: ['./dealer-install.page.scss'],
  standalone: true,
  imports: [CommonModule, IonContent]
})
export class DealerInstallPage implements OnInit {
  readonly appVersion = APP_VERSION;
  installing = false;
  justInstalled = false;

  private readonly translations: Record<string, { en: string; hi: string }> = {
    // No role in the wording — this one app serves every kind of account, and
    // the install wall is the first screen anyone sees.
    title: { en: 'Install the App', hi: 'ऐप इंस्टॉल करें' },
    lead: {
      en: 'Glaron India runs as an app on your device. Install it once, then open it from your home screen to sign in.',
      hi: 'ग्लैरोन इंडिया आपके डिवाइस पर ऐप के रूप में चलता है। इसे एक बार इंस्टॉल करें, फिर होम स्क्रीन से खोलकर साइन इन करें।'
    },
    installBtn: { en: 'Install App', hi: 'ऐप इंस्टॉल करें' },
    installing: { en: 'Opening installer…', hi: 'इंस्टॉलर खुल रहा है…' },
    installedTitle: { en: 'App installed', hi: 'ऐप इंस्टॉल हो गया' },
    installedDesc: {
      en: 'Open “Glaron” from your home screen to continue.',
      hi: 'जारी रखने के लिए अपनी होम स्क्रीन से “Glaron” खोलें।'
    },
    howTo: { en: 'How to install', hi: 'इंस्टॉल कैसे करें' },
    howToIos: { en: 'How to install on iPhone / iPad', hi: 'iPhone / iPad पर इंस्टॉल कैसे करें' },
    iosStep1: { en: 'Tap the Share button at the bottom of Safari.', hi: 'Safari में नीचे शेयर बटन दबाएँ।' },
    iosStep2: { en: 'Scroll down and choose “Add to Home Screen”.', hi: 'नीचे स्क्रॉल कर “Add to Home Screen” चुनें।' },
    iosStep3: { en: 'Tap “Add”, then open Glaron from your home screen.', hi: '“Add” दबाएँ, फिर होम स्क्रीन से Glaron खोलें।' },
    iosSafariOnly: {
      en: 'On iPhone and iPad the app can only be added from Safari. Open this page in Safari, then follow the steps above.',
      hi: 'iPhone और iPad पर ऐप केवल Safari से जोड़ा जा सकता है। इस पेज को Safari में खोलें, फिर ऊपर दिए चरणों का पालन करें।'
    },
    androidStep1: { en: 'Open the browser menu (⋮).', hi: 'ब्राउज़र मेन्यू (⋮) खोलें।' },
    androidStep2: { en: 'Tap “Install app” / “Add to Home screen”.', hi: '“Install app” / “Add to Home screen” दबाएँ।' },
    androidStep3: { en: 'Open Glaron from your home screen.', hi: 'होम स्क्रीन से Glaron खोलें।' },
    benefit1: { en: 'Works offline with your catalog & pricing', hi: 'कैटलॉग और मूल्य के साथ ऑफ़लाइन काम करता है' },
    benefit2: { en: 'Instant order updates & notifications', hi: 'तुरंत ऑर्डर अपडेट और सूचनाएँ' },
    benefit3: { en: 'Faster, full-screen app experience', hi: 'तेज़, फुल-स्क्रीन ऐप अनुभव' },
    already: { en: 'Already installed?', hi: 'पहले से इंस्टॉल है?' },
    openApp: { en: 'Open the app from your home screen', hi: 'होम स्क्रीन से ऐप खोलें' }
  };

  constructor(
    private router: Router,
    public pwa: PwaInstallService,
    public i18n: DealerI18nService
  ) {}

  ngOnInit() {
    // Already running installed (e.g. hit this URL from inside the app) —
    // there is nothing to install, so go straight into the portal.
    if (this.pwa.isStandalone) {
      this.router.navigateByUrl('/dealer/welcome', { replaceUrl: true });
    }
  }

  get lang(): 'en' | 'hi' {
    return this.i18n.lang;
  }

  t(key: string): string {
    const entry = this.translations[key];
    if (!entry) return key;
    return entry[this.lang] || entry.en;
  }

  get isIos(): boolean {
    return this.pwa.isIos;
  }

  // iOS Chrome/Firefox/in-app browsers can't add to the home screen.
  get isIosNonSafari(): boolean {
    return this.pwa.isIosNonSafari;
  }

  get canPrompt(): boolean {
    return this.pwa.canPrompt();
  }

  async install() {
    if (this.installing) return;
    this.installing = true;
    const accepted = await this.pwa.promptInstall();
    this.installing = false;
    if (accepted) this.justInstalled = true;
  }
}
