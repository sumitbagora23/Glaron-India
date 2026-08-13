import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import {
  NotificationService, NotificationTarget, NotificationAudience,
  NotificationAudienceOption, NOTIFICATION_AUDIENCES,
  DEFAULT_NOTIFICATION_AUDIENCE, notificationTargets, resolveNotificationTarget,
  audienceIncludesDealer, audienceIncludesAgent, normalisePhone
} from '../notification.service';
import { DealerService, Dealer } from '../dealer.service';
import { AgentService, Agent } from '../agent.service';

// Whether a side of the audience goes to everyone or to a ticked few.
type RecipientMode = 'all' | 'choose';

/**
 * New Notification — the full page behind the "New Notification" button.
 *
 * Composes a broadcast: who receives it (dealers, agents or both, and either
 * everyone on a side or specific people), title, message, an optional picture,
 * and which screen a tap opens. Sending returns to the notifications list.
 */
@Component({
  selector: 'app-admin-notification-form',
  templateUrl: './notification-form.page.html',
  styleUrls: ['./notification-form.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent]
})
export class NotificationFormPage implements OnInit {
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

  // Within the chosen audience, each side goes either to everyone or to the
  // people ticked below. The two sides are independent, so a "Both" broadcast
  // can go to every agent but only three named dealers.
  dealerMode: RecipientMode = 'all';
  agentMode: RecipientMode = 'all';

  dealerSearch = '';
  agentSearch = '';

  // Ticked recipients, held as normalised 10-digit numbers. The mobile number
  // is the join key: it is what a dealer or agent signs in with AND what their
  // device's push token is stored against, so it is the only field that links a
  // record the admin ticked to a phone that can be reached.
  private selectedDealerPhones = new Set<string>();
  private selectedAgentPhones = new Set<string>();

  recipientErrorMsg = '';

  // Which screen a tap on the notification opens. The typed tab name is the
  // single source of truth — the chips are shortcuts that fill this box in.
  // The underlying path is never shown to the recipient.
  target = notificationTargets(DEFAULT_NOTIFICATION_AUDIENCE)[0].label;

  constructor(
    private notificationService: NotificationService,
    private dealerService: DealerService,
    private agentService: AgentService,
    private router: Router
  ) {}

  // Both lists render straight from their services' signals; this only waits
  // for the first Firestore snapshot so the pickers don't sit empty while a
  // cached list is replaced.
  async ngOnInit() {
    await Promise.all([
      this.dealerService.whenReady(),
      this.agentService.whenReady()
    ]);
  }

  // ---------------- Recipients ----------------

  // Which pickers are on screen follows the audience chips above.
  get showDealerPicker(): boolean {
    return audienceIncludesDealer(this.audience);
  }

  get showAgentPicker(): boolean {
    return audienceIncludesAgent(this.audience);
  }

  // Only people we can actually reach: the mobile number is what a push token
  // is stored against, so a record without one can never be matched to a
  // device and would be a tick that silently does nothing.
  get dealers(): Dealer[] {
    return this.dealerService.dealers.filter((d) => !!normalisePhone(d.phone));
  }

  get agents(): Agent[] {
    return this.agentService.agents.filter((a) => !!normalisePhone(a.phone));
  }

  get filteredDealers(): Dealer[] {
    const q = this.dealerSearch.toLowerCase().trim();
    if (!q) return this.dealers;
    return this.dealers.filter((d) =>
      (d.name || '').toLowerCase().includes(q) ||
      (d.phone || '').toLowerCase().includes(q) ||
      (d.location || '').toLowerCase().includes(q)
    );
  }

  get filteredAgents(): Agent[] {
    const q = this.agentSearch.toLowerCase().trim();
    if (!q) return this.agents;
    return this.agents.filter((a) =>
      (a.name || '').toLowerCase().includes(q) ||
      (a.phone || '').toLowerCase().includes(q) ||
      (a.location || '').toLowerCase().includes(q)
    );
  }

  trackByPhone(_index: number, person: Dealer | Agent): string {
    return normalisePhone(person.phone);
  }

  isDealerSelected(dealer: Dealer): boolean {
    return this.selectedDealerPhones.has(normalisePhone(dealer.phone));
  }

  isAgentSelected(agent: Agent): boolean {
    return this.selectedAgentPhones.has(normalisePhone(agent.phone));
  }

  toggleDealer(dealer: Dealer) {
    this.toggleIn(this.selectedDealerPhones, dealer.phone);
    this.recipientErrorMsg = '';
  }

  toggleAgent(agent: Agent) {
    this.toggleIn(this.selectedAgentPhones, agent.phone);
    this.recipientErrorMsg = '';
  }

  private toggleIn(set: Set<string>, phone?: string) {
    const key = normalisePhone(phone);
    if (!key) return;
    if (set.has(key)) set.delete(key); else set.add(key);
  }

  get selectedDealerCount(): number {
    return this.selectedDealerPhones.size;
  }

  get selectedAgentCount(): number {
    return this.selectedAgentPhones.size;
  }

  // "Select all" reflects the CURRENTLY FILTERED list, so it ticks what the
  // admin can see rather than silently reaching past the search box.
  get allDealersSelected(): boolean {
    const list = this.filteredDealers;
    return list.length > 0 && list.every((d) => this.isDealerSelected(d));
  }

  get allAgentsSelected(): boolean {
    const list = this.filteredAgents;
    return list.length > 0 && list.every((a) => this.isAgentSelected(a));
  }

  toggleAllDealers() {
    const all = this.allDealersSelected;
    this.filteredDealers.forEach((d) => {
      const key = normalisePhone(d.phone);
      if (all) this.selectedDealerPhones.delete(key);
      else this.selectedDealerPhones.add(key);
    });
    this.recipientErrorMsg = '';
  }

  toggleAllAgents() {
    const all = this.allAgentsSelected;
    this.filteredAgents.forEach((a) => {
      const key = normalisePhone(a.phone);
      if (all) this.selectedAgentPhones.delete(key);
      else this.selectedAgentPhones.add(key);
    });
    this.recipientErrorMsg = '';
  }

  setDealerMode(mode: RecipientMode) {
    this.dealerMode = mode;
    this.recipientErrorMsg = '';
  }

  setAgentMode(mode: RecipientMode) {
    this.agentMode = mode;
    this.recipientErrorMsg = '';
  }

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
    this.recipientErrorMsg = '';
    const title = (this.title || '').trim();
    const body = (this.body || '').trim();
    if (!title) {
      this.errorMsg = 'Please enter a notification title.';
      return;
    }

    // "Choose" with nothing ticked would write an empty list, which every
    // reader treats as "everyone" — the exact opposite of what was meant. Stop
    // rather than quietly broadcasting to the lot.
    if (this.showDealerPicker && this.dealerMode === 'choose' && !this.selectedDealerCount) {
      this.recipientErrorMsg = 'Tick at least one dealer, or switch back to All dealers.';
      return;
    }
    if (this.showAgentPicker && this.agentMode === 'choose' && !this.selectedAgentCount) {
      this.recipientErrorMsg = 'Tick at least one agent, or switch back to All agents.';
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
      await this.notificationService.send(
        title, body, this.target, this.image, this.audience,
        {
          // Only a side set to "Choose" contributes a list; "All" passes
          // nothing, which is how everyone on that side gets reached.
          dealerPhones: this.dealerMode === 'choose' ? Array.from(this.selectedDealerPhones) : [],
          agentPhones: this.agentMode === 'choose' ? Array.from(this.selectedAgentPhones) : []
        }
      );
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
