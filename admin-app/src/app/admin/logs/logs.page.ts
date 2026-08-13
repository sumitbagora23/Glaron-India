import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent } from '@ionic/angular/standalone';
import { SearchService } from '../search.service';
import { DealerService } from '../dealer.service';
import { AgentService } from '../agent.service';
import {
  ActivityLogService, ActivityLog, ActivitySection,
  ACTIVITY_SECTIONS, normaliseActor
} from '../activity-log.service';
import { orderRefLabel } from '../order-ref';

/** One person who shows up in the feed, for the "Person" filter. */
interface ActivityPerson {
  phone: string;
  name: string;
  role: 'dealer' | 'agent';
  count: number;
}

/**
 * Activity Logs — its own sidebar tab.
 *
 * A read-only record of what dealers and agents do inside the app: which tabs
 * they open, the categories and products they look at, what they search for,
 * what goes into the cart, and the orders they check out with. The apps write
 * these entries (see ActivityLogService); nothing is composed here.
 *
 * The list is filtered four ways — who (dealer/agent), what kind of activity,
 * which person, and how recently — on top of the console's top-bar search.
 */
@Component({
  selector: 'app-admin-logs',
  templateUrl: './logs.page.html',
  styleUrls: ['./logs.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent]
})
export class LogsPage implements OnInit {
  roleFilter: 'all' | 'dealer' | 'agent' = 'all';
  sectionFilter: 'all' | ActivitySection = 'all';
  /** A normalised mobile number, or 'all'. */
  personFilter = 'all';
  rangeFilter: 'today' | '7d' | '30d' | 'all' = 'all';

  readonly sections = ACTIVITY_SECTIONS;

  /**
   * The page's own search box.
   *
   * It reads and writes the SAME SearchService the top bar's field uses, so the
   * two are one control shown in two places rather than two filters fighting
   * each other — typing in either updates both, and switching tabs clears both.
   */
  get searchTerm(): string {
    return this.searchService.searchKeyword();
  }

  set searchTerm(value: string) {
    this.searchService.setKeyword(value);
  }

  clearSearch() {
    this.searchService.clear();
  }

  // The "Clean up" action reports its result inline rather than in an alert.
  cleaning = false;
  cleanupMessage = '';

  constructor(
    private activityLog: ActivityLogService,
    private searchService: SearchService,
    private dealerService: DealerService,
    private agentService: AgentService
  ) {}

  ngOnInit() {
    this.activityLog.start();
  }

  // ---------------- Data ----------------

  get logs(): ActivityLog[] {
    return this.activityLog.logs;
  }

  trackById(_index: number, log: ActivityLog): string {
    return log.id;
  }

  /**
   * The business name behind an entry.
   *
   * Entries carry the name that was resolved on the device, which is often
   * blank — an agent's list isn't loaded in the app that wrote it, and a dealer
   * whose record hadn't synced yet writes an empty one. Both are resolved here
   * against the console's own lists, which are always complete.
   */
  displayName(log: ActivityLog): string {
    if (log.name) return log.name;
    const phone = normaliseActor(log.phone);
    const found = log.role === 'agent'
      ? this.agentService.findByMobile(phone)
      : this.dealerService.findByMobile(phone);
    return found?.name || 'Unknown';
  }

  /** Up to two initials for the avatar bubble. */
  initials(log: ActivityLog): string {
    const name = this.displayName(log);
    const parts = name.split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
  }

  /** Everyone who appears in the loaded feed, busiest first. */
  get people(): ActivityPerson[] {
    const map = new Map<string, ActivityPerson>();
    for (const log of this.logs) {
      const phone = normaliseActor(log.phone);
      if (!phone) continue;
      const existing = map.get(phone);
      if (existing) {
        existing.count++;
        if (existing.name === 'Unknown') existing.name = this.displayName(log);
      } else {
        map.set(phone, {
          phone,
          name: this.displayName(log),
          role: log.role === 'agent' ? 'agent' : 'dealer',
          count: 1
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }

  // Oldest instant an entry may carry to pass the date filter.
  private get rangeCutoff(): number {
    const day = 24 * 60 * 60 * 1000;
    if (this.rangeFilter === 'today') {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      return start.getTime();
    }
    if (this.rangeFilter === '7d') return Date.now() - 7 * day;
    if (this.rangeFilter === '30d') return Date.now() - 30 * day;
    return 0;
  }

  get filteredLogs(): ActivityLog[] {
    const cutoff = this.rangeCutoff;
    let list = this.logs.filter(l => l.at >= cutoff);

    if (this.roleFilter !== 'all') {
      list = list.filter(l => (l.role === 'agent' ? 'agent' : 'dealer') === this.roleFilter);
    }

    if (this.sectionFilter !== 'all') {
      list = list.filter(l => l.section === this.sectionFilter);
    }

    if (this.personFilter !== 'all') {
      list = list.filter(l => normaliseActor(l.phone) === this.personFilter);
    }

    const searchVal = this.searchService.searchKeyword();
    if (searchVal.trim()) {
      const keyword = searchVal.toLowerCase().trim();
      list = list.filter(l =>
        this.displayName(l).toLowerCase().includes(keyword) ||
        (l.phone || '').includes(keyword) ||
        (l.label || '').toLowerCase().includes(keyword) ||
        (l.detail || '').toLowerCase().includes(keyword) ||
        (l.productName || '').toLowerCase().includes(keyword) ||
        (l.sku || '').toLowerCase().includes(keyword) ||
        (l.category || '').toLowerCase().includes(keyword) ||
        (l.orderId || '').toLowerCase().includes(keyword) ||
        // Also match what the row actually shows, so searching "417" finds it.
        (l.orderId ? this.orderRef(l.orderId).toLowerCase().includes(keyword) : false)
      );
    }

    return list;
  }

  /** Short order label, e.g. `ORD - 417` — the same number the dealer sees. */
  orderRef(id: string): string {
    return orderRefLabel(id);
  }

  /** True when any filter is narrowing the list — drives the "Clear" link. */
  get hasFilters(): boolean {
    return this.roleFilter !== 'all' || this.sectionFilter !== 'all' ||
           this.personFilter !== 'all' || this.rangeFilter !== 'all' ||
           !!this.searchTerm.trim();
  }

  clearFilters() {
    this.roleFilter = 'all';
    this.sectionFilter = 'all';
    this.personFilter = 'all';
    this.rangeFilter = 'all';
    this.clearSearch();
  }

  // ---------------- Summary strip ----------------
  // All counted over the filtered list, so the tiles always describe exactly
  // what the table below is showing.

  get activeDealers(): number {
    return new Set(this.filteredLogs.filter(l => l.role !== 'agent').map(l => normaliseActor(l.phone))).size;
  }

  get activeAgents(): number {
    return new Set(this.filteredLogs.filter(l => l.role === 'agent').map(l => normaliseActor(l.phone))).size;
  }

  get productViews(): number {
    return this.filteredLogs.filter(l => l.section === 'product').length;
  }

  get ordersPlaced(): number {
    return this.filteredLogs.filter(l => l.action === 'order-placed').length;
  }

  /** Rupee value of the orders in view. */
  get orderValue(): number {
    return this.filteredLogs
      .filter(l => l.action === 'order-placed')
      .reduce((sum, l) => sum + (l.amount || 0), 0);
  }

  // ---------------- Labels ----------------

  sectionLabel(section?: string): string {
    return this.sections.find(s => s.key === section)?.label || 'Activity';
  }

  /** CSS modifier for the section pill, e.g. 'sec-cart'. */
  sectionClass(section?: string): string {
    return 'sec-' + (section || 'browse');
  }

  roleLabel(log: ActivityLog): string {
    return log.role === 'agent' ? 'Agent' : 'Dealer';
  }

  /** Short "time ago" for the When column. */
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

  /** Exact date and time, shown under the relative one and on hover. */
  exactTime(ts: number): string {
    if (!ts) return '';
    return new Date(ts).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
    });
  }

  /** Money the way the rest of the console writes it. */
  money(value?: number): string {
    return '₹' + (value || 0).toLocaleString('en-IN');
  }

  // ---------------- Actions ----------------

  removeLog(log: ActivityLog, event: Event) {
    event.stopPropagation();
    if (!confirm('Remove this entry from the activity log?')) return;
    this.activityLog.remove(log.id);
  }

  /**
   * Drop entries older than a month. The feed is a rolling record, not an
   * archive — without this it grows for as long as the apps are in use.
   */
  async cleanUp() {
    if (this.cleaning) return;
    if (!confirm('Delete activity older than 30 days? This cannot be undone.')) return;
    this.cleaning = true;
    this.cleanupMessage = '';
    try {
      const removed = await this.activityLog.purgeOlderThan(30);
      this.cleanupMessage = removed
        ? `Removed ${removed} old ${removed === 1 ? 'entry' : 'entries'}.`
        : 'Nothing older than 30 days to remove.';
    } catch (e: any) {
      this.cleanupMessage = 'Could not clean up right now. Please try again.';
    } finally {
      this.cleaning = false;
    }
  }
}
