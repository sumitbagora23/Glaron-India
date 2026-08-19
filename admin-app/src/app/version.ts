// ────────────────────────────────────────────────────────────────────────────
// ADMIN APP VERSION — single source of truth for the version shown in the
// console and in its "new update available" prompt. Independent of the dealer
// PWA's version (src/app/version.ts); the two apps ship separately.
//
// 👉 Bumped automatically by `npm run version:bump:admin` (which also runs as
//    part of `npm run deploy:admin`), which mirrors it into
//    admin-app/ngsw-config.json's appData.
// ────────────────────────────────────────────────────────────────────────────
export const APP_VERSION = '1.0.80';
