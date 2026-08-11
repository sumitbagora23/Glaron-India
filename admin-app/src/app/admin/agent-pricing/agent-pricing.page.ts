import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { ProductService, Product, ProductVariant } from '../product.service';
import { AgentService, Agent } from '../agent.service';

interface PricingRow {
  key: string;          // productId (no-variant) or productId#<variantIndex>
  variantLabel?: string;
  catalogPrice: number;
  customPrice: number;
}

interface PricingGroup {
  productId: string;
  name: string;         // product name (shown once)
  rows: PricingRow[];   // variants (or a single base row)
}

/**
 * The agent's contracted rate — the same sheet the dealer gets.
 *
 * An agent shows the catalogue and can now show a price with it; this is where
 * that price comes from. A blanket discount fills every row, and any row can
 * then be typed over. Saved onto the agent record, which the agent panel reads
 * for its "My Price" view.
 */
@Component({
  selector: 'app-agent-pricing',
  templateUrl: './agent-pricing.page.html',
  styleUrls: ['./agent-pricing.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonContent
  ]
})
export class AgentPricingPage implements OnInit {
  agentId = '';
  agentName = '';
  agentPhone = '';
  agentStatus = '';
  currentAgent: Agent | null = null;

  pricingGroups: PricingGroup[] = [];
  discountPercent: number | null = null;
  isLoading = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private productService: ProductService,
    private agentService: AgentService
  ) {}

  ngOnInit() {
    this.route.paramMap.subscribe(params => {
      const id = params.get('id');
      if (id) {
        this.agentId = id;
        this.loadAgentDetails();
        this.loadPricingData();
      }
    });
  }

  loadAgentDetails() {
    const matched = this.agentService.agents.find(a => a.id === this.agentId);
    if (matched) {
      this.currentAgent = matched;
      this.agentName = matched.name;
      this.agentPhone = matched.phone || 'N/A';
      this.agentStatus = matched.status;
      if (matched.multiplier && matched.multiplier < 1.0) {
        this.discountPercent = Math.round((1 - matched.multiplier) * 100);
      }
    } else {
      this.agentName = this.agentId;
      this.agentPhone = 'N/A';
      this.agentStatus = 'Active';
    }
  }

  loadPricingData() {
    const products = this.productService.products;
    const savedPrices: Record<string, number> = { ...(this.currentAgent?.customPrices || {}) };
    const mult = this.currentAgent?.multiplier || 1.0;

    this.pricingGroups = products.map(product => {
      const rows: PricingRow[] = [];
      if (product.variants && product.variants.length > 0) {
        product.variants.forEach((variant, idx) => {
          const key = `${product.id}#${idx}`;
          const catalogPrice = variant.price || variant.pricePerMtr || product.price;
          const customPrice = savedPrices[key] !== undefined ? savedPrices[key] : Math.round(catalogPrice * mult);
          rows.push({ key, variantLabel: this.buildVariantLabel(variant), catalogPrice, customPrice });
        });
      } else {
        const customPrice = savedPrices[product.id] !== undefined ? savedPrices[product.id] : Math.round(product.price * mult);
        rows.push({ key: product.id, catalogPrice: product.price, customPrice });
      }
      return { productId: product.id, name: product.name, rows };
    });
  }

  private buildVariantLabel(variant: ProductVariant): string {
    const parts: string[] = [];
    const bad = (v?: string) => !v || !v.trim() || /dimension/i.test(v);
    if (!bad(variant.wattage)) parts.push(variant.wattage!.trim());
    if (variant.type && variant.type.trim()) parts.push(variant.type.trim());
    if (variant.dimension && variant.dimension.trim() && variant.dimension.trim() !== '-') parts.push(variant.dimension.trim());
    const colour = variant.bodyColour || variant.colorSize;
    if (colour && colour.trim()) parts.push(colour.trim());
    if (variant.pricePerMtr) parts.push('per mtr');
    if (parts.length === 0) parts.push(variant.model || 'Variant');
    return parts.join(' · ');
  }

  applyDiscount() {
    if (this.discountPercent === null || this.discountPercent < 0 || this.discountPercent > 100) {
      alert('Please enter a valid discount percentage between 0 and 100.');
      return;
    }

    const factor = (100 - this.discountPercent) / 100;
    this.pricingGroups.forEach(group => {
      group.rows.forEach(row => {
        row.customPrice = Math.round(row.catalogPrice * factor);
      });
    });
  }

  savePricing() {
    // The rows on screen replace the agent's whole custom-price map. If the
    // agent or the catalog hadn't synced when this page loaded, those rows are
    // catalog defaults for a subset of products — saving them would wipe the
    // real prices. Refuse rather than destroy them.
    if (!this.currentAgent) {
      alert('This agent\'s record has not loaded yet. Please go back and open their pricing again.');
      return;
    }
    if (this.pricingGroups.length === 0) {
      alert('The product catalog has not loaded yet. Please go back and open their pricing again.');
      return;
    }

    this.isLoading = true;
    const pricingMap: Record<string, number> = {};

    this.pricingGroups.forEach(group => {
      group.rows.forEach(row => {
        pricingMap[row.key] = row.customPrice;
      });
    });

    const mult = this.discountPercent !== null ? (100 - this.discountPercent) / 100 : (this.currentAgent?.multiplier || 1.0);
    this.agentService.updateAgentPricing(this.currentAgent.id || this.agentId, mult, pricingMap);

    setTimeout(() => {
      this.isLoading = false;
      this.router.navigate(['/admin/agents']);
    }, 600);
  }

  discard() {
    this.router.navigate(['/admin/agents']);
  }
}
