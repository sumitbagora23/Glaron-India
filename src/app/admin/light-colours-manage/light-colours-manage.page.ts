import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { LightColourService, LightColour } from '../light-colour.service';
import { NO_COLOUR, lightColourSwatch } from '../light-colours';
import { ProductService, Product, ProductVariant } from '../product.service';

/**
 * The Light Colours page — the full list of shades the product form offers,
 * with add, rename, reorder and delete.
 *
 * Reached from "Add Light Colour" on the product add/edit form, which parks its
 * half-filled product in sessionStorage first and picks it back up when this
 * page hands control back (see returnTo below and restoreDraft() on the form).
 *
 * A product stores the shade's NAME, so renaming or deleting one here is also a
 * change to every product carrying it. Both are pushed through to those
 * products rather than leaving behind a name the list no longer has.
 *
 * "No Colour" is not on this list. It is not a shade — it is what the product
 * form writes when its picker is cleared — and LightColourService keeps it out.
 */
@Component({
  selector: 'app-light-colours-manage',
  templateUrl: './light-colours-manage.page.html',
  styleUrls: ['./light-colours-manage.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent]
})
export class LightColoursManagePage implements OnInit {

  // The box of colour drawn before a light colour name. Worked out from the
  // name itself, so a shade added today is painted without a code change.
  swatch(colour: string): string {
    return lightColourSwatch(colour);
  }

  // New shade being typed in the top card.
  newName = '';
  addError = '';

  // The row currently open for rename ('' when none).
  editingId = '';
  editingName = '';
  editError = '';

  // Shown after a rename / delete that touched saved products, and when a write
  // fails — a shade that never synced must not look like it did.
  notice = '';
  saveError = '';
  busy = false;

  // Where "Done" goes back to. The product form passes its own URL so a
  // half-filled product is returned to, not dropped.
  private returnTo = '/admin/dashboard';

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private lightColourService: LightColourService,
    private productService: ProductService
  ) {}

  ngOnInit() {
    const back = this.route.snapshot.queryParamMap.get('returnTo');
    // Only ever an in-app console path, so a crafted link cannot bounce the
    // admin off to another site through this button.
    if (back && back.startsWith('/admin/')) this.returnTo = back;
  }

  get colours(): LightColour[] {
    return this.lightColourService.colours;
  }

  trackByColourId(_index: number, colour: LightColour): string {
    return colour.id;
  }

  // How many saved products are sold in this shade — shown on the row so a
  // delete is never a guess.
  productCount(name: string): number {
    return this.productService.products.filter(p => (p.lightColours || []).includes(name)).length;
  }

  isFirst(colour: LightColour): boolean {
    return this.colours[0]?.id === colour.id;
  }

  isLast(colour: LightColour): boolean {
    return this.colours[this.colours.length - 1]?.id === colour.id;
  }

  goBack() {
    this.router.navigateByUrl(this.returnTo);
  }

  // "No Colour" is the picker's cleared state, not a shade. Saved under that
  // name it would be stripped straight back out on the next read, so it is
  // turned away here with a reason instead of vanishing after a "saved".
  private reservedName(name: string): boolean {
    return name.trim().toLowerCase() === NO_COLOUR.toLowerCase();
  }

  // ---- Add ----
  async addColour() {
    const name = this.newName.trim();
    this.addError = '';
    this.notice = '';
    this.saveError = '';

    if (name.length < 2) {
      this.addError = 'Please enter a colour name (at least 2 characters).';
      return;
    }
    if (this.reservedName(name)) {
      this.addError = 'That name is reserved. A product with no shade to choose is set with the clear (×) on the product form.';
      return;
    }
    if (this.lightColourService.nameTaken(name)) {
      this.addError = '"' + name + '" is already in the list.';
      return;
    }

    this.busy = true;
    try {
      await this.lightColourService.addColour(name);
      this.newName = '';
      this.notice = 'Added "' + name + '".';
    } catch (e) {
      this.saveError = 'Could not save to the server. Check your connection and try again.';
    } finally {
      this.busy = false;
    }
  }

  // ---- Rename ----
  startEdit(colour: LightColour) {
    this.editingId = colour.id;
    this.editingName = colour.name;
    this.editError = '';
    this.notice = '';
    this.saveError = '';
  }

  cancelEdit() {
    this.editingId = '';
    this.editingName = '';
    this.editError = '';
  }

  async saveEdit(colour: LightColour) {
    const name = this.editingName.trim();
    this.editError = '';
    this.saveError = '';

    if (name.length < 2) {
      this.editError = 'Please enter a colour name (at least 2 characters).';
      return;
    }
    if (this.reservedName(name)) {
      this.editError = 'That name is reserved. A product with no shade to choose is set with the clear (×) on the product form.';
      return;
    }
    if (this.lightColourService.nameTaken(name, colour.id)) {
      this.editError = '"' + name + '" is already in the list.';
      return;
    }
    if (name === colour.name) {
      this.cancelEdit();
      return;
    }

    this.busy = true;
    try {
      await this.lightColourService.updateColour({ ...colour, name });
      const touched = await this.renameOnProducts(colour.name, name);
      this.notice = touched
        ? 'Renamed to "' + name + '" — updated on ' + touched + ' product' + (touched === 1 ? '' : 's') + '.'
        : 'Renamed to "' + name + '".';
      this.cancelEdit();
    } catch (e) {
      this.saveError = 'Could not save to the server. Check your connection and try again.';
    } finally {
      this.busy = false;
    }
  }

  // ---- Delete ----
  async deleteColour(colour: LightColour) {
    const used = this.productCount(colour.name);
    const warning = used
      ? '\n\nIt is also removed from ' + used + ' product' + (used === 1 ? '' : 's') +
        ' sold in this shade, along with any price set for it.'
      : '';
    if (!confirm('Delete light colour "' + colour.name + '"?' + warning + '\n\nThis cannot be undone.')) return;

    this.notice = '';
    this.saveError = '';
    this.busy = true;
    try {
      await this.lightColourService.deleteColour(colour.id);
      const touched = await this.removeFromProducts(colour.name);
      this.notice = touched
        ? 'Deleted "' + colour.name + '" — removed from ' + touched + ' product' + (touched === 1 ? '' : 's') + '.'
        : 'Deleted "' + colour.name + '".';
      if (this.editingId === colour.id) this.cancelEdit();
    } catch (e) {
      this.saveError = 'Could not save to the server. Check your connection and try again.';
    } finally {
      this.busy = false;
    }
  }

  // ---- Order ----
  // The order here is the order the product form's dropdown lists them in.
  async move(colour: LightColour, direction: -1 | 1) {
    this.notice = '';
    this.saveError = '';
    this.busy = true;
    try {
      await this.lightColourService.move(colour.id, direction);
    } catch (e) {
      this.saveError = 'Could not save the new order. Check your connection and try again.';
    } finally {
      this.busy = false;
    }
  }

  // A shade can sit on the product itself and on any of its options, so both
  // have to be swept — an option left carrying the old name would keep offering
  // a colour that no longer exists under just that one wattage tab.
  private carriesColour(product: Product, name: string): boolean {
    return (product.lightColours || []).includes(name) ||
      (product.variants || []).some(v => (v.lightColours || []).includes(name));
  }

  // Rewrites one option's shades, keeping its own per-shade price with them.
  // `to` is null for a delete: the colour is dropped rather than renamed.
  private rewriteVariant(variant: ProductVariant, from: string, to: string | null): ProductVariant {
    const own = variant.lightColours || [];
    if (!own.includes(from)) return variant;

    const lightColours = to ? own.map(c => (c === from ? to : c)) : own.filter(c => c !== from);
    const prices = { ...(variant.lightColourPrice || {}) };
    if (to && prices[from] !== undefined) prices[to] = prices[from];
    delete prices[from];

    return {
      ...variant,
      // An option left with nothing goes back to following the product, which
      // is what an absent list means — not "sold in no shade".
      lightColours: lightColours.length ? lightColours : undefined,
      lightColourPrice: Object.keys(prices).length ? prices : undefined
    };
  }

  private rewriteVariants(product: Product, from: string, to: string | null): ProductVariant[] | undefined {
    if (!product.variants) return undefined;
    return product.variants.map(v => this.rewriteVariant(v, from, to));
  }

  // Carries a rename across to every product sold in that shade, keeping the
  // per-shade price with it. Returns how many products were rewritten.
  private async renameOnProducts(oldName: string, newName: string): Promise<number> {
    const affected = this.productService.products.filter(p => this.carriesColour(p, oldName));
    for (const product of affected) {
      const lightColours = (product.lightColours || []).map(c => (c === oldName ? newName : c));
      const prices = { ...(product.lightColourPrice || {}) };
      if (prices[oldName] !== undefined) {
        prices[newName] = prices[oldName];
        delete prices[oldName];
      }
      await this.productService.updateProduct({
        ...product,
        lightColours: lightColours.length ? lightColours : undefined,
        lightColourPrice: Object.keys(prices).length ? prices : undefined,
        variants: this.rewriteVariants(product, oldName, newName)
      });
    }
    return affected.length;
  }

  // Drops a deleted shade from every product carrying it, so no catalogue card
  // offers a colour the list no longer has.
  private async removeFromProducts(name: string): Promise<number> {
    const affected = this.productService.products.filter(p => this.carriesColour(p, name));
    for (const product of affected) {
      const lightColours = (product.lightColours || []).filter(c => c !== name);
      const prices = { ...(product.lightColourPrice || {}) };
      delete prices[name];
      await this.productService.updateProduct({
        ...product,
        lightColours: lightColours.length ? lightColours : undefined,
        lightColourPrice: Object.keys(prices).length ? prices : undefined,
        variants: this.rewriteVariants(product, name, null)
      });
    }
    return affected.length;
  }
}
