# Glaron India Admin Panel Status & Roadmap

This directory serves as the tracking and status module for the Glaron India Admin Panel.

---

## 1. What We Have Done So Far

### Base Configurations
* **Ionic Angular Standalone Components**: Fully bootstrapped.
* **Google Font 'Outfit'**: Configured globally.
* **Firebase SDK integration**: Set up in `environments.ts` and `main.ts`.
* **Global Styles Refactoring**: Shared sidebar and top navigation styles moved to `src/global.scss`.

### Admin Login Screen
* Atmospheric radial lighting effects (gold glow blur backgrounds).
* Login validation controls.
* Credentials:
  * **Email**: `admin@glaronindia.com`
  * **Password**: `123456789`

### Product Management Catalog (Dashboard)
* **Left Sidebar**: Brand title and active menu highlights.
* **Top Navigation Bar**: Active links, search input, notification, and profile avatar.
* **Bento Stats Grid**: Total SKU, Active Dealers, Pending Orders, and Monthly Revenue.
* **Inventory Overview Table**: Dynamic keyword search filter, category badges, stock status indicators, and custom shaded row layouts.

### Add / Edit Product Form
* **Form Validation**: Reactive forms for Product Name, Description, and Price.
* **Preloading Mode**: Checks parameters to preload existing details when clicking "Edit".
* **Visuals upload**: Dashed drag-and-drop file upload zone and image thumbnails row.
* **Sticky Footer Actions**: Auto-saved timestamp info and cancel/save buttons.

---

## 2. What Is Next for Glaron Admin Panel

* **A. Direct Order Creation Screen (`+ New Order`)**: Checkout form, dealer dropdown, and items list.
* **B. Dealer Management Catalog (`Dealers` Tab)**: Listing active Glaron dealers and credit profiles.
* **C. Orders Management Dashboard (`Orders` Tab)**: View status of incoming dealer orders.
* **D. Live Firebase Firestore Database Synchronization**: Connecting forms and tables to live collections.
