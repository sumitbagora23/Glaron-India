import { Component, OnInit, OnDestroy, HostListener, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent } from '@ionic/angular/standalone';
import { Router, ActivatedRoute, NavigationEnd } from '@angular/router';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { ProductService, Product, ProductVariant } from '../admin/product.service';
import { SpecDetail, SpecTab, SpecTabState, specDetails, orderableLightColours, lightColourCatalogPrice, lightColourSwatch, splitLightColourLabel } from '../product-spec-tabs';
import { DealerService, Dealer } from '../admin/dealer.service';
import { INDIA_STATES_CITIES } from '../dealer-apply/india-locations';
import { OrderService, Order } from '../admin/order.service';
import { CategoryService, Category } from '../admin/category.service';
import { SettingsService } from '../admin/settings.service';
import { NotificationService } from '../admin/notification.service';
import { ActivityLogService } from '../admin/activity-log.service';
import { PostService, SharePost } from '../admin/post.service';
import { PostShareService } from '../post-share.service';
import { ShareBusinessService } from '../share-business.service';
import { CatalogShareService } from '../catalog-share.service';
import { DealerI18nService } from '../dealer-i18n.service';
import { APP_VERSION } from '../version';
import { orderRefLabel } from '../order-ref';
import { SwUpdate } from '@angular/service-worker';
import { DealerApprovalService } from '../dealer-approval.service';
import { DealerAuthService } from '../dealer-auth.service';
import { DealerPricePrefsService, DealerPriceMode } from '../dealer-price-prefs.service';
import { LightColourService } from '../admin/light-colour.service';

export interface OrderItem {
  product: Product;
  variant?: ProductVariant;
  /**
   * The light colour this line was ordered in, when the product is sold in
   * more than one. A dealer orders 10 of the 7W in Cool White and 5 of the
   * same 7W in Warm White, so the colour is part of what identifies the line
   * — see variantKey(). Absent on products with no colours picked.
   */
  lightColour?: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

// One editable line in the custom-price editor: a product without variants has a
// single row, a product with variants has one row per variant.
export interface CustomPriceRow {
  /** Same key shape the price lookups use: productId or `productId#index`. */
  key: string;
  /** Variant descriptor, or '' for a product's single base row. */
  label: string;
  /** The contracted Glaron price this row starts from. */
  basePrice: number;
}

export interface CustomPriceGroup {
  productId: string;
  name: string;
  image?: string;
  category?: string;
  rows: CustomPriceRow[];
}

@Component({
  selector: 'app-dealer-panel',
  templateUrl: './dealer-panel.page.html',
  styleUrls: ['./dealer-panel.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonContent
  ]
})
export class DealerPanelPage implements OnInit, OnDestroy {

  // A saved line keeps what was ordered as one string — "7W · 2ft · Cool
  // White". These two split the shade off its end so the box of colour sits
  // right before the shade, not in front of the wattage.
  private lightColourNames = inject(LightColourService);

  labelHead(label?: string): string {
    return splitLightColourLabel(label || '', this.lightColourNames.names).head;
  }

  labelColour(label?: string): string {
    return splitLightColourLabel(label || '', this.lightColourNames.names).colour;
  }


  // The box of colour drawn before a light colour name. Worked out from the
  // name itself, so a shade added today is painted without a code change.
  swatch(colour: string): string {
    return lightColourSwatch(colour);
  }

  selectedDealer: Dealer | null = null;
  private popStateHandler = () => this.handleDeviceBack();
  private routerSub?: Subscription;
  // True only while the catalog route is the active view. Gates the device-Back
  // handler so it never fires on other pages (e.g. checkout).
  private isViewActive = true;
  searchQuery = '';
  selectedCategory = 'All Categories';

  // The scroll container, so switching tabs can reset the view to the top
  // instead of keeping the previous tab's scroll position.
  @ViewChild(IonContent) private content?: IonContent;

  // Tab state: 'home' = browse by category, 'products' = full catalog,
  // 'orders' = this dealer's purchase orders (shown in-page, not a separate route)
  activeTab: 'home' | 'products' | 'orders' = 'home';

  // Orders tab state
  expandedOrderId: string | null = null;
  // When set (in Home tab), shows the products for that single category
  homeCategory: string | null = null;

  // Order Cart state
  orderItems: OrderItem[] = [];
  addedToastMessage = '';
  private toastTimer: any;

  // First-login welcome tour (one-time). Shown to a signed-in dealer the first
  // time they reach the catalog on this device; purely presentational.
  showWelcomeTour = false;
  tourStep = 0;
  readonly tourSlides = [
    { emoji: '🛍️', title: 'Browse the catalog', desc: 'Explore products by category and see your own contracted pricing on every item.' },
    { emoji: '⚡', title: 'Order in seconds', desc: 'Tap + to add items to your cart, then check out — your order reaches Glaron instantly.' },
    { emoji: '📦', title: 'Track every order', desc: 'Follow each order live from received to delivered, right here in the Orders tab.' },
  ];
  private readonly TOUR_KEY = 'glaron_dealer_tour_seen';

  // Variants modal state
  selectedVariantProduct: Product | null = null;

  // Description modal state
  selectedDescProduct: Product | null = null;

  // Image preview lightbox state
  selectedModalImage: string | null = null;
  selectedModalImageTitle = '';

  // Profile dropdown state
  showProfile = false;

  // Side menu (hamburger) state. Holds the profile entry that used to sit in
  // the top bar as an avatar.
  showSidebar = false;

  // One-time "approval accepted" welcome toast, shown when a freshly-approved
  // dealer first enters the panel after signing in.
  showApprovalToast = false;
  approvalToastMsg = '';

  // ---- Offer banner carousel state ----
  currentBanner = 0;
  private bannerTimer: any = null;
  private bannerTouchStartX = 0;

  // ---- Quantity numpad state ----
  // Opened by tapping the quantity number on a stepper, so a dealer can type an
  // exact quantity instead of tapping + repeatedly.
  showNumpad = false;
  numpadValue = '';
  numpadTitle = '';
  private numpadProduct: Product | null = null;
  private numpadVariant: ProductVariant | undefined;
  private numpadLightColour: string | undefined;

  // App version shown at the foot of the side menu.
  appVersion = APP_VERSION;

  // ---- Manual "Check for update" (side menu footer) ----
  // Set true once the service worker has finished downloading a newer build in
  // the background, so the button can activate it immediately on the next tap.
  private updateReady = false;
  // True while a check/download is in progress (disables the button, shows a
  // spinner label).
  updateChecking = false;
  // Result message shown under the button: "No update available", an error, etc.
  updateMessage = '';

  // ---- Language (English / Hindi) ----
  // The selected language and dynamic-data translation live in the shared
  // DealerI18nService (injected below) so the choice is consistent across the
  // catalog and checkout pages. `lang`/`setLang` here just delegate to it.
  get lang(): 'en' | 'hi' {
    return this.i18n.lang;
  }

  // Every static UI string in the dealer panel, keyed by a short semantic name.
  // Dynamic data (product names, the dealer's own details, admin-defined order
  // stages) is left as-is; only the app's own chrome is translated.
  private readonly translations: Record<string, { en: string; hi: string }> = {
    profile: { en: 'Profile', hi: 'प्रोफ़ाइल' },
    // The account header names no person and no role, so there is no name or
    // "Dealer Account" string here to translate — just this.
    myAccount: { en: 'My Account', hi: 'मेरा खाता' },
    phone: { en: 'Phone', hi: 'फ़ोन' },
    email: { en: 'Email', hi: 'ईमेल' },
    optional: { en: '(optional)', hi: '(वैकल्पिक)' },
    phoneLocked: { en: 'This is your sign-in number. Contact Glaron India to change it.', hi: 'यह आपका साइन-इन नंबर है। इसे बदलने के लिए ग्लैरोन इंडिया से संपर्क करें।' },
    address: { en: 'Address', hi: 'पता' },
    city: { en: 'City', hi: 'शहर' },
    state: { en: 'State', hi: 'राज्य' },
    pincode: { en: 'Pincode', hi: 'पिनकोड' },
    editProfile: { en: 'Edit Profile', hi: 'प्रोफ़ाइल संपादित करें' },
    signOut: { en: 'Sign Out', hi: 'साइन आउट' },
    version: { en: 'Version', hi: 'संस्करण' },
    checkForUpdate: { en: 'Check for update', hi: 'अपडेट जांचें' },
    checkingUpdate: { en: 'Checking…', hi: 'जांच हो रही है…' },
    updatingApp: { en: 'Updating…', hi: 'अपडेट हो रहा है…' },
    noUpdateAvailable: { en: 'You are on the latest version.', hi: 'आप नवीनतम संस्करण पर हैं।' },
    updateCheckFailed: { en: 'Could not check for updates. Try again.', hi: 'अपडेट जांच नहीं सकी। पुनः प्रयास करें।' },
    approvalWelcome: { en: 'Approval accepted — welcome aboard', hi: 'स्वीकृति स्वीकृत — आपका स्वागत है' },
    language: { en: 'Language', hi: 'भाषा' },
    name: { en: 'Name', hi: 'नाम' },
    yourName: { en: 'Your name', hi: 'आपका नाम' },
    phoneNumber: { en: 'Phone number', hi: 'फ़ोन नंबर' },
    addressPlaceholder: { en: 'Shop / building, street, area', hi: 'दुकान / भवन, सड़क, क्षेत्र' },
    selectState: { en: 'Select state', hi: 'राज्य चुनें' },
    searchState: { en: 'Search state...', hi: 'राज्य खोजें...' },
    noStateFound: { en: 'No state found', hi: 'कोई राज्य नहीं मिला' },
    selectCity: { en: 'Select city', hi: 'शहर चुनें' },
    selectStateFirst: { en: 'Select state first', hi: 'पहले राज्य चुनें' },
    searchCity: { en: 'Search city...', hi: 'शहर खोजें...' },
    noCityFound: { en: 'No city found', hi: 'कोई शहर नहीं मिला' },
    pincodePlaceholder: { en: '6-digit pincode', hi: '6-अंकीय पिनकोड' },
    loadingPincodes: { en: 'Loading pincodes for this city…', hi: 'इस शहर के लिए पिनकोड लोड हो रहे हैं…' },
    cancel: { en: 'Cancel', hi: 'रद्द करें' },
    saveChanges: { en: 'Save Changes', hi: 'परिवर्तन सहेजें' },
    call: { en: 'Call', hi: 'कॉल करें' },
    postReadyTitle: { en: 'Your new post is ready to share', hi: 'आपकी नई पोस्ट शेयर के लिए तैयार है' },
    // Both hints sit on a single clamped line in the home card, so they have to
    // stay short enough not to be cut off on a narrow phone.
    postReadyHint: { en: 'Tap to send it to your customers.', hi: 'ग्राहकों को भेजने के लिए टैप करें।' },
    postsHomeTitle: { en: 'Glaron posts to share', hi: 'शेयर करने के लिए ग्लैरोन पोस्ट' },
    postsHomeHint: { en: 'Tap to share with your customers.', hi: 'ग्राहकों के साथ शेयर करने के लिए टैप करें।' },
    posts: { en: 'Posts', hi: 'पोस्ट' },
    postsMenuSub: { en: 'Share Glaron posts', hi: 'ग्लैरोन पोस्ट शेयर करें' },
    noPosts: { en: 'No posts yet. New posts from Glaron India will appear here.', hi: 'अभी कोई पोस्ट नहीं। ग्लैरोन इंडिया की नई पोस्ट यहाँ दिखेंगी।' },
    // Share Catalogue — the public link handed to customers.
    shareCatalogue: { en: 'Share Catalogue', hi: 'कैटलॉग शेयर करें' },
    shareCatalogueSub: { en: 'Send your catalogue link', hi: 'अपना कैटलॉग लिंक भेजें' },
    catalogueLinkCopied: { en: 'Catalogue link copied', hi: 'कैटलॉग लिंक कॉपी हो गया' },
    catalogueShareFailed: { en: 'Could not share the link. Please try again.', hi: 'लिंक शेयर नहीं हो सका। पुनः प्रयास करें।' },
    share: { en: 'Share', hi: 'शेयर करें' },
    preparing: { en: 'Preparing…', hi: 'तैयार हो रहा है…' },
    newLabel: { en: 'New', hi: 'नया' },
    postSaved: { en: 'Post saved to your device', hi: 'पोस्ट आपके डिवाइस पर सहेजी गई' },
    postShareFailed: { en: 'Could not share this post. Please try again.', hi: 'यह पोस्ट शेयर नहीं हो सकी। पुनः प्रयास करें।' },
    // Business-details sheet, opened by tapping a post: the three lines printed
    // in the black footer strip under the artwork.
    businessTitle: { en: 'Your business details', hi: 'आपकी दुकान की जानकारी' },
    businessHint: { en: 'Printed in the footer under every post you share.', hi: 'आपकी हर शेयर की गई पोस्ट के नीचे फुटर में छपेगी।' },
    businessAdd: { en: 'Add', hi: 'जोड़ें' },
    businessEdit: { en: 'Edit', hi: 'बदलें' },
    businessNotSet: { en: 'Not added yet. Tap to add your shop name, mobile and email.', hi: 'अभी नहीं जोड़ी। दुकान का नाम, मोबाइल और ईमेल जोड़ने के लिए टैप करें।' },
    businessSaved: { en: 'Business details saved', hi: 'दुकान की जानकारी सहेजी गई' },
    businessShop: { en: 'Shop name', hi: 'दुकान का नाम' },
    businessShopPlaceholder: { en: 'e.g. Sharma Lights', hi: 'जैसे शर्मा लाइट्स' },
    businessMobile: { en: 'Mobile number', hi: 'मोबाइल नंबर' },
    businessMobilePlaceholder: { en: '98765 43210', hi: '98765 43210' },
    businessEmailPlaceholder: { en: 'shop@example.com', hi: 'shop@example.com' },
    businessShopRequired: { en: 'Please enter your shop name.', hi: 'कृपया अपनी दुकान का नाम दर्ज करें।' },
    businessMobileRequired: { en: 'Please enter a valid 10-digit mobile number.', hi: 'कृपया मान्य 10 अंकों का मोबाइल नंबर दर्ज करें।' },
    businessShareNow: { en: 'Share post', hi: 'पोस्ट शेयर करें' },
    postTapToShare: { en: 'Tap the post to share it', hi: 'शेयर करने के लिए पोस्ट पर टैप करें' },
    shopByCategory: { en: 'Shop by Category', hi: 'श्रेणी के अनुसार खरीदें' },
    selectCategoryHint: { en: 'Select a category to view its products.', hi: 'उत्पाद देखने के लिए एक श्रेणी चुनें।' },
    noCategories: { en: 'No categories yet. Please add categories in the admin panel.', hi: 'अभी तक कोई श्रेणी नहीं। कृपया एडमिन पैनल में श्रेणियाँ जोड़ें।' },
    categories: { en: 'Categories', hi: 'श्रेणियाँ' },
    allCategories: { en: 'All', hi: 'सभी' },
    allProducts: { en: 'All Products', hi: 'सभी उत्पाद' },
    pricingSubhead: { en: 'Showing your specific contracted pricing.', hi: 'आपकी विशिष्ट अनुबंधित कीमतें दिखा रहा है।' },
    yourPricePerVariant: { en: 'YOUR PRICE PER VARIANT', hi: 'प्रति वैरिएंट आपकी कीमत' },
    yourPrice: { en: 'YOUR PRICE', hi: 'आपकी कीमत' },
    myOrders: { en: 'My Orders', hi: 'मेरे ऑर्डर' },
    ordersSubhead: { en: 'Track the status of your purchase orders.', hi: 'अपने खरीद ऑर्डर की स्थिति ट्रैक करें।' },
    noOrdersFound: { en: 'No Orders Found', hi: 'कोई ऑर्डर नहीं मिला' },
    noOrdersDesc: { en: "You haven't placed any purchase orders yet.", hi: 'आपने अभी तक कोई खरीद ऑर्डर नहीं दिया है।' },
    browseCatalog: { en: 'Browse Product Catalog', hi: 'उत्पाद कैटलॉग ब्राउज़ करें' },
    orderItems: { en: 'Order Items', hi: 'ऑर्डर आइटम' },
    qty: { en: 'Qty:', hi: 'मात्रा:' },
    noItemDetails: { en: 'No item details available for this order.', hi: 'इस ऑर्डर के लिए कोई आइटम विवरण उपलब्ध नहीं है।' },
    locationHub: { en: 'Location / Hub:', hi: 'स्थान / हब:' },
    totalValue: { en: 'Total Value', hi: 'कुल मूल्य' },
    menu: { en: 'Menu', hi: 'मेन्यू' },
    home: { en: 'Home', hi: 'होम' },
    products: { en: 'Products', hi: 'उत्पाद' },
    orders: { en: 'Orders', hi: 'ऑर्डर' },
    cart: { en: 'Cart', hi: 'कार्ट' },
    variantsPrices: { en: 'Variants & Prices', hi: 'वैरिएंट और कीमतें' },
    quantity: { en: 'Quantity', hi: 'मात्रा' },
    done: { en: 'Done', hi: 'हो गया' },
    addToCart: { en: '+ Add to Cart', hi: '+ कार्ट में जोड़ें' },
    dim: { en: 'Dim:', hi: 'आयाम:' },
    cut: { en: 'Cut:', hi: 'कटआउट:' },
    color: { en: 'Color:', hi: 'रंग:' },
    unableUpdate: { en: 'Unable to update this account.', hi: 'इस खाते को अपडेट करने में असमर्थ।' },
    nameRequired: { en: 'Name is required.', hi: 'नाम आवश्यक है।' },
    invalidEmail: { en: 'Please enter a valid email address.', hi: 'कृपया एक मान्य ईमेल पता दर्ज करें।' },
    invalidPincode: { en: 'Pincode must be a 6-digit number.', hi: 'पिनकोड 6 अंकों की संख्या होनी चाहिए।' },
    whatsappInquiry: { en: 'Hi, I want to know more about this product.', hi: 'नमस्ते, मैं इस उत्पाद के बारे में और जानना चाहता हूँ।' },
    waProduct: { en: 'Product', hi: 'उत्पाद' },
    shareProduct: { en: 'Share product', hi: 'उत्पाद शेयर करें' },
    lightColour: { en: 'Light colour', hi: 'लाइट कलर' },
    availableOptions: { en: 'Available options', hi: 'उपलब्ध विकल्प' },
    nothingElseRecorded: { en: 'Nothing else recorded on this option.', hi: 'इस विकल्प पर और कुछ दर्ज नहीं है।' },
    shareVariants: { en: 'Variants', hi: 'वैरिएंट' },
    shareDownloaded: { en: 'Image downloaded · details copied', hi: 'इमेज डाउनलोड हुई · विवरण कॉपी हुआ' },
    shareCopied: { en: 'Details copied', hi: 'विवरण कॉपी हुआ' },
    shareFailed: { en: 'Could not share this product', hi: 'यह उत्पाद शेयर नहीं हो सका' },
    welcomeBack: { en: 'Welcome back', hi: 'वापसी पर स्वागत है' },
    searchProducts: { en: 'Search products…', hi: 'उत्पाद खोजें…' },
    addedToCart: { en: 'Added to cart', hi: 'कार्ट में जोड़ा गया' },
    // ---- Price settings (profile) ----
    priceSettings: { en: 'Price Settings', hi: 'मूल्य सेटिंग्स' },
    showPrices: { en: 'Show prices', hi: 'कीमतें दिखाएँ' },
    mrp: { en: 'MRP', hi: 'एमआरपी' },
    mrpPerVariant: { en: 'MRP PER VARIANT', hi: 'प्रति वैरिएंट एमआरपी' },
    myPrice: { en: 'My Price', hi: 'मेरी कीमत' },
    hidePrice: { en: 'Hide Price', hi: 'कीमत छिपाएँ' },
    customPrice: { en: 'Custom Price', hi: 'कस्टम मूल्य' },
    customPriceHint: { en: 'Set your own price for each product.', hi: 'हर उत्पाद के लिए अपनी कीमत तय करें।' },
    resetPrices: { en: 'Reset Prices', hi: 'कीमतें रीसेट करें' },
    resetPricesHint: { en: 'Restore the original Glaron prices.', hi: 'मूल ग्लैरोन कीमतें वापस लाएँ।' },
    customPriceIntro: { en: 'These prices show on your product cards only. Your own orders to Glaron still use your Glaron price.', hi: 'ये कीमतें केवल आपके उत्पाद कार्ड पर दिखती हैं। ग्लैरोन को दिए आपके ऑर्डर में आपकी ग्लैरोन कीमत ही लगेगी।' },
    applyDiscount: { en: 'Apply discount', hi: 'छूट लागू करें' },
    discountPlaceholder: { en: 'Discount %', hi: 'छूट %' },
    apply: { en: 'Apply', hi: 'लागू करें' },
    discountHint: { en: 'Fills every price below with the Glaron price minus this percentage.', hi: 'नीचे की हर कीमत को ग्लैरोन कीमत में से इतने प्रतिशत घटाकर भर देता है।' },
    invalidDiscount: { en: 'Enter a discount between 1 and 100.', hi: '1 से 100 के बीच छूट दर्ज करें।' },
    glaronPrice: { en: 'Glaron', hi: 'ग्लैरोन' },
    basePriceRow: { en: 'Base price', hi: 'आधार मूल्य' },
    noProductsToPrice: { en: 'No products to price yet.', hi: 'अभी मूल्य तय करने के लिए कोई उत्पाद नहीं।' },
    save: { en: 'Save', hi: 'सहेजें' },
    pricesSaved: { en: 'Your prices are saved', hi: 'आपकी कीमतें सहेज दी गईं' },
    pricesReset: { en: 'Glaron prices restored', hi: 'ग्लैरोन कीमतें वापस आ गईं' },
    resetConfirmTitle: { en: 'Reset prices?', hi: 'कीमतें रीसेट करें?' },
    resetConfirmText: { en: 'Every price you set and your discount will be cleared. Product cards go back to your Glaron prices.', hi: 'आपकी तय की गई हर कीमत और छूट हट जाएगी। उत्पाद कार्ड आपकी ग्लैरोन कीमतों पर लौट आएँगे।' },
    reset: { en: 'Reset', hi: 'रीसेट करें' }
  };

  // Translate a key to the currently selected language, falling back to English.
  t(key: string): string {
    const entry = this.translations[key];
    if (!entry) return key;
    return entry[this.lang] || entry.en;
  }

  setLang(lang: 'en' | 'hi') {
    this.i18n.setLang(lang);
  }

  // MEANING translation for descriptive text and order statuses.
  td(text: string | null | undefined): string {
    return this.i18n.td(text);
  }

  // NAME transliteration for proper names (product titles, category names):
  // keeps the pronunciation, only rewrites in Hindi script.
  tn(text: string | null | undefined): string {
    return this.i18n.tn(text);
  }

  // ---- Price settings (profile modules) ----
  // The custom-price editor page, its working draft, and the reset confirmation.
  // The draft is kept as strings so an empty field can mean "no custom price,
  // use the Glaron price" rather than 0.
  showCustomPrice = false;
  customPriceGroups: CustomPriceGroup[] = [];
  customPriceDraft: Record<string, string> = {};
  customPriceSearch = '';
  discountInput = '';
  customPriceError = '';
  showResetConfirm = false;

  // Edit-profile page state + form model
  showEditProfile = false;
  editForm = { name: '', phone: '', email: '', address: '', state: '', city: '', pincode: '' };
  editError = '';
  editSaving = false;

  // State / City / Pincode cascading dropdowns (same UX as registration)
  private readonly statesData = INDIA_STATES_CITIES;
  openDropdown: 'state' | 'city' | 'pincode' | null = null;
  stateSearch = '';
  citySearch = '';
  filteredStates: string[] = [];
  filteredCities: string[] = [];
  pincodeSuggestions: string[] = [];
  isLoadingPincodes = false;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private productService: ProductService,
    private dealerService: DealerService,
    private orderService: OrderService,
    private categoryService: CategoryService,
    private settingsService: SettingsService,
    private notificationService: NotificationService,
    private activity: ActivityLogService,
    private postService: PostService,
    private postShare: PostShareService,
    public shareBusiness: ShareBusinessService,
    public i18n: DealerI18nService,
    public pricePrefs: DealerPricePrefsService,
    private dealerAuth: DealerAuthService,
    private swUpdate: SwUpdate,
    private approval: DealerApprovalService,
    private catalogShare: CatalogShareService
  ) {}

  // The category list a product belongs to (new array field, falling back to the
  // legacy comma-joined string).
  private productCategories(p: Product): string[] {
    if (p.categories && p.categories.length) return p.categories.map(c => c.trim()).filter(Boolean);
    return (p.category || '').split(',').map(c => c.trim()).filter(Boolean);
  }

  trackByCategoryId(_index: number, category: Category): string {
    return category.id;
  }

  // Opens the tab requested via ?tab= (e.g. from the Orders page bottom nav, or
  // from a push notification the admin pointed at a particular screen), so the
  // bottom navigation works consistently across pages.
  private applyTabFromQuery() {
    const tab = this.route.snapshot.queryParamMap.get('tab');
    if (!tab) return;

    // Consume it: onCatalogEnter re-reads the query on every return to the
    // catalog, so leaving ?tab= in the address bar would keep yanking the
    // dealer back to the notification's tab long after they moved on.
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {},
      replaceUrl: true
    });

    // A notification that names a tab always lands on that tab, so any
    // full-page overlay opened from the side menu has to step aside first.
    this.showPosts = false;

    if (tab === 'products') {
      this.activeTab = 'products';
      this.homeCategory = null;
      this.showProfile = false;
    } else if (tab === 'orders') {
      this.activeTab = 'orders';
      this.homeCategory = null;
      this.showProfile = false;
    } else if (tab === 'home') {
      this.activeTab = 'home';
      this.homeCategory = null;
      this.showProfile = false;
    } else if (tab === 'profile') {
      // Profile is an overlay on the Home tab rather than a tab of its own.
      this.activeTab = 'home';
      this.homeCategory = null;
      this.showProfile = true;
    }
  }

  onImgError(event: any) {
    if (event?.target) event.target.style.display = 'none';
  }

  // trackBy keeps Angular from destroying/rebuilding every product card (and
  // re-downloading every image) each time the products array is replaced by a
  // Firestore sync or recomputed by a filter getter.
  trackByProductId(_index: number, product: Product): string {
    return product.id;
  }

  // Variant definitions are stable per product, so index identity is sufficient.
  trackByVariantIndex(index: number): number {
    return index;
  }

  // The product fields that ride along on an activity log entry. The product id
  // IS the SKU here (GLR-DELT-3), so it doubles as both.
  private productMeta(product: Product, variant?: ProductVariant) {
    const cat = this.productCategories(product)[0] || '';
    return {
      productId: product.id,
      productName: product.name,
      sku: product.id,
      ...(cat ? { category: cat } : {}),
      ...(variant ? { variant: this.getVariantLabel(variant) } : {})
    };
  }

  ngOnInit() {
    this.onCatalogEnter();

    // This account's own footer details. Details already saved on the device
    // are adopted here once: they were typed on this side of the app.
    this.shareBusiness.useAccount('dealer', this.getLoggedMobile() || '', true);

    // A freshly-approved dealer who just signed in gets a one-time welcome toast
    // here (the login page already showed the "approval accepted" banner).
    const approvedLabel = this.approval.consumeApproval();
    if (approvedLabel) {
      this.approvalToastMsg = `${this.t('approvalWelcome')}${approvedLabel ? ', ' + approvedLabel : ''}!`;
      this.showApprovalToast = true;
      setTimeout(() => { this.showApprovalToast = false; }, 6000);
    }

    // Begin auto-rotating the offer banners (no-op until 2+ banners exist).
    this.startBannerRotation();

    // Listen for admin broadcasts and raise OS notifications on this device.
    this.notificationService.startDealerListener();

    // Live feed of the posts the admin has published for dealers to share.
    this.postService.start();

    // Ionic keeps this page alive in the router-outlet stack and reuses the same
    // instance when one dealer signs out and another signs in. ngOnInit and the
    // Ionic ionViewWillEnter hook do NOT fire reliably on a reused instance, so
    // the identity caches would keep showing the previous dealer. Angular's
    // NavigationEnd, however, fires on every navigation regardless of reuse —
    // use it as the reliable signal to refresh identity each time the catalog
    // is (re-)entered. The subscription is created once and survives reuse.
    this.routerSub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(e => {
        const onCatalog = e.urlAfterRedirects.includes('/dealer/catalog');
        // Track whether the catalog is the active route. The device-Back handler
        // below must ONLY act while the catalog is showing — otherwise its global
        // popstate listener also fires on other pages (e.g. checkout) and wrongly
        // sends the user to the login screen for a moment on Back.
        this.isViewActive = onCatalog;
        if (onCatalog) {
          this.onCatalogEnter();
        }
      });

    // Trap the device/browser Back button so it returns to the Home tab from any
    // sub-view (a category's products, another tab, or the profile page) instead
    // of leaving the app. A guard history entry is pushed and re-pushed on back.
    window.history.pushState({ glaronPanel: true }, '');
    window.addEventListener('popstate', this.popStateHandler);

    // If the service worker downloads a newer build in the background, remember
    // it so the manual "Check for update" button can activate it right away.
    if (this.swUpdate.isEnabled) {
      this.swUpdate.versionUpdates
        .pipe(filter(e => e.type === 'VERSION_READY'))
        .subscribe(() => { this.updateReady = true; });
    }
  }

  ngOnDestroy() {
    window.removeEventListener('popstate', this.popStateHandler);
    this.routerSub?.unsubscribe();
    this.stopBannerRotation();
  }

  // Everything that must run each time the catalog view becomes active: drop the
  // previous dealer's cached identity so the signed-in mobile is re-read from
  // storage, then re-sync the cart and the requested tab.
  private onCatalogEnter() {
    this.refreshDealerIdentity();
    this.reconcileCartFromSession();
    this.applyTabFromQuery();
    this.maybeStartTour();
    // One entry per launch, written after the identity above is re-read so it
    // is attributed to whoever is actually signed in now.
    this.activity.logAppOpen();
  }

  // Handles a Back press: if we're anywhere other than the Home tab root, reset
  // to the Home tab and keep the user in the app; if already at Home, allow the
  // navigation to proceed (leave to the login screen).
  private handleDeviceBack() {
    // Only the catalog handles Back. On any other page (e.g. checkout) let the
    // browser's own Back proceed, so it returns to the catalog cleanly instead
    // of this handler bouncing the user through the login screen for a moment.
    if (!this.isViewActive) return;

    // An open side menu is the shallowest layer: Back just closes it.
    if (this.showSidebar) {
      this.showSidebar = false;
      window.history.pushState({ glaronPanel: true }, '');
      return;
    }

    // The reset confirmation is the topmost layer: Back just dismisses it.
    if (this.showResetConfirm) {
      this.showResetConfirm = false;
      window.history.pushState({ glaronPanel: true }, '');
      return;
    }

    // The details editor sits over the posts page: Back closes just it.
    if (this.showBusinessEditor) {
      this.closeBusinessEditor();
      window.history.pushState({ glaronPanel: true }, '');
      return;
    }

    // The edit-profile and custom-price pages sit on top of the profile page,
    // and the posts page on top of Home: Back closes the page it's on rather
    // than leaving whatever is underneath.
    if (this.showEditProfile || this.showCustomPrice || this.showPosts) {
      this.showEditProfile = false;
      this.showCustomPrice = false;
      this.showPosts = false;
      window.history.pushState({ glaronPanel: true }, '');
      return;
    }
    const atHomeRoot = this.activeTab === 'home' && !this.homeCategory && !this.showProfile;
    if (atHomeRoot) {
      this.router.navigate(['/dealer/login']);
      return;
    }
    this.showProfile = false;
    this.homeCategory = null;
    this.activeTab = 'home';
    // Re-arm the guard so the next Back press is handled the same way.
    window.history.pushState({ glaronPanel: true }, '');
  }

  // Ionic fires this when it does drive the view transition (e.g. returning from
  // checkout). It is not guaranteed on a reused instance, so NavigationEnd above
  // is the primary trigger; this just covers the cases where it does fire.
  ionViewWillEnter() {
    this.onCatalogEnter();
  }

  // Drops the cached signed-in mobile and resolved dealer so the next access to
  // getLoggedMobile()/currentDealer re-reads storage and re-resolves the dealer.
  private refreshDealerIdentity() {
    this._loggedMobile = null;
    this._cachedDealer = null;
    this._cachedDealersRef = null;
    // Load this dealer's own price settings (hidden prices / custom prices).
    // They're stored per mobile number, so a different dealer signing in on the
    // same device never inherits the previous one's prices.
    this.pricePrefs.use(this.getLoggedMobile());
  }

  // Rebuild orderItems from the single source of truth (session cart), so
  // items removed in the checkout page don't reappear on the catalog.
  private reconcileCartFromSession() {
    let stored: any[] = [];
    try {
      stored = JSON.parse(sessionStorage.getItem('glaron_checkout_cart') || '[]');
    } catch (e) {
      stored = [];
    }
    const rebuilt: OrderItem[] = [];
    for (const s of stored) {
      const product = this.productService.products.find(p => p.id === s.id);
      if (!product) continue;
      let variant: ProductVariant | undefined;
      // Prefer the plain descriptor. `variantInfo` may carry a " · Cool White"
      // suffix, and a session written by an older build has no variantLabel at
      // all — in that case variantInfo IS the plain descriptor.
      const label = s.variantLabel || s.variantInfo;
      if (label && product.variants) {
        variant = product.variants.find(v => this.getVariantLabel(v) === label);
      }
      rebuilt.push({
        product,
        variant,
        ...(s.lightColour ? { lightColour: s.lightColour } : {}),
        quantity: s.quantity,
        unitPrice: s.unitPrice,
        totalPrice: s.totalPrice
      });
    }
    this.orderItems = rebuilt;
  }

  get dealers(): Dealer[] {
    return this.dealerService.dealers;
  }

  get products(): Product[] {
    return this.productService.products;
  }

  // Category filter options come from the managed Categories (admin), not from
  // whatever strings happen to be on products.
  get categories(): string[] {
    const names = this.categoryService.categories.map(c => c.name);
    return ['All Categories', ...names];
  }

  // Category cards for the Home tab: every category the admin created, with its
  // image and name (no product-count text).
  get categoryCards(): Category[] {
    return this.categoryService.categories;
  }

  // ---- The fixed catalogue bar ----

  // Which category the list is narrowed to, however it was reached: the
  // Products tab's own filter, or a category opened from the Home grid.
  get activeCategory(): string {
    return this.activeTab === 'home' && this.homeCategory ? this.homeCategory : this.selectedCategory;
  }

  // The categories open in a sheet over the page, laid out as the Home
  // browser lays them out, so the bar itself stays one line.
  categorySheetOpen = false;

  openCategorySheet() {
    this.categorySheetOpen = true;
  }

  closeCategorySheet() {
    this.categorySheetOpen = false;
  }

  // Whether there is a category to clear. "All Categories" is not a filter,
  // it is the absence of one, so it shows no cross.
  get hasCategoryFilter(): boolean {
    return !this.isCategoryOn('All Categories');
  }

  // The filter's cross, the twin of the one in the search field.
  clearCategory() {
    this.pickCategory('All Categories');
  }

  isCategoryOn(name: string): boolean {
    return this.activeCategory.trim().toLowerCase() === name.trim().toLowerCase();
  }

  // Every category is one tap away from anywhere in the catalogue: picking
  // one lands on the single product list, narrowed to it. "All Categories"
  // hands back the whole range, which is where a dealer who already knows the
  // fitting starts.
  pickCategory(name: string) {
    this.categorySheetOpen = false;
    this.selectedCategory = name;
    this.homeCategory = null;
    this.activeTab = 'products';
    this.scrollTop();
  }

  // Products shown in the current grid (Home>category, or the Products tab)
  get displayedProducts(): Product[] {
    if (this.activeTab === 'home' && this.homeCategory) {
      const target = this.homeCategory.trim().toLowerCase();
      return this.searchIn(this.products.filter(p =>
        this.productCategories(p).some(c => c.toLowerCase() === target)
      ));
    }
    return this.filteredProducts;
  }

  // ---- Tab navigation ----

  // Slot (0-based) of the active tab in the bottom dock. Drives the sliding
  // gold capsule via a data attribute, so the indicator needs no JS measuring.
  get tabIndex(): number {
    return this.activeTab === 'products' ? 1 : this.activeTab === 'orders' ? 2 : 0;
  }

  // The brand wordmark, Call button and avatar are shown only on the Home
  // category browser. Opening a category, and the Products and Orders tabs, all
  // get the same plain back + title bar (matching the Orders page).
  get isHomeBar(): boolean {
    return this.activeTab === 'home' && !this.homeCategory;
  }

  // Title shown in that plain bar. A drilled-in category shows its own name.
  get topBarTitle(): string {
    if (this.activeTab === 'orders') return this.t('myOrders');
    if (this.activeTab === 'home' && this.homeCategory) return this.tn(this.homeCategory);
    return this.t('allProducts');
  }

  // Scrolls the catalog back to the top. Called on every tab/section change so a
  // tab always opens at its top rather than the previous tab's scroll position.
  private scrollTop() {
    this.content?.scrollToTop(0);
  }

  // The plain top bar's back button: from a drilled-in category go back up to
  // the category grid; from the Products/Orders tabs go to the Home tab.
  topBarBack() {
    if (this.activeTab === 'home' && this.homeCategory) {
      this.backToCategories();
    } else {
      this.showHome();
    }
  }

  showHome() {
    this.activeTab = 'home';
    this.homeCategory = null;
    this.scrollTop();
    this.activity.log('tab', 'Opened the Home tab', { tab: 'home' });
  }

  showProducts() {
    this.activeTab = 'products';
    this.scrollTop();
    this.activity.log('tab', 'Opened the Products tab', { tab: 'products' });
  }

  // Orders now live inside this page as a tab (no navigation to another route).
  showOrders() {
    this.activeTab = 'orders';
    this.homeCategory = null;
    this.scrollTop();
    this.activity.log('tab', 'Opened the Orders tab', { tab: 'orders' });
  }

  openCategory(cat: string) {
    this.homeCategory = cat;
    this.scrollTop();
    this.activity.log('category', `Browsed the ${cat} category`, { category: cat, tab: 'home' });
  }

  // ---- Orders tab data & helpers ----
  get myOrders(): Order[] {
    const allOrders = this.orderService.orders;
    const dealerName = (this.currentDealer?.name || '').toLowerCase().trim();
    const dealerMobile = (this.currentDealer?.phone || this.getLoggedMobile() || '').trim();

    // Signed in but no identity we can match on → show no orders rather than
    // exposing every dealer's orders.
    if (!dealerName && !dealerMobile) return [];

    const filtered = allOrders.filter(o => {
      const oDealer = (o.dealer || '').toLowerCase().trim();
      if (!oDealer) return false;
      // Guard against empty match terms (an empty string matches everything).
      return (!!dealerName && oDealer.includes(dealerName)) ||
             (!!dealerMobile && oDealer.includes(dealerMobile)) ||
             (!!dealerName && dealerName.includes(oDealer));
    });

    return [...filtered].sort((a, b) => {
      const ta = a.date ? new Date(a.date).getTime() : 0;
      const tb = b.date ? new Date(b.date).getTime() : 0;
      return tb - ta;
    });
  }

  toggleOrder(id: string) {
    const opening = this.expandedOrderId !== id;
    this.expandedOrderId = opening ? id : null;
    if (opening) this.activity.log('order-open', `Opened ${orderRefLabel(id)}`, { orderId: id, tab: 'orders' });
  }

  isExpanded(id: string): boolean {
    return this.expandedOrderId === id;
  }

  trackByOrderId(_index: number, order: Order): string {
    return order.id;
  }

  /** Short order label, e.g. `ORD - 417` — same number the admin console shows. */
  orderRef(id: string): string {
    return orderRefLabel(id);
  }

  // Safe CSS class for the stage badge, e.g. "Order Received" -> "stage-order-received",
  // "Paid" -> "stage-paid". Prevents spaces from splitting into invalid class names.
  stageBadgeClass(stage: string): string {
    const slug = (stage || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return 'stage-' + (slug || 'new');
  }

  getStageStep(stage: string): number {
    switch (stage) {
      case 'New':
      case 'Pending':
      case 'Order Received': return 1;
      case 'Confirmed':
      case 'Packed': return 2;
      case 'Dispatched': return 3;
      case 'Delivered': return 4;
      case 'Paid': return 5;
      default: return 1;
    }
  }

  backToCategories() {
    this.homeCategory = null;
    this.scrollTop();
  }

  get filteredProducts(): Product[] {
    let list = this.products;
    if (this.selectedCategory !== 'All Categories' && this.selectedCategory !== 'All') {
      list = list.filter(p => p.category.toLowerCase().includes(this.selectedCategory.toLowerCase()));
    }
    return this.searchIn(list);
  }

  // What the search field narrows a list to. Lifted out of the filter above so
  // a category opened from Home is searched exactly the same way — the bar over
  // it carries the same field.
  private searchIn(list: Product[]): Product[] {
    const q = this.searchQuery.toLowerCase().trim();
    if (!q) return list;
    return list.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q)
    );
  }

  // The logged-in mobile number is read from storage once and cached. It only
  // changes on sign-out, which navigates away from this page, so re-reading
  // storage on every price calculation is wasteful.
  private _loggedMobile: string | null = null;
  // currentDealer is resolved once per dealer-list version and cached. Pricing
  // getters call it for every product/variant on every change-detection tick;
  // without this cache each tick did dozens of localStorage/sessionStorage
  // reads plus a full dealer scan, which froze low-end mobile devices.
  private _cachedDealer: Dealer | null = null;
  private _cachedDealersRef: Dealer[] | null = null;

  private getLoggedMobile(): string {
    if (this._loggedMobile === null) {
      this._loggedMobile = this.dealerAuth.getSession();
    }
    return this._loggedMobile;
  }

  get currentDealer(): Dealer | null {
    const dealers = this.dealerService.dealers;
    // Recompute only when the dealer list reference changes (i.e. a Firestore
    // sync produced a new array), not on every change-detection tick.
    if (dealers !== this._cachedDealersRef) {
      this._cachedDealersRef = dealers;
      const loggedMobile = this.getLoggedMobile();
      // Resolve strictly by the signed-in mobile number. Never fall back to
      // another dealer (e.g. dealers[0]) — doing so showed the previous/other
      // dealer's name and custom pricing after signing out and logging in with a
      // different account.
      this._cachedDealer = loggedMobile
        ? (this.dealerService.findByMobile(loggedMobile) || null)
        : null;
    }
    return this._cachedDealer;
  }

  getDealerPrice(basePrice: number, productId?: string): number {
    const dealer = this.currentDealer;
    if (dealer && productId && dealer.customPrices && dealer.customPrices[productId] !== undefined) {
      return dealer.customPrices[productId];
    }
    const mult = (dealer && dealer.multiplier !== undefined) ? dealer.multiplier : 1.0;
    return Math.round(basePrice * mult);
  }

  // Per-variant dealer price: uses a custom rate keyed by productId#index if set,
  // otherwise falls back to the variant's catalog price times the dealer multiplier.
  getVariantDealerPrice(product: Product, variant: ProductVariant, index: number): number {
    const dealer = this.currentDealer;
    const key = `${product.id}#${index}`;
    if (dealer && dealer.customPrices && dealer.customPrices[key] !== undefined) {
      return dealer.customPrices[key];
    }
    const base = this.getVariantBasePrice(product, variant);
    const mult = (dealer && dealer.multiplier !== undefined) ? dealer.multiplier : 1.0;
    return Math.round(base * mult);
  }

  // ---- Prices shown on the catalog cards ----
  // The dealer picks one of three views in Profile > Price Settings: the catalog
  // MRP the admin set on the product, the price the admin set for them, or no
  // prices at all. Only the cards follow this — addToOrder/setCartQuantity
  // deliberately keep calling getDealerPrice, so an order still goes to Glaron
  // at the contracted price whatever the cards are showing.

  get priceMode(): DealerPriceMode {
    return this.pricePrefs.priceMode;
  }

  setPriceMode(mode: DealerPriceMode) {
    this.pricePrefs.setPriceMode(mode);
    this.activity.log('price-mode', 'Changed how prices are shown', { detail: mode });
  }

  get showPrices(): boolean {
    return this.pricePrefs.showPrices;
  }

  // Heading above the card prices, so it's never ambiguous which one is on show.
  get cardPriceLabel(): string {
    return this.priceMode === 'mrp' ? this.t('mrp') : this.t('yourPrice');
  }

  get cardPriceVariantLabel(): string {
    return this.priceMode === 'mrp' ? this.t('mrpPerVariant') : this.t('yourPricePerVariant');
  }

  getCardPrice(product: Product): number {
    if (this.priceMode === 'mrp') return product.price;
    return this.getDealerPrice(product.price, product.id);
  }

  getVariantCardPrice(product: Product, variant: ProductVariant, index: number): number {
    if (this.priceMode === 'mrp') return this.getVariantBasePrice(product, variant);
    return this.getVariantDealerPrice(product, variant, index);
  }

  // Unique signature for a variant using every distinguishing field, so
  // variants that share a model/wattage (but differ in type, dimension,
  // colour, etc.) are still treated as separate cart lines.
  private variantKey(variant?: ProductVariant, lightColour?: string): string {
    if (!variant && !lightColour) return '';
    return [
      variant?.model,
      variant?.wattage,
      variant?.type,
      variant?.dimension,
      variant?.cutout,
      variant?.colorSize,
      variant?.bodyColour,
      variant?.packing,
      variant?.price,
      variant?.pricePerMtr,
      // The shade is part of the line's identity: the same 7W in Cool White
      // and in Warm White are two lines on the order, not one.
      lightColour || ''
    ].join('|');
  }

  private findCartIndex(product: Product, variant?: ProductVariant, lightColour?: string): number {
    const key = this.variantKey(variant, lightColour);
    return this.orderItems.findIndex(item =>
      item.product.id === product.id &&
      this.variantKey(item.variant, item.lightColour) === key
    );
  }

  getQty(productId: string): number {
    const item = this.orderItems.find(i => i.product.id === productId && !i.variant);
    return item ? item.quantity : 0;
  }

  getVariantQty(product: Product, variant?: ProductVariant, lightColour?: string): number {
    const idx = this.findCartIndex(product, variant, lightColour);
    return idx > -1 ? this.orderItems[idx].quantity : 0;
  }

  /**
   * Everything on order for one spec tab, across all its shades.
   *
   * The wattage tab shows this so a dealer can see at a glance that the 7W has
   * something in it without opening it and adding up the colours themselves.
   */
  specTabTotalQty(product: Product, variant: ProductVariant): number {
    const colours = this.productLightColours(product, variant);
    if (!colours.length) return this.getVariantQty(product, variant);
    return colours.reduce((sum, c) => sum + this.getVariantQty(product, variant, c), 0);
  }

  // Build a label from whatever descriptors the variant has:
  // wattage, type, dimension, colour and (per-)meter.
  // ---- Wattage / dimension tabs ----
  // The two specs a fitting is chosen by read as small tabs across the card.
  // Opening one shows the light colours this product is sold in, with the
  // price of that option against each colour. A product whose variants carry
  // no wattage and no dimension has no tabs — its price shows on its own.
  private specTabState = new SpecTabState();
  trackBySpecTab = this.specTabState.trackByKey;

  specTabs(product: Product): SpecTab[] {
    return this.specTabState.tabs(product);
  }

  openSpecTab(product: Product): SpecTab | null {
    return this.specTabState.openTab(product);
  }

  isSpecTabOpen(product: Product, tab: SpecTab): boolean {
    return this.specTabState.isOpen(product, tab);
  }

  selectSpecTab(tab: SpecTab) {
    this.specTabState.toggle(tab);
  }

  /** The sheet behind the ⓘ: the size, the cut-out, the packing, everything
   *  the tab itself no longer prints. */
  specRows(tab: SpecTab): SpecDetail[] {
    return specDetails(tab.variant);
  }

  isSpecSheetOpen(product: Product): boolean {
    return this.specTabState.isSheetOpen(product);
  }

  toggleSpecSheet(product: Product) {
    this.specTabState.toggleSheet(product);
  }

  // The light colours the admin picked, for this option or — with no option,
  // or one that carries none of its own — for the product.
  productLightColours(product: Product, variant?: ProductVariant): string[] {
    return orderableLightColours(product, variant);
  }

  // Under the open wattage tab every shade is listed with its own stepper, so
  // the quantity a dealer types is already against the colour they mean.
  trackByColour = (_: number, colour: string) => colour;

  // Only the name of the light is shown — no swatch, no colour temperature.

  /**
   * What an option costs in a given shade.
   *
   * A price set against a colour IS the price of that colour — it replaces the
   * option's price rather than adding to it. What the admin typed is a *catalog*
   * price though, so the dealer's own rate still has to come off it. Without that
   * a shade priced by hand quietly showed full MRP while every other shade of
   * the same product carried the discount.
   *
   * `base` is the option at the dealer's rate and `catalogBase` is the same option
   * at catalog price, so the ratio between them is exactly that rate — a blanket
   * discount, or a hand-typed line rate — and applying it to the colour keeps the
   * same discount whichever shade is picked. In the MRP view the two are equal,
   * the ratio is 1, and the colour shows its catalog price untouched.
   */
  colourPrice(base: number, product: Product, colour: string, catalogBase?: number, variant?: ProductVariant): number {
    // The option's own price for the shade wins over the product's.
    const own = lightColourCatalogPrice(product, colour, variant);
    if (!own || own <= 0) return base;
    if (!catalogBase || catalogBase <= 0 || !isFinite(base)) return own;
    return Math.round(own * (base / catalogBase));
  }

  getVariantLabel(variant: ProductVariant): string {
    const parts: string[] = [];
    const isBad = (v?: string) => !v || !v.trim() || /dimension/i.test(v);

    if (!isBad(variant.wattage)) parts.push(variant.wattage!.trim());
    if (variant.type && variant.type.trim()) parts.push(variant.type.trim());

    if (variant.dimension && variant.dimension.trim() && variant.dimension.trim() !== '-') {
      const d = variant.dimension.trim();
      parts.push(/mm/i.test(d) ? d : `${d} mm`);
    }

    const colour = variant.bodyColour || variant.colorSize;
    if (colour && colour.trim()) parts.push(colour.trim());

    if (variant.pricePerMtr) parts.push('per mtr');

    if (parts.length === 0) parts.push(variant.model || 'Variant');
    return parts.join(' · ');
  }

  // Effective base price for a variant, accounting for per-meter pricing
  getVariantBasePrice(product: Product, variant: ProductVariant): number {
    return variant.price || variant.pricePerMtr || product.price;
  }

  // Plus icon adds the product (base) directly to the cart
  incrementQty(product: Product) {
    this.addToOrder(product);
  }

  // Minus icon removes one unit of the base product from the cart
  decrementQty(product: Product) {
    this.removeOneFromCart(product);
  }

  // Plus icon on a variant row adds that variant directly to the cart
  incrementVariant(product: Product, variant?: ProductVariant, lightColour?: string) {
    this.addToOrder(product, variant, lightColour);
  }

  // Minus icon on a variant row removes one unit of that variant
  decrementVariant(product: Product, variant?: ProductVariant, lightColour?: string) {
    this.removeOneFromCart(product, variant, lightColour);
  }

  private removeOneFromCart(product: Product, variant?: ProductVariant, lightColour?: string) {
    const idx = this.findCartIndex(product, variant, lightColour);
    if (idx > -1) {
      const item = this.orderItems[idx];
      item.quantity -= 1;
      if (item.quantity <= 0) {
        this.orderItems.splice(idx, 1);
      } else {
        item.totalPrice = item.quantity * item.unitPrice;
      }
      this.saveCartSession();
    }
  }

  addToOrder(product: Product, variant?: ProductVariant, lightColour?: string) {
    const qty = 1;
    let unitPrice: number;
    // Kept alongside so a shade with its own price can be charged at the same
    // rate this line already carries, rather than at catalog.
    let catalogPrice: number;
    if (variant) {
      const index = product.variants ? product.variants.indexOf(variant) : -1;
      catalogPrice = this.getVariantBasePrice(product, variant);
      unitPrice = index >= 0
        ? this.getVariantDealerPrice(product, variant, index)
        : this.getDealerPrice(catalogPrice, product.id);
    } else {
      catalogPrice = product.price;
      unitPrice = this.getDealerPrice(product.price, product.id);
    }
    // A shade the admin priced higher costs more in every basket it lands in.
    if (lightColour) unitPrice = this.colourPrice(unitPrice, product, lightColour, catalogPrice, variant);

    const existingIndex = this.findCartIndex(product, variant, lightColour);

    if (existingIndex > -1) {
      this.orderItems[existingIndex].quantity += qty;
      this.orderItems[existingIndex].totalPrice = this.orderItems[existingIndex].quantity * unitPrice;
    } else {
      this.orderItems.push({
        product,
        variant,
        ...(lightColour ? { lightColour } : {}),
        quantity: qty,
        unitPrice,
        totalPrice: qty * unitPrice
      });
    }

    this.saveCartSession();
    this.flashAddedToast(product);

    const line = existingIndex > -1 ? this.orderItems[existingIndex] : this.orderItems[this.orderItems.length - 1];
    this.activity.log('cart-add', `Added ${product.name} to cart`, {
      ...this.productMeta(product, variant),
      qty: line?.quantity ?? qty,
      amount: line?.totalPrice ?? qty * unitPrice
    });
  }

  // Briefly show a confirmation toast when an item is added to the cart.
  private flashAddedToast(product: Product) {
    this.flashToast(`${this.tn(product.name) || product.name} · ${this.t('addedToCart')}`);
  }

  // Shared confirmation toast (cart adds, saved prices, reset prices).
  private flashToast(message: string) {
    this.addedToastMessage = message;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.addedToastMessage = ''; }, 1800);
  }

  clearSearch() {
    this.searchQuery = '';
    clearTimeout(this.searchLogTimer);
  }

  // Search is logged once the dealer stops typing, so "panel" arrives as one
  // entry rather than five. Very short fragments are skipped — they are mid-word
  // keystrokes, not a search anyone meant to run.
  private searchLogTimer: any;
  onSearchChange(value: string) {
    clearTimeout(this.searchLogTimer);
    const term = (value || '').trim();
    if (term.length < 3) return;
    this.searchLogTimer = setTimeout(() => {
      this.activity.log('search', `Searched for "${term}"`, { detail: term, tab: this.activeTab });
    }, 1200);
  }

  // ---- First-login welcome tour (one-time) ----
  private maybeStartTour() {
    let seen = false;
    try { seen = localStorage.getItem(this.TOUR_KEY) === '1'; } catch (e) {}
    if (!seen) { this.tourStep = 0; this.showWelcomeTour = true; }
  }
  nextTour() {
    if (this.tourStep < this.tourSlides.length - 1) { this.tourStep++; return; }
    this.finishTour();
  }
  skipTour() { this.finishTour(); }
  private finishTour() {
    this.showWelcomeTour = false;
    try { localStorage.setItem(this.TOUR_KEY, '1'); } catch (e) {}
  }

  /** Variant descriptor with the shade appended, e.g. "7W · 100 mm · Cool White". */
  private variantInfoWithColour(item: OrderItem): string {
    const label = item.variant ? this.getVariantLabel(item.variant) : '';
    if (!item.lightColour) return label;
    return label ? `${label} · ${item.lightColour}` : item.lightColour;
  }

  private saveCartSession() {
    const checkoutItems = this.orderItems.map(item => ({
      id: item.product.id,
      name: item.product.name,
      sku: 'SKU: ' + (item.variant?.model || item.product.id),
      image: item.product.image,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      mrp: item.product.price,
      totalPrice: item.totalPrice,
      // `variantInfo` is what the checkout page and the saved order line show,
      // so the shade is folded into it — that is how "Cool White" reaches the
      // order, the PDF and the admin's order view without those having to know
      // about colours at all. `variantLabel` keeps the plain descriptor so
      // reconcileCartFromSession can still match the variant back to the
      // product; matching on variantInfo would fail once a colour is appended.
      variantInfo: this.variantInfoWithColour(item),
      variantLabel: item.variant ? this.getVariantLabel(item.variant) : '',
      lightColour: item.lightColour || ''
    }));

    try {
      sessionStorage.setItem('glaron_checkout_cart', JSON.stringify(checkoutItems));
    } catch (e) {}
  }

  // Set an exact cart quantity for a product (or a specific variant). A qty of
  // 0 removes the line. Used by the quantity numpad.
  private setCartQuantity(product: Product, variant: ProductVariant | undefined, quantity: number, lightColour?: string) {
    const qty = Math.max(0, Math.floor(quantity || 0));
    const idx = this.findCartIndex(product, variant, lightColour);

    if (qty <= 0) {
      if (idx > -1) this.orderItems.splice(idx, 1);
      this.saveCartSession();
      return;
    }

    let unitPrice: number;
    // Kept alongside so a shade with its own price can be charged at the same
    // rate this line already carries, rather than at catalog.
    let catalogPrice: number;
    if (variant) {
      const index = product.variants ? product.variants.indexOf(variant) : -1;
      catalogPrice = this.getVariantBasePrice(product, variant);
      unitPrice = index >= 0
        ? this.getVariantDealerPrice(product, variant, index)
        : this.getDealerPrice(catalogPrice, product.id);
    } else {
      catalogPrice = product.price;
      unitPrice = this.getDealerPrice(product.price, product.id);
    }
    if (lightColour) unitPrice = this.colourPrice(unitPrice, product, lightColour, catalogPrice, variant);

    if (idx > -1) {
      this.orderItems[idx].quantity = qty;
      this.orderItems[idx].unitPrice = unitPrice;
      this.orderItems[idx].totalPrice = qty * unitPrice;
    } else {
      this.orderItems.push({
        product,
        variant,
        ...(lightColour ? { lightColour } : {}),
        quantity: qty,
        unitPrice,
        totalPrice: qty * unitPrice
      });
    }
    this.saveCartSession();
  }

  // ---- Quantity numpad ----
  openNumpad(product: Product, variant?: ProductVariant, lightColour?: string) {
    this.numpadProduct = product;
    this.numpadVariant = variant;
    this.numpadLightColour = lightColour;
    // A product with no options is still counted shade by shade, so the colour
    // alone is enough to make this a line of its own rather than the base one.
    const current = (variant || lightColour)
      ? this.getVariantQty(product, variant, lightColour)
      : this.getQty(product.id);
    this.numpadValue = current > 0 ? String(current) : '';
    const name = this.tn(product.name);
    if (variant) {
      const label = this.getVariantLabel(variant);
      // Skip the variant suffix when it's just the product name repeated
      // (variants with no distinguishing specs fall back to the model/name).
      this.numpadTitle = (label && label !== product.name && label !== name) ? `${name} · ${label}` : name;
    } else {
      this.numpadTitle = name;
    }
    // Which shade is being counted matters as much as which wattage.
    if (lightColour) this.numpadTitle = `${this.numpadTitle} · ${this.tn(lightColour)}`;
    this.showNumpad = true;
  }

  // The number currently shown on the numpad display.
  get numpadDisplay(): string {
    return this.numpadValue || '0';
  }

  numpadPress(digit: string) {
    if (this.numpadValue.length >= 4) return; // cap at 9999
    if (this.numpadValue === '0') this.numpadValue = '';
    this.numpadValue += digit;
  }

  numpadBackspace() {
    this.numpadValue = this.numpadValue.slice(0, -1);
  }

  numpadClear() {
    this.numpadValue = '';
  }

  numpadConfirm() {
    const qty = parseInt(this.numpadValue || '0', 10) || 0;
    if (this.numpadProduct) {
      const product = this.numpadProduct;
      const variant = this.numpadVariant;
      this.setCartQuantity(product, variant, qty, this.numpadLightColour);
      this.activity.log(
        qty > 0 ? 'cart-qty' : 'cart-remove',
        qty > 0
          ? `Set ${product.name} quantity to ${qty}`
          : `Removed ${product.name} from cart`,
        { ...this.productMeta(product, variant), qty }
      );
    }
    this.closeNumpad();
  }

  closeNumpad() {
    this.showNumpad = false;
    this.numpadProduct = null;
    this.numpadVariant = undefined;
    this.numpadLightColour = undefined;
    this.numpadValue = '';
    this.numpadTitle = '';
  }

  goToOrders() {
    this.showOrders();
  }

  goToCheckout() {
    this.saveCartSession();
    this.activity.log('checkout-open', 'Opened checkout', {
      qty: this.totalItemsCount,
      amount: this.orderItems.reduce((sum, i) => sum + i.totalPrice, 0),
      detail: `${this.orderItems.length} line${this.orderItems.length === 1 ? '' : 's'} in cart`
    });
    this.router.navigate(['/dealer/checkout']);
  }

  get totalItemsCount(): number {
    return this.orderItems.reduce((sum, i) => sum + i.quantity, 0);
  }

  openVariantsModal(product: Product) {
    if (product.variants && product.variants.length > 0) {
      this.selectedVariantProduct = product;
      this.activity.log('product-variants', `Viewed ${product.name} variants`, {
        ...this.productMeta(product),
        detail: `${product.variants.length} variants`
      });
    }
  }

  closeVariantsModal() {
    this.selectedVariantProduct = null;
  }

  openDescModal(product: Product) {
    this.selectedDescProduct = product;
    this.activity.log('product-detail', `Viewed ${product.name} details`, this.productMeta(product));
  }

  closeDescModal() {
    this.selectedDescProduct = null;
  }

  openImageModal(imgUrl: string | undefined, name: string) {
    if (imgUrl) {
      this.selectedModalImage = imgUrl;
      this.selectedModalImageTitle = name;
      this.activity.log('product-image', `Zoomed the ${name} image`, { productName: name });
    }
  }

  closeImageModal() {
    this.selectedModalImage = null;
    this.selectedModalImageTitle = '';
  }

  goToLogin() {
    this.router.navigate(['/dealer/login']);
  }

  toggleProfile() {
    this.showProfile = !this.showProfile;
    if (this.showProfile) this.activity.log('profile-open', 'Opened their profile');
  }

  closeProfile() {
    this.showProfile = false;
  }

  // ---- Side menu (hamburger) ----
  openSidebar() {
    this.showSidebar = true;
  }

  closeSidebar() {
    this.showSidebar = false;
  }

  // Profile moved out of the top bar and into the menu.
  openProfileFromMenu() {
    this.showSidebar = false;
    this.showProfile = true;
  }

  goFromMenu(tab: 'home' | 'products' | 'orders') {
    this.showSidebar = false;
    if (tab === 'home') this.showHome();
    else if (tab === 'products') this.showProducts();
    else this.showOrders();
  }

  // Plain WhatsApp chat with the shop — no prefilled message. The product cards
  // keep their own openWhatsApp(), which does prefill the enquiry text.
  openWhatsAppChat() {
    const digits = this.whatsappDigits();
    if (!digits) return;
    window.open(`https://wa.me/${digits}`, '_blank');
  }

  dismissApprovalToast() {
    this.showApprovalToast = false;
  }

  // ---- Manual update check (side menu footer link) ----
  // Ask the service worker whether a newer build has been deployed. If one is
  // found (or was already downloaded in the background), activate it and reload
  // so the installed PWA runs the new version. Otherwise tell the user they are
  // already up to date.
  async checkForAppUpdate() {
    if (this.updateChecking) return;
    this.updateMessage = '';

    // No service worker (e.g. plain browser tab in dev) → nothing to update.
    if (!this.swUpdate.isEnabled) {
      this.updateMessage = this.t('noUpdateAvailable');
      return;
    }

    this.updateChecking = true;
    try {
      const found = await this.swUpdate.checkForUpdate();
      if (found || this.updateReady) {
        // A new build is ready — activate it and reload into it.
        await this.swUpdate.activateUpdate();
        document.location.reload();
        return;
      }
      this.updateMessage = this.t('noUpdateAvailable');
    } catch (e) {
      this.updateMessage = this.t('updateCheckFailed');
    } finally {
      this.updateChecking = false;
    }
  }

  // ---- The custom-price editor ----
  // No longer reachable from the profile (the price view is a straight choice
  // between MRP, the dealer's own rate and hidden), but kept intact.

  // Build one editable row per product (or per variant) starting from the price
  // this dealer actually pays, then seed the draft with whatever they've already
  // set. A blank field means "no custom price" — the card falls back to Glaron.
  openCustomPrice() {
    this.customPriceGroups = this.products.map(product => {
      const rows: CustomPriceRow[] = (product.variants && product.variants.length)
        ? product.variants.map((variant, index) => {
            // A variant with no distinguishing specs falls back to the model —
            // usually the product name, which would just repeat the card title.
            // Blank it so the row reads "Base price" instead.
            const label = this.getVariantLabel(variant);
            return {
              key: `${product.id}#${index}`,
              label: label === product.name ? '' : label,
              basePrice: this.getVariantDealerPrice(product, variant, index)
            };
          })
        : [{
            key: product.id,
            label: '',
            basePrice: this.getDealerPrice(product.price, product.id)
          }];
      return {
        productId: product.id,
        name: product.name,
        image: product.image,
        category: product.category,
        rows
      };
    });

    this.customPriceDraft = {};
    for (const group of this.customPriceGroups) {
      for (const row of group.rows) {
        const own = this.pricePrefs.override(row.key);
        this.customPriceDraft[row.key] = own !== null ? String(own) : '';
      }
    }

    this.discountInput = this.pricePrefs.discountPercent ? String(this.pricePrefs.discountPercent) : '';
    this.customPriceSearch = '';
    this.customPriceError = '';
    this.showCustomPrice = true;
    // Arm the Back guard so device back closes the editor first.
    window.history.pushState({ glaronPanel: true }, '');
  }

  closeCustomPrice() {
    this.showCustomPrice = false;
    this.customPriceError = '';
  }

  // Groups matching the editor's own search box. Filtering by product name keeps
  // a long catalog usable; every variant of a matched product stays visible.
  get filteredCustomPriceGroups(): CustomPriceGroup[] {
    const q = this.customPriceSearch.trim().toLowerCase();
    if (!q) return this.customPriceGroups;
    return this.customPriceGroups.filter(g =>
      g.name.toLowerCase().includes(q) ||
      (g.category || '').toLowerCase().includes(q) ||
      g.productId.toLowerCase().includes(q)
    );
  }

  trackByCustomPriceGroup(_index: number, group: CustomPriceGroup): string {
    return group.productId;
  }

  trackByCustomPriceRow(_index: number, row: CustomPriceRow): string {
    return row.key;
  }

  // Fill every field with the Glaron price minus the typed percentage. It writes
  // real numbers into the draft rather than staying a live multiplier, so the
  // dealer can see each price and then hand-tune the ones they want.
  applyDiscountToAll() {
    const pct = parseFloat(this.discountInput);
    if (!isFinite(pct) || pct <= 0 || pct > 100) {
      this.customPriceError = this.t('invalidDiscount');
      return;
    }
    this.customPriceError = '';
    for (const group of this.customPriceGroups) {
      for (const row of group.rows) {
        this.customPriceDraft[row.key] = String(Math.max(0, Math.round(row.basePrice * (1 - pct / 100))));
      }
    }
  }

  saveCustomPrices() {
    const prices: Record<string, number> = {};
    for (const group of this.customPriceGroups) {
      for (const row of group.rows) {
        const raw = (this.customPriceDraft[row.key] || '').trim();
        if (!raw) continue;                       // left blank → keep the Glaron price
        const value = Math.round(parseFloat(raw));
        if (!isFinite(value) || value < 0) continue;
        prices[row.key] = value;
      }
    }
    const pct = parseFloat(this.discountInput);
    this.pricePrefs.saveOverrides(prices, isFinite(pct) ? pct : 0);
    this.showCustomPrice = false;
    this.customPriceError = '';
    this.flashToast(this.t('pricesSaved'));
    const count = Object.keys(prices).length;
    this.activity.log('price-custom', 'Saved their own selling prices', {
      qty: count,
      detail: `${count} price${count === 1 ? '' : 's'} set` + (isFinite(pct) && pct ? ` · ${pct}% discount` : '')
    });
  }

  // ---- Price settings module 3: reset back to the Glaron prices ----
  askResetPrices() {
    this.showResetConfirm = true;
  }

  cancelResetPrices() {
    this.showResetConfirm = false;
  }

  confirmResetPrices() {
    this.pricePrefs.reset();
    this.showResetConfirm = false;
    this.flashToast(this.t('pricesReset'));
    this.activity.log('price-reset', 'Reset prices back to Glaron rates');
  }

  // ---- Edit profile ----
  openEditProfile() {
    const d = this.currentDealer;
    this.editForm = {
      name: d?.name || '',
      phone: d?.phone || '',
      email: d?.email || '',
      address: d?.address || '',
      state: d?.state || '',
      city: d?.city || '',
      pincode: d?.pincode || ''
    };
    this.editError = '';
    this.openDropdown = null;
    this.filteredStates = this.statesData.map(s => s.state);
    this.filteredCities = this.getCitiesForSelectedState();
    this.pincodeSuggestions = [];
    // Preload pincode suggestions for the already-set city so the dropdown works
    // right away on first open.
    if (this.editForm.city) this.loadPincodesForCity(this.editForm.city);
    this.showEditProfile = true;
    // Arm the Back guard so device back closes the editor first.
    window.history.pushState({ glaronPanel: true }, '');
  }

  closeEditProfile() {
    this.showEditProfile = false;
    this.openDropdown = null;
  }

  saveProfile() {
    const dealer = this.currentDealer;
    if (!dealer || !dealer.id) {
      this.editError = this.t('unableUpdate');
      return;
    }
    const name = this.editForm.name.trim();
    const email = this.editForm.email.trim();
    const pincode = this.editForm.pincode.trim();
    if (!name) {
      this.editError = this.t('nameRequired');
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.editError = this.t('invalidEmail');
      return;
    }
    if (pincode && !/^[0-9]{6}$/.test(pincode)) {
      this.editError = this.t('invalidPincode');
      return;
    }
    this.editError = '';
    this.editSaving = true;

    // `phone` is deliberately omitted — it's the sign-in identity and is shown
    // read-only on the form, so a save must never change it.
    this.dealerService.updateDealerProfile(dealer.id, {
      name,
      email,
      address: this.editForm.address.trim(),
      state: this.editForm.state.trim(),
      city: this.editForm.city.trim(),
      pincode
    });

    // Force currentDealer to recompute against the freshly-updated list.
    this._cachedDealersRef = null;

    this.editSaving = false;
    this.showEditProfile = false;
    this.openDropdown = null;

    this.activity.log('profile-update', 'Updated their profile', {
      name,
      detail: [this.editForm.city.trim(), this.editForm.state.trim(), pincode].filter(Boolean).join(', ')
    });
  }

  // ---- State / City / Pincode dropdowns (edit profile) ----
  @HostListener('document:click')
  closeLocationDropdowns() {
    this.openDropdown = null;
  }

  stopClose(event: Event) {
    event.stopPropagation();
  }

  toggleDropdown(which: 'state' | 'city' | 'pincode', event?: Event) {
    event?.stopPropagation();
    if (which === 'city' && !this.editForm.state) return;
    this.openDropdown = this.openDropdown === which ? null : which;
    if (this.openDropdown === 'state') {
      this.stateSearch = '';
      this.filteredStates = this.statesData.map(s => s.state);
    } else if (this.openDropdown === 'city') {
      this.citySearch = '';
      this.filteredCities = this.getCitiesForSelectedState();
    }
  }

  onStateSearch(value: string) {
    this.stateSearch = value;
    const q = value.toLowerCase().trim();
    this.filteredStates = this.statesData.map(s => s.state).filter(s => s.toLowerCase().includes(q));
  }

  selectState(state: string) {
    this.editForm.state = state;
    this.editForm.city = '';
    this.editForm.pincode = '';
    this.pincodeSuggestions = [];
    this.filteredCities = this.getCitiesForSelectedState();
    this.openDropdown = null;
  }

  private getCitiesForSelectedState(): string[] {
    const match = this.statesData.find(s => s.state === this.editForm.state);
    return match ? match.cities : [];
  }

  onCitySearch(value: string) {
    this.citySearch = value;
    const q = value.toLowerCase().trim();
    this.filteredCities = this.getCitiesForSelectedState().filter(c => c.toLowerCase().includes(q));
  }

  selectCity(city: string) {
    this.editForm.city = city;
    this.editForm.pincode = '';
    this.openDropdown = null;
    this.loadPincodesForCity(city);
  }

  private async loadPincodesForCity(city: string) {
    this.pincodeSuggestions = [];
    if (!city) return;
    this.isLoadingPincodes = true;
    try {
      const res = await fetch(`https://api.postalpincode.in/postoffice/${encodeURIComponent(city)}`);
      const data = await res.json();
      const record = Array.isArray(data) ? data[0] : null;
      if (record && record.Status === 'Success' && Array.isArray(record.PostOffice)) {
        const codes: string[] = record.PostOffice
          .map((po: any) => String(po.Pincode || ''))
          .filter((p: string) => p.length > 0);
        this.pincodeSuggestions = Array.from(new Set<string>(codes)).sort();
      }
    } catch (e) {
      console.warn('Pincode lookup notice:', e);
    } finally {
      this.isLoadingPincodes = false;
    }
  }

  openPincodeDropdown(event?: Event) {
    event?.stopPropagation();
    if (!this.pincodeSuggestions.length) return;
    this.openDropdown = this.openDropdown === 'pincode' ? null : 'pincode';
  }

  selectPincode(pincode: string) {
    this.editForm.pincode = pincode;
    this.openDropdown = null;
  }

  // ---- Offer banner carousel (configured by admin in Settings) ----
  // ---- Shareable posts ----
  // Artwork the admin publishes for dealers to forward to their own customers.
  // Every dealer sees every post — unlike offer banners, these aren't targeted.
  //
  // The posts themselves live on their own page, reached from the side menu or
  // from a small permanent card on Home. Neither entry point shows artwork —
  // the pictures only appear on the posts page itself.

  // The posts page, opened from the side menu.
  showPosts = false;

  // Newest createdAt this device has already been shown. Keeping it means the
  // home nudge appears once per new post instead of sitting there for good.
  private readonly POSTS_SEEN_KEY = 'glaron_last_seen_post_ts';
  private postsSeenTs = this.readPostsSeenTs();

  private readPostsSeenTs(): number {
    try {
      return Number(localStorage.getItem(this.POSTS_SEEN_KEY)) || 0;
    } catch (e) {
      return 0;
    }
  }

  get sharePosts(): SharePost[] {
    return this.postService.posts;
  }

  get latestPost(): SharePost | null {
    return this.postService.latest;
  }

  // True while the newest post is one this device hasn't opened yet. The home
  // card is always there; this only decides whether it wears the "new" dot and
  // the livelier wording.
  get showPostNotice(): boolean {
    const latest = this.latestPost;
    return !!latest && (latest.createdAt || 0) > this.postsSeenTs;
  }

  private markPostsSeen() {
    const latest = this.latestPost;
    if (!latest) return;
    this.postsSeenTs = Math.max(this.postsSeenTs, latest.createdAt || 0);
    try {
      localStorage.setItem(this.POSTS_SEEN_KEY, String(this.postsSeenTs));
    } catch (e) {}
  }

  // A post published within the last three days still counts as new, so the
  // card carries a "New" pill without any per-device bookkeeping.
  isNewPost(post: SharePost): boolean {
    return Date.now() - (post.createdAt || 0) < 3 * 24 * 60 * 60 * 1000;
  }

  // ---- Your business details ----
  //
  // The shop name, mobile and email printed in the black footer strip under
  // every post this device shares. They live in their own card at the top of
  // the Posts page — filled in once, edited from the same card whenever they
  // change — and are kept on this device (see ShareBusinessService).

  showBusinessEditor = false;
  businessForm = { shop: '', mobile: '', email: '' };
  businessError = '';

  openBusinessEditor() {
    const saved = this.shareBusiness.business;
    const dealer = this.currentDealer;
    // Nothing saved yet? Start from what the account already knows.
    this.businessForm = {
      shop: saved.shop || dealer?.name || '',
      mobile: saved.mobile || dealer?.phone || this.getLoggedMobile() || '',
      email: saved.email || dealer?.email || ''
    };
    this.businessError = '';
    this.showBusinessEditor = true;
    // Arm the Back guard so device Back closes the editor rather than the page.
    window.history.pushState({ glaronPanel: true }, '');
  }

  closeBusinessEditor() {
    this.showBusinessEditor = false;
    this.businessError = '';
  }

  saveBusiness() {
    const shop = this.businessForm.shop.trim();
    const mobile = this.businessForm.mobile.trim();
    const email = this.businessForm.email.trim();

    if (!shop) {
      this.businessError = this.t('businessShopRequired');
      return;
    }
    // Spaces, +91 and dashes are all fine — it just has to hold a real number.
    if (mobile.replace(/\D/g, '').length < 10) {
      this.businessError = this.t('businessMobileRequired');
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.businessError = this.t('invalidEmail');
      return;
    }

    this.shareBusiness.save({ shop, mobile, email });
    this.closeBusinessEditor();
    this.flashToast(this.t('businessSaved'));
  }

  /** The number as the footer will print it — with its +91 in front. */
  printedMobile(raw: string): string {
    return ShareBusinessService.withDialCode(raw);
  }

  // Id of the post currently being composed, so only that card shows a spinner.
  sharingPostId: string | null = null;

  // Tapping a post shares it straight away, with the saved details printed
  // underneath. With nothing saved yet the editor opens instead, so no post
  // goes out bare by accident. Two taps in a row are ignored while the first
  // is still going.
  async sharePost(post: SharePost) {
    if (this.sharingPostId) return;
    if (!this.shareBusiness.hasBusiness) {
      this.openBusinessEditor();
      return;
    }

    this.sharingPostId = post.id;
    try {
      const outcome = await this.postShare.share(post);
      if (outcome === 'downloaded') this.flashToast(this.t('postSaved'));
      else if (outcome === 'failed') this.flashToast(this.t('postShareFailed'));
      this.activity.log('post-share', 'Shared a Glaron post', {
        detail: (post.caption || '').trim() || outcome
      });
    } finally {
      this.sharingPostId = null;
    }
  }

  // Reached from the side menu and from the Home card. Opening the page counts
  // as seeing every post, so the "new" dot clears.
  openPosts() {
    this.showSidebar = false;
    this.showPosts = true;
    this.markPostsSeen();
    // Arm the Back guard so device Back closes the page rather than the app.
    window.history.pushState({ glaronPanel: true }, '');
  }

  closePosts() {
    this.showPosts = false;
  }

  // Hands this account's own catalogue link to the device share sheet (or the
  // clipboard where there isn't one). The link opens the public catalogue: the
  // range only, with no prices and nothing orderable.
  async shareCatalogue() {
    this.showSidebar = false;
    const outcome = await this.catalogShare.share(this.getLoggedMobile());
    if (outcome === 'copied') this.flashToast(this.t('catalogueLinkCopied'));
    else if (outcome === 'failed') this.flashToast(this.t('catalogueShareFailed'));
  }

  // Banners only show when at least one is set AND this dealer's id is in the
  // admin-selected list. If no dealer is selected, nobody sees them.

  // Kept for backward compatibility (older templates/tests).
  get offerBannerImage(): string {
    return this.settingsService.offerBannerImage;
  }

  // All banners configured by the admin (migrated from any legacy single image).
  get offerBanners(): string[] {
    return this.settingsService.offerBanners;
  }

  get showOfferBanner(): boolean {
    if (!this.offerBanners.length) return false;
    const dealerId = this.currentDealer?.id;
    if (!dealerId) return false;
    return this.settingsService.offerDealerIds.includes(dealerId);
  }

  // The slide actually being shown. The admin can delete a banner while a dealer
  // is looking at the carousel, so the stored index is clamped to the list that
  // exists right now — otherwise the track would slide to an empty slot.
  get activeBannerIndex(): number {
    const count = this.offerBanners.length;
    if (!count) return 0;
    return Math.min(this.currentBanner, count - 1);
  }

  // CSS transform for the banner track. Each slide is 90% of the container (so a
  // 10% peek of the neighbouring banner shows). For every slide except the last
  // the NEXT banner peeks on the right. For the LAST banner we right-align it so
  // the PREVIOUS banner peeks 10% on the LEFT instead — otherwise the end of the
  // strip would leave an empty white gap on the right.
  bannerTransform(): string {
    const count = this.offerBanners.length;
    const index = this.activeBannerIndex;
    const base = index * 100;                           // in track-width %
    const isLast = count > 1 && index === count - 1;
    // +11.111% of the 90%-wide track == +10% of the container, sliding the last
    // slide right so it sits flush with the container's right edge.
    return isLast ? `translateX(calc(-${base}% + 11.111%))` : `translateX(-${base}%)`;
  }

  // Auto-rotate the banner every few seconds. Runs continuously while the page
  // is alive; each tick is a no-op when there are 0 or 1 banners.
  private startBannerRotation() {
    this.stopBannerRotation();
    this.bannerTimer = setInterval(() => {
      const count = this.offerBanners.length;
      if (count <= 1) return;
      this.currentBanner = (this.currentBanner + 1) % count;
    }, 2500);
  }

  private stopBannerRotation() {
    if (this.bannerTimer) {
      clearInterval(this.bannerTimer);
      this.bannerTimer = null;
    }
  }

  // Jump to a specific banner (dot tap) and restart the auto-rotation timer so
  // the manually chosen slide gets a full interval before advancing.
  goToBanner(index: number) {
    const count = this.offerBanners.length;
    if (!count) return;
    this.currentBanner = ((index % count) + count) % count;
    this.startBannerRotation();
  }

  nextBanner() { this.goToBanner(this.currentBanner + 1); }
  prevBanner() { this.goToBanner(this.currentBanner - 1); }

  // Manual swipe: remember where the finger went down, and on lift decide
  // whether it was a left/right swipe past a small threshold.
  onBannerTouchStart(event: TouchEvent) {
    this.bannerTouchStartX = event.changedTouches[0].clientX;
  }

  onBannerTouchEnd(event: TouchEvent) {
    const dx = event.changedTouches[0].clientX - this.bannerTouchStartX;
    if (Math.abs(dx) < 40) return;
    if (dx < 0) this.nextBanner();
    else this.prevBanner();
  }

  // ---- Direct call (number configured by admin in Settings) ----
  get callNumber(): string {
    return this.settingsService.callNumber;
  }

  makeCall() {
    const number = (this.callNumber || '').trim();
    if (!number) return;
    // Strip spaces/dashes/parens so the tel: URI dials cleanly.
    const clean = number.replace(/[^\d+]/g, '');
    this.activity.log('call', 'Called Glaron', { detail: number });
    window.location.href = `tel:${clean}`;
  }

  // The shop's configured number (same one used for calls) as wa.me wants it:
  // a full international number with no symbols. Assume India (+91) when a bare
  // 10-digit mobile — or a 0-prefixed 11-digit — is configured.
  private whatsappDigits(): string {
    const raw = (this.callNumber || '').trim();
    if (!raw) return '';
    let digits = raw.replace(/[^\d]/g, '');
    if (digits.length === 10) digits = '91' + digits;
    else if (digits.length === 11 && digits.startsWith('0')) digits = '91' + digits.slice(1);
    return digits;
  }

  // Opens a WhatsApp chat with the number the admin configured in Settings,
  // prefilled with an enquiry that names the product and links its image so
  // WhatsApp renders a preview. Sending the image as a file isn't possible from
  // a wa.me link — the share button beside this one does that.
  openWhatsApp(product: Product, event?: Event) {
    // Don't let the click bubble to the card (which opens the image/description).
    event?.stopPropagation();
    const digits = this.whatsappDigits();
    if (!digits) return;

    const name = this.tn(product.name) || product.name || '';
    const lines = [this.t('whatsappInquiry')];
    if (name) lines.push(`${this.t('waProduct')}: ${name}`);
    const shareableImage = this.toShareableImageUrl(product.image);
    if (shareableImage) lines.push(shareableImage);

    this.activity.log('product-enquiry', `Enquired about ${product.name} on WhatsApp`, this.productMeta(product));

    const url = `https://wa.me/${digits}?text=${encodeURIComponent(lines.join('\n'))}`;
    window.open(url, '_blank');
  }

  // Turns a product image reference into a link WhatsApp can preview, or returns
  // '' when there's nothing shareable (missing image or an inline data: URI,
  // which WhatsApp can't render and which would bloat the message text).
  // App-hosted asset paths are made absolute against the current origin so the
  // deployed site yields a link that opens anywhere.
  private toShareableImageUrl(image?: string): string {
    const src = (image || '').trim();
    if (!src || /^data:/i.test(src)) return '';
    if (/^https?:\/\//i.test(src)) return src;
    return `${window.location.origin}/${src.replace(/^\/+/, '')}`;
  }

  // ---- Share a product ----------------------------------------------------
  // Hands the OS share sheet a real image FILE plus the product's title,
  // variants and description, so WhatsApp/Telegram/Gmail receive an actual photo
  // attachment. Where openWhatsApp() sends a short enquiry to the shop's own
  // number, this sends the full product detail to anyone the dealer picks. The
  // card being prepared is tracked so its button can show a spinner —
  // re-encoding the image takes a moment on slow phones.
  sharingProductId: string | null = null;

  async shareProduct(product: Product, event?: Event) {
    // Don't let the click bubble to the card (which opens the image modal).
    event?.stopPropagation();
    if (this.sharingProductId) return;
    this.sharingProductId = product.id;
    this.activity.log('product-share', `Shared ${product.name}`, this.productMeta(product));

    const title = this.tn(product.name) || product.name || '';
    try {
      const text = this.buildShareText(product);
      const file = await this.buildShareImageFile(product);
      const nav = navigator as any;

      // Best case (all phones): share sheet with the image attached.
      if (file && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title, text });
        return;
      }
      // Share sheet available but no file support → send the details alone.
      if (nav.share) {
        await nav.share({ title, text });
        return;
      }
      // No share sheet at all (most desktop browsers): save the image and put
      // the details on the clipboard so they can be pasted into any chat.
      if (file) this.downloadFile(file);
      await this.copyToClipboard(text);
      this.flashToast(this.t(file ? 'shareDownloaded' : 'shareCopied'));
    } catch (err: any) {
      // Dismissing the share sheet rejects with AbortError — not a failure.
      if (err?.name === 'AbortError') return;
      this.flashToast(this.t('shareFailed'));
    } finally {
      this.sharingProductId = null;
    }
  }

  // Title, variant list and description, formatted for a chat message.
  private buildShareText(product: Product): string {
    const lines: string[] = [];
    const name = this.tn(product.name) || product.name || '';
    // *bold* is WhatsApp's markup and reads fine as plain text elsewhere.
    if (name) lines.push(`*${name}*`);

    const category = product.category ? this.tn(product.category) : '';
    if (category) lines.push(category);

    // Skip labels that are just the product name repeated (variants with no
    // distinguishing specs fall back to the model/name).
    const variants = (product.variants || [])
      .map(v => this.getVariantLabel(v))
      .filter(label => !!label && label !== product.name && label !== name);
    if (variants.length) {
      lines.push('', `${this.t('shareVariants')}:`);
      variants.forEach(label => lines.push(`• ${label}`));
    }

    // Same fallback copy the card shows when a product has no description.
    const description = this.td(product.description || 'High-performance lighting solution designed for modern spaces.');
    if (description) lines.push('', description);

    return lines.join('\n');
  }

  // Turns the product image into a real File ready for the share sheet, or null
  // when there's no usable image.
  private async buildShareImageFile(product: Product): Promise<File | null> {
    const src = (product.image || '').trim();
    if (!src) return null;
    const url = /^(https?:|data:|blob:)/i.test(src)
      ? src
      : `${window.location.origin}/${src.replace(/^\/+/, '')}`;

    // Flatten through a canvas first: catalog images are PNGs with transparent
    // backgrounds, which WhatsApp renders as solid black. A white-backed JPEG
    // also keeps the attachment small enough to send over mobile data.
    let blob = await this.flattenImage(url, 'image/jpeg');
    if (!blob) {
      // Canvas route failed (e.g. a cross-origin host that blocks CORS, which
      // taints the canvas) — fall back to sending the original bytes.
      try {
        const res = await fetch(url);
        if (res.ok) blob = await res.blob();
      } catch (e) {}
    }
    if (!blob || !blob.type.startsWith('image/')) return null;

    const ext = (blob.type.split('/')[1] || 'jpg').split('+')[0].replace('jpeg', 'jpg');
    const base = (this.tn(product.name) || product.name || product.id)
      .replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'product';
    return new File([blob], `${base}.${ext}`, { type: blob.type });
  }

  // Draws the image on a white canvas (capped at 1600px on the long edge) and
  // encodes it as `type`. Resolves null if the image can't be loaded or the
  // canvas is tainted by a cross-origin source.
  private flattenImage(url: string, type: string): Promise<Blob | null> {
    return new Promise(resolve => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const max = 1600;
          const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight) || 1);
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
          const ctx = canvas.getContext('2d');
          if (!ctx) return resolve(null);
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(blob => resolve(blob), type, 0.92);
        } catch (e) {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  private downloadFile(file: File) {
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private async copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      // Clipboard API needs a secure context; fall back to the legacy path.
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try { document.execCommand('copy'); } catch (e2) {}
      area.remove();
    }
  }

  signOut() {
    // Logged BEFORE the session is cleared — afterwards there is no actor to
    // attribute the entry to and it would be dropped.
    this.activity.log('sign-out', 'Signed out');
    this.dealerAuth.clearSession();
    try {
      // The cart belongs to the signed-out dealer (it carries their pricing);
      // drop it so the next dealer doesn't inherit it.
      sessionStorage.removeItem('glaron_checkout_cart');
    } catch (e) {}
    this.orderItems = [];
    this.refreshDealerIdentity();
    this.showProfile = false;
    this.showCustomPrice = false;
    this.showResetConfirm = false;
    this.router.navigate(['/dealer/login']);
  }
}
