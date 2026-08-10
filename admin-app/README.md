# Glaron Admin — standalone PWA

The admin console is its **own application**, separate from the dealer portal in
every way that matters: its own Angular project, its own bundle, its own service
workers, its own manifest and icons, its own version number, and its own Firebase
Hosting site. Nothing in `admin-app/` imports from `src/` (the dealer PWA) and
nothing in `src/` imports from here. They meet only at the Firestore data.

| | Dealer PWA | Admin PWA |
|---|---|---|
| Sources | `src/` | `admin-app/src/` |
| Angular project | `app` | `admin` |
| Build output | `www/` | `www-admin/` |
| Hosting site | `glaron-dealer.web.app` | `glaron-ade19.web.app` |
| Version file | `src/app/version.ts` | `admin-app/src/app/version.ts` |
| FCM worker | `firebase-messaging-sw.js` | `admin-messaging-sw.js` |
| Push tokens | `dealer_tokens` | `admin_tokens` |
| Icons | `assets/icon/**` | `assets/admin/**` |

## Commands

```bash
npm run start:admin      # dev server for the console
npm run build:admin      # production build into www-admin/
npm run deploy:admin     # bump version, build, deploy hosting:admin
npm run deploy:functions # deploy the Cloud Functions (needs Blaze)
```

The dealer app keeps its own `npm start` / `npm run deploy:dealer`. `npm run
deploy` runs both.

Icons are generated, not hand-drawn — re-run after changing `src/assets/glaron-mark.png`:

```bash
node scripts/gen-admin-icons.mjs
```

## New-order alerts

When a dealer places an order the console raises an OS notification. There are
two delivery paths and they are deliberately different:

1. **FCM push — reaches a closed app.** Each admin device registers a token in
   `admin_tokens` (`AdminPushService`). The `notifyAdminOnNewOrder` Cloud
   Function fires on every new `orders/{id}` document and pushes to those
   tokens. The push carries a `webpush.notification` block, which the browser
   auto-displays even when the PWA has been killed.
2. **Firestore listener — only while the console is open.** The same service
   watches the `orders` collection and draws the notification itself. This
   covers browsers without push and the window before the function is live. It
   stands down as soon as an FCM token exists, so nothing is announced twice.

Orders created inside the console carry `source: 'admin'` and are skipped —
there is no point notifying the admin about an order they just typed in.
Dealer checkout writes `source: 'dealer'`.

### Per-platform requirements

- **Android / desktop Chrome, Edge** — works in a browser tab; installing makes
  delivery more reliable.
- **iPhone / iPad** — iOS only allows Web Push for an app **added to the Home
  Screen from Safari**, on **iOS 16.4+**. In a plain Safari tab there is no
  notification permission prompt at all. `/install` walks through this, and the
  console detects the case rather than offering a button that cannot work.
- Permission must be requested from a **user gesture** on every platform, which
  is why there is a "Turn on order alerts" button instead of an automatic prompt.

## Two things must be done in the Firebase console

**1. Enable the Blaze plan.** Without it `firebase deploy --only functions`
fails with `HTTP Error: 403 … please check billing account`, and the
closed-app push path cannot exist. Until then only the in-app fallback works.

**2. Allow admin devices to register their push token.** Add `admin_tokens` to
the Firestore rules (Console → Firestore → Rules). Admins sign in with Firebase
Auth, so requiring a signed-in caller is enough:

```
match /admin_tokens/{docId} {
  allow read, write: if request.auth != null;
}
```
