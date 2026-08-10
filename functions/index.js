/**
 * Glaron dealer and agent push notifications.
 *
 * When the admin panel writes a document to the `notifications` collection,
 * this function fans it out via FCM to the devices its `audience` names —
 * dealers, agents, or both — so the notification arrives even when the
 * receiving PWA is fully closed.
 *
 * Messages are sent DATA-only; the receiving app's messaging service worker (or
 * its foreground onMessage handler) renders them, so the icon/badge/styling
 * match that app. Invalid/expired tokens are pruned automatically.
 */
const { onDocumentCreated, onDocumentDeleted } = require('firebase-functions/v2/firestore');
const { onRequest } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const { logger } = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

const TOKENS_COLLECTION = 'dealer_tokens';
const AGENT_TOKENS_COLLECTION = 'agent_tokens';
const ADMIN_TOKENS_COLLECTION = 'admin_tokens';
const NOTIFICATIONS_COLLECTION = 'notifications';
const ORDERS_COLLECTION = 'orders';

// Public origin the dealer PWA is served from. Used to build absolute URLs for
// the notification tap target and the notification picture.
//
// Agents live here too: dealers and agents are one installed app behind one
// link, and the agent panel is a route on this same host (/agent/panel). The
// old glaron-agent.web.app site only 301s here, so an agent tap target must
// never be built from it — the redirect would drop the ?tab= and land them on
// the wrong screen.
const DEALER_ORIGIN = 'https://glaron-dealer.web.app';
// Public origin the ADMIN PWA is served from (a separate hosting site and a
// separate app — see the `admin` project in angular.json).
const ADMIN_ORIGIN = 'https://glaron-ade19.web.app';
// Hosting rewrites this path to the notificationImage function below.
const IMAGE_PATH = '/notification-image/';

/**
 * Serve the picture attached to a notification.
 *
 * The admin panel stores the image inline on the notification document as a
 * compact JPEG data URL (like banners and product images), which keeps Firebase
 * Storage out of the picture — but a data URL is orders of magnitude too large
 * for FCM's ~4KB payload limit. So the push carries this short URL instead and
 * the device fetches the bytes from here when it draws the notification.
 *
 * Reached as https://glaron-dealer.web.app/notification-image/<id> via the
 * hosting rewrite in firebase.json.
 */
exports.notificationImage = onRequest(async (req, res) => {
  // Accept the id from the rewritten path or an ?id= query, and allow only the
  // characters a notification id can actually contain.
  const fromPath = String(req.path || '').split('/').filter(Boolean).pop() || '';
  const id = String(req.query.id || fromPath || '');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    res.status(400).send('Bad request');
    return;
  }

  try {
    const doc = await admin.firestore().collection(NOTIFICATIONS_COLLECTION).doc(id).get();
    const image = doc.exists ? String((doc.data() || {}).image || '') : '';
    const match = /^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/.exec(image);
    if (!match) {
      res.status(404).send('Not found');
      return;
    }
    res.set('Content-Type', match[1]);
    // A notification's image never changes once sent, so let devices and the
    // CDN keep it — the same push may be redrawn several times.
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(match[2], 'base64'));
  } catch (err) {
    logger.warn(`Could not serve notification image ${id}: ${err.message || err}`);
    res.status(500).send('Error');
  }
});

/**
 * Who a broadcast is addressed to.
 *
 * Documents written before audiences existed carry no field at all; those were
 * dealer broadcasts, so that is what an unrecognised value means here too.
 * Mirrors resolveNotificationAudience() in the admin panel.
 */
function resolveAudience(value) {
  const norm = String(value || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  if (norm === 'agent' || norm === 'agents') return 'agent';
  if (norm === 'both' || norm === 'all' || norm === 'everyone') return 'both';
  return 'dealer';
}

// A tap destination is metadata only, never rendered in the notification.
// Anything that isn't a site-relative path is replaced with the app's home
// screen, so a bad value can't redirect anyone off-site.
function safePath(value, fallback) {
  const raw = String(value || '');
  return /^\/[^/\\]/.test(raw) ? raw : fallback;
}

/**
 * The FCM message for one broadcast, aimed at one app.
 *
 * `app` carries everything that differs between the dealer and agent PWAs:
 * which origin a tap opens and which icon the notification wears.
 */
function broadcastMessage(app, { id, title, body, path, imageUrl }) {
  return {
    // Carried alongside the notification so whichever side ends up rendering
    // the message — the service worker, or the page's foreground onMessage
    // handler — has the full text AND the tap destination. Leaving title/body
    // out here blanks the notification when the app is open, because FCM
    // hands the page this data payload rather than the notification one.
    data: { id, url: path, title, body, ...(imageUrl ? { image: imageUrl } : {}) },
    // A webpush NOTIFICATION payload is auto-displayed by the browser even when
    // the PWA is fully closed — data-only relies on the SW waking, which is
    // unreliable once the app is killed. fcmOptions.link handles the tap.
    webpush: {
      headers: { Urgency: 'high', TTL: '86400' },
      notification: {
        title,
        body,
        icon: app.icon,
        badge: app.icon,
        // Drawn as the big picture inside the expanded notification on
        // Android/Chrome; platforms without support just ignore it.
        ...(imageUrl ? { image: imageUrl } : {}),
        tag: id,
        requireInteraction: true
      },
      fcmOptions: { link: app.origin + path }
    },
    android: { priority: 'high' }
  };
}

exports.sendDealerNotification = onDocumentCreated('notifications/{id}', async (event) => {
  const snap = event.data;
  if (!snap) return;
  const n = snap.data() || {};

  const title = String(n.title || 'Glaron India');
  const body = String(n.body || '');
  const id = String(n.id || event.params.id || '');
  // Dealers only, agents only, or both — chosen by the admin when composing.
  const audience = resolveAudience(n.audience);
  // The optional picture. Only the short hosted URL is sent — the inline data
  // URL it points at would blow past FCM's payload limit many times over. It
  // is always served from the dealer site (the host carrying the rewrite); an
  // agent device fetches it from there just as happily.
  const hasImage = /^data:image\//.test(String(n.image || ''));
  const imageUrl = hasImage && id ? DEALER_ORIGIN + IMAGE_PATH + id : '';

  // Which screen a tap opens, once per app: the two lay their tabs out
  // differently, so the admin panel resolves the chosen tab for each and writes
  // both paths onto the document.
  const sends = [];
  if (audience === 'dealer' || audience === 'both') {
    sends.push({
      who: 'dealer',
      collection: TOKENS_COLLECTION,
      app: { origin: DEALER_ORIGIN, icon: '/assets/icon/icon-192.png' },
      path: safePath(n.url, '/dealer/catalog')
    });
  }
  if (audience === 'agent' || audience === 'both') {
    sends.push({
      who: 'agent',
      collection: AGENT_TOKENS_COLLECTION,
      // Same origin and same icon as above — it is literally the same installed
      // app; only the panel behind the link and the token collection differ.
      app: { origin: DEALER_ORIGIN, icon: '/assets/icon/icon-192.png' },
      path: safePath(n.agentUrl, '/agent/panel')
    });
  }

  for (const s of sends) {
    const sent = await fanOutToTokens(s.collection, () =>
      broadcastMessage(s.app, { id, title, body, path: s.path, imageUrl })
    );
    if (!sent) {
      logger.info(`No ${s.who} tokens registered; nothing to send.`);
      continue;
    }
    logger.info(`Notification ${id} pushed to ${sent} ${s.who} device(s).`);
  }
});

/**
 * Fan a message out to every token in a collection, pruning dead ones.
 *
 * `build(tokens)` returns the multicast message for one chunk. Returns the
 * number of tokens attempted so the caller can log it.
 */
async function fanOutToTokens(collectionName, build) {
  const db = admin.firestore();
  const snap = await db.collection(collectionName).get();

  // Map each token back to its doc id so dead ones can be pruned afterwards.
  const entries = [];
  snap.forEach((d) => {
    const t = (d.data() || {}).token;
    if (t) entries.push({ docId: d.id, token: t });
  });

  if (!entries.length) return 0;

  const invalidDocIds = [];
  const CHUNK = 500; // FCM multicast limit per request.

  for (let i = 0; i < entries.length; i += CHUNK) {
    const batch = entries.slice(i, i + CHUNK);
    const response = await admin.messaging().sendEachForMulticast({
      tokens: batch.map((e) => e.token),
      ...build(),
    });

    response.responses.forEach((r, idx) => {
      if (r.success) return;
      const code = r.error && r.error.code;
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token' ||
        code === 'messaging/invalid-argument'
      ) {
        invalidDocIds.push(batch[idx].docId);
      }
    });
  }

  await Promise.all(
    invalidDocIds.map((docId) =>
      db.collection(collectionName).doc(docId).delete().catch(() => {})
    )
  );

  if (invalidDocIds.length) {
    logger.info(`Pruned ${invalidDocIds.length} invalid token(s) from ${collectionName}.`);
  }
  return entries.length;
}

/**
 * Tell the admin when a dealer places an order.
 *
 * Fires on every new `orders/{id}` document and pushes to every device
 * registered in `admin_tokens` (written by the admin PWA's AdminPushService),
 * so the alert lands in the admin's notification bar even when that app is
 * fully closed.
 *
 * Orders the admin created themselves carry `source: 'admin'` and are skipped —
 * there is no point announcing an order back to the person who just typed it.
 * Documents written before `source` existed have no such field and are treated
 * as dealer orders.
 */
exports.notifyAdminOnNewOrder = onDocumentCreated(`${ORDERS_COLLECTION}/{id}`, async (event) => {
  const snap = event.data;
  if (!snap) return;
  const order = snap.data() || {};

  if (String(order.source || '') === 'admin') {
    logger.info(`Order ${event.params.id} was created in the console; no admin push.`);
    return;
  }

  const id = String(order.id || event.params.id || '');
  const dealer = String(order.dealer || 'A dealer');
  const value = Number(order.value || 0);
  const itemsCount = Number(order.itemsCount || 0);

  const amount = value ? `₹${value.toLocaleString('en-IN')}` : '';
  const items = itemsCount ? `${itemsCount} item${itemsCount === 1 ? '' : 's'}` : '';
  const detail = [items, amount].filter(Boolean).join(' · ');

  const title = 'New order received';
  const body = `${dealer} placed order ${id}${detail ? ` — ${detail}` : ''}`;
  // Deep-link straight to the orders screen of the admin PWA.
  const path = '/admin/orders';
  const link = ADMIN_ORIGIN + path;

  const sent = await fanOutToTokens(ADMIN_TOKENS_COLLECTION, () => ({
    // Carried alongside the notification so whichever side renders the message
    // — the service worker, or the page's foreground onMessage handler — has
    // the full text AND the tap destination.
    data: { id, url: path, title, body, kind: 'order' },
    // A webpush NOTIFICATION payload is auto-displayed by the browser even when
    // the PWA is fully closed; data-only relies on the service worker waking,
    // which is unreliable once the app is killed. fcmOptions.link handles taps.
    webpush: {
      headers: { Urgency: 'high', TTL: '86400' },
      notification: {
        title,
        body,
        // The admin console ships its own icon set (see scripts/gen-admin-icons.mjs).
        icon: '/assets/admin/icon-192.png',
        badge: '/assets/admin/icon-192.png',
        tag: id,
        requireInteraction: true
      },
      fcmOptions: { link }
    },
    android: { priority: 'high' }
  }));

  if (!sent) {
    logger.info('No admin tokens registered; nothing to send.');
    return;
  }
  logger.info(`Order ${id} pushed to ${sent} admin device(s).`);
});

/**
 * When the admin deletes an agent, stop their devices receiving broadcasts.
 *
 * Agents sign in with a mobile number + a password hashed onto their own
 * `agents/{id}` document, so deleting that document already removes their
 * credentials — there is no Firebase Auth user to delete. What's left is the
 * push tokens their devices registered, each stamped with that mobile number.
 */
exports.pruneDeletedAgentTokens = onDocumentDeleted('agents/{id}', async (event) => {
  const data = event.data ? event.data.data() : null;
  const agentId = event.params.id;

  const digits = String((data && data.phone) || '').replace(/\D/g, '');
  const mobile = digits.length > 10 ? digits.slice(-10) : digits;
  if (!mobile) return;

  try {
    const snap = await admin
      .firestore()
      .collection(AGENT_TOKENS_COLLECTION)
      .where('mobile', '==', mobile)
      .get();
    await Promise.all(snap.docs.map((d) => d.ref.delete().catch(() => {})));
    if (snap.size) logger.info(`Removed ${snap.size} push token(s) for agent ${agentId}.`);
  } catch (err) {
    logger.warn(`Could not prune push tokens for agent ${agentId}: ${err.message || err}`);
  }
});

/**
 * When the admin deletes a dealer, clean up after them.
 *
 * Dealers sign in with a mobile number + a password hashed onto their own
 * `dealers/{id}` document, so deleting that document already removes their
 * credentials — there is no Firebase Auth user to delete. What's left is their
 * registered push tokens, which must stop receiving broadcasts immediately.
 *
 * Token docs are stamped with the dealer's mobile number (`mobile`). Legacy
 * docs written before mobile sign-in carry an `email` instead, and legacy
 * dealers may still have a Firebase Auth account from the old email login —
 * both are cleaned up too when the deleted document carries an email.
 */
exports.deleteDealerAuthUser = onDocumentDeleted('dealers/{id}', async (event) => {
  const data = event.data ? event.data.data() : null;
  const dealerId = event.params.id;
  const db = admin.firestore();

  const digits = String((data && data.phone) || '').replace(/\D/g, '');
  const mobile = digits.length > 10 ? digits.slice(-10) : digits;
  const rawEmail = String((data && data.email) || '').trim();
  const email = rawEmail.toLowerCase();

  // Stop pushes going to the removed dealer's devices.
  const lookups = [];
  if (mobile) lookups.push(['mobile', mobile]);
  // Legacy token docs keyed by email, stored in whatever casing was typed.
  Array.from(new Set([rawEmail, email].filter(Boolean))).forEach((value) => {
    lookups.push(['email', value]);
  });

  try {
    let removed = 0;
    for (const [field, value] of lookups) {
      const tokensSnap = await db.collection(TOKENS_COLLECTION).where(field, '==', value).get();
      await Promise.all(tokensSnap.docs.map((d) => d.ref.delete().catch(() => {})));
      removed += tokensSnap.size;
    }
    if (removed) logger.info(`Removed ${removed} push token(s) for dealer ${dealerId}.`);
  } catch (err) {
    logger.warn(`Could not prune push tokens for dealer ${dealerId}: ${err.message || err}`);
  }

  // Legacy cleanup only: dealers registered under the old email sign-in still
  // have a Firebase Auth account. Current dealers never had one.
  if (!email) return;
  try {
    const user = await admin.auth().getUserByEmail(email);
    await admin.auth().deleteUser(user.uid);
    logger.info(`Deleted legacy Auth user ${user.uid} (${email}) for dealer ${dealerId}.`);
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      logger.info(`No legacy Auth user for ${email}; nothing to delete.`);
      return;
    }
    logger.error(`Failed to delete Auth user for ${email}: ${err.message || err}`);
  }
});
