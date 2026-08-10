import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { SearchService } from '../search.service';

interface OrderCard {
  id: string;
  dealer: string;
  location: string;
  value: number;
  stage: 'New' | 'Confirmed' | 'Packed' | 'Dispatched' | 'Delivered';
}

interface ActivityLog {
  timestamp: string;
  event: string;
  dealer: string;
  status: 'NEW' | 'CONFIRMED' | 'PACKED' | 'DISPATCHED' | 'DELIVERED';
}

@Component({
  selector: 'app-orders',
  templateUrl: './orders.page.html',
  styleUrls: ['./orders.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonContent
  ]
})
export class OrdersPage implements OnInit {
  // Stats Counters
  stats = {
    dailyRevenue: 'Rs. 8.42L',
    pendingOrders: 28,
    activeDealers: 156,
    fulfillmentRate: '98.2%'
  };

  // Kanban Pipeline Orders
  orders: OrderCard[] = [
    {
      id: 'ORD-9021',
      dealer: 'Astra Electronics',
      location: 'Pune Regional Hub',
      value: 42500,
      stage: 'New'
    },
    {
      id: 'ORD-9025',
      dealer: 'Elite Power Solutions',
      location: 'Mumbai South',
      value: 112000,
      stage: 'New'
    },
    {
      id: 'ORD-8998',
      dealer: 'Rajput & Sons',
      location: 'Jaipur Industrial Area',
      value: 88750,
      stage: 'Confirmed'
    },
    {
      id: 'ORD-8854',
      dealer: 'Global Tech Hub',
      location: 'Bangalore North',
      value: 215400,
      stage: 'Packed'
    }
  ];

  // Live Activity Feed
  activityLogs: ActivityLog[] = [
    {
      timestamp: '10:42 AM',
      event: 'Order #8712 Marked as Dispatched',
      dealer: 'Urban Grid Corp',
      status: 'DISPATCHED'
    },
    {
      timestamp: '09:15 AM',
      event: 'New Order Received from Astra',
      dealer: 'Astra Electronics',
      status: 'NEW'
    },
    {
      timestamp: '08:30 AM',
      event: 'Order #8854 Final Packaging Completed',
      dealer: 'Global Tech Hub',
      status: 'PACKED'
    }
  ];

  constructor(
    private router: Router,
    private searchService: SearchService
  ) {}

  ngOnInit() {}

  // Filter pipeline orders based on search keywords
  get filteredOrders(): OrderCard[] {
    const searchVal = this.searchService.searchKeyword();
    if (!searchVal.trim()) {
      return this.orders;
    }
    const keyword = searchVal.toLowerCase().trim();
    return this.orders.filter(order =>
      order.id.toLowerCase().includes(keyword) ||
      order.dealer.toLowerCase().includes(keyword) ||
      order.location.toLowerCase().includes(keyword)
    );
  }

  // Get orders by specific stage
  getOrdersByStage(stage: 'New' | 'Confirmed' | 'Packed' | 'Dispatched' | 'Delivered'): OrderCard[] {
    return this.filteredOrders.filter(order => order.stage === stage);
  }

  // Action to move order card to the next pipeline stage
  moveNext(order: OrderCard) {
    const nextStages: Record<string, 'Confirmed' | 'Packed' | 'Dispatched' | 'Delivered'> = {
      'New': 'Confirmed',
      'Confirmed': 'Packed',
      'Packed': 'Dispatched',
      'Dispatched': 'Delivered'
    };

    const currentStage = order.stage;
    const next = nextStages[currentStage];

    if (next) {
      order.stage = next;
      // Prepend activity log entry
      const now = new Date();
      const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      this.activityLogs.unshift({
        timestamp: timeString,
        event: `Order #${order.id.split('-')[1]} moved from ${currentStage} to ${next}`,
        dealer: order.dealer,
        status: next.toUpperCase() as any
      });
      console.log(`Moved order ${order.id} from ${currentStage} to ${next}.`);
    } else {
      alert(`UX Microcopy: "Order ${order.id} is already in the final Delivered stage. Ready for archival."`);
    }
  }

  // Dialog actions
  exportReport() {
    alert('UX Microcopy: "Preparing Order Pipeline PDF summary. Downloading workflow report to local storage."');
  }

  openFilters() {
    alert('UX Microcopy: "Opening filter options: filter by region, dealer group, or order values."');
  }

  viewAllLogs() {
    alert('UX Microcopy: "Opening full history audit log records for all dealer order pipelines."');
  }
}
