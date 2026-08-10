# Glaron India Admin Panel Status & Roadmap

This document serves as a tracking file for the development of the **Glaron India Admin Panel**. It outlines the completed features, layout specifications implemented, and upcoming tasks.

---

## 1. What We Have Done So Far

### Base Foundation
* **Ionic Angular standalone setup**: Created a high-performance modern web framework configuration.
* **Global Outfit Typography**: Linked and verified Google Font `Outfit` globally to ensure clean rendering.
* **Firebase SDK Integration**: Bootstrapped Firestore database and Authentication SDK modules.
* **SCSS Layout Refactoring**: Consolidated the sidebar, top navigation, canvas margins, and breadcrumbs into global styles, reducing bundle sizes and preventing build errors.

### Page 1: Admin Login Screen
* Atmospheric radial lighting effects (gold glow blur backgrounds).
* Fully responsive viewport scale to prevent vertical scrolling.
* Validation checks for empty fields and valid email formats.
* **Admin Bypass Credentials**:
  * Email: `admin@glaronindia.com`
  * Password: `123456789`

### Page 2: Product Management Catalog (Dashboard)
* **Left Sidebar**: Glaron brand headers, active menu highlighting, and a gold direct order button.
* **Top Navigation Bar**: Brand text, search box, system action buttons, and profile avatar.
* **Bento Stats Grid**: Total SKU counters (+12% trend), Active Dealers (+4 trend), Pending Orders (Urgent badge), and Monthly Revenue (In-line badge).
* **Inventory Overview Table**: Interactive search filter, category badges, stock status indicators, and custom shaded row designs. Includes crisp inline SVGs for product types (Panel Light, Freedom Street Light, Ball Bulb, and CB Curve Strip).
* **Pagination Controls**: Bottom selection footer showing active item summaries.

### Page 3: Add / Edit Product Form
* **Dynamic Route parameter checking**: Automatically switches fields, titles, and button labels between "New Lighting Solution" and "Edit Product Details".
* **Data Preloading**: Clicking edit on a catalog row pre-fills name, description, and price values automatically.
* **Left Column Bento Card**: General Information input fields for product name and features description (with character validation).
* **Right Column Bento Cards**:
  * **Product Visuals**: Dashed drag-and-drop zone and image thumbnails row.
  * **Pricing**: Currency prefix (`₹`) input field with validation.
* **Sticky Footer Actions**: Auto-save draft status timestamps, Cancel/Discard buttons, and Confirm & Save submissions.

---

## 2. What Is Next for Glaron Admin Panel

The following modules need to be implemented next in the admin panel flow:

### A. Direct Order Creation Screen (`+ New Order`)
* Triggered by the gold button in the sidebar footer.
* Form layout to:
  * Select dealer from a dropdown search list.
  * Add multiple products with quantity selectors.
  * Calculate total order pricing and tax summaries.
  * Save direct invoices.

### B. Dealer Management Catalog (`Dealers` Tab)
* A catalog listing registered dealers.
* Stats cards showing total active dealers, average monthly orders, and credit limits.
* Table showing dealer business name, location, rating, contact email, and active status.
* Forms to register a new dealer or update credit parameters.

### C. Orders Management Dashboard (`Orders` Tab)
* Stats card for pending, processing, and completed order counts.
* Interactive table to list incoming dealer orders, statuses (Pending, Approved, Shipped, Delivered), and payment status.
* Action buttons to update order status or generate invoice PDFs.

### D. Live Firebase Data Synchronization
* Replace the current mock catalogs and stats with live database collections:
  * `products`: Storing product IDs, names, categories, prices, stock levels, and description.
  * `dealers`: Registered dealer details.
  * `orders`: History of direct and online orders.
* Integrate Firebase Auth state guards to block unauthorized page route access.
