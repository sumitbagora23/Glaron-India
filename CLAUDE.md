# Glaron India

Ionic/Angular monorepo: dealer + agent PWA (`src/`, hosted at glaron-dealer.web.app), admin console (`admin-app/`, glaron-ade19.web.app), agent hosting redirect (`agent-app/`). Deploy with `npm run deploy:dealer` / `npm run deploy:admin` (each bumps its version).

## Keep in step

- **Product card, dealer vs agent.** `src/app/dealer-panel/dealer-panel.page.html` is the reference. The agent card in `src/app/agent-panel/agent-panel.page.html` shows everything the dealer card shows (finish tabs and per-finish photo, wattage tabs, ⓘ spec sheet with warranty, shades, prices), minus the order steppers and the dealer's `t()`/`tn()` translations. Their view helpers (`specTabs`, `specRows`, `productLightColours`, `colourPrice`, `displayImage`, the body-colour methods…) are copied verbatim between the two `.page.ts` files. Any change to one is made to the other in the same commit.
- **Admin services are duplicated.** `src/app/admin/*.service.ts`, `src/app/admin/firestore-rest.ts` and their twins under `admin-app/src/app/admin/` must stay identical (`diff -q`). Edit one, copy to the other.

## Firestore

- The SDK's streaming connection is blocked on some of the customer's networks. Writes that must land go through `firestore-rest.ts` first, with the SDK only as the offline fallback; lists that must be fresh are re-read over REST too (see `dealer.service.ts`).
- Local `main` can lag `origin/main` — deploys are sometimes run from another checkout. Fetch and compare before working on a live issue.
