import { Firestore } from '@angular/fire/firestore';

/**
 * Write and delete Firestore documents over the plain-HTTPS REST API instead of
 * the SDK's setDoc/deleteDoc.
 *
 * The SDK talks to the backend over a streaming WebChannel connection. On some
 * networks — corporate proxies, a few mobile carriers — that stream is silently
 * blocked or buffered, and the same happens when the offline cache is wedged by
 * a full localStorage. When it is, a setDoc write is queued into the cache and
 * its promise NEVER resolves: the admin's "Publishing…" spinner hangs forever
 * and the document never reaches the dealer and agent apps at all. Plain HTTPS
 * (which the REST endpoint uses) is not affected, so posting the document
 * directly is what actually gets a broadcast, banner or order through.
 *
 * Every collection is world-writable (see firestore.rules), so no auth token is
 * attached — the same reason the customer quotation write can go in without a
 * sign-in.
 */

/** Turn a plain object into the Firestore REST `fields` map. Undefined values
 *  are dropped, so an omitted optional field simply isn't written. */
function toFsFields(obj: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (value !== undefined) fields[key] = toFsValue(value);
  }
  return fields;
}

/** One value in Firestore REST's typed-value shape. Covers what these documents
 *  hold: strings (incl. image data URLs), numbers, booleans, string/array/map
 *  nesting (order items, banner lists, recipient phone arrays). */
function toFsValue(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (typeof value === 'boolean') return { booleanValue: value };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(v => toFsValue(v)) } };
  }
  if (value && typeof value === 'object') {
    return { mapValue: { fields: toFsFields(value as Record<string, unknown>) } };
  }
  return { nullValue: null };
}

function baseUrl(firestore: Firestore, collectionPath: string, docId: string): {
  url: string; apiKey?: string;
} {
  const app = firestore.app;
  const projectId = app.options.projectId;
  const apiKey = app.options.apiKey;
  const url =
    `https://firestore.googleapis.com/v1/projects/${projectId}` +
    `/databases/(default)/documents/${collectionPath}/${encodeURIComponent(docId)}`;
  return { url, apiKey };
}

/**
 * Create-or-overwrite a document over REST (a PATCH, so a retry or double-tap is
 * idempotent rather than a 409). Pass `merge: true` to update only the fields in
 * `data` and leave any others on the stored document untouched — matching
 * setDoc(..., { merge: true }). A 15s abort keeps a dead network from hanging
 * the write forever.
 */
export async function writeDocViaRest(
  firestore: Firestore,
  collectionPath: string,
  docId: string,
  data: Record<string, unknown>,
  opts?: { merge?: boolean; timeoutMs?: number }
): Promise<void> {
  const { url, apiKey } = baseUrl(firestore, collectionPath, docId);
  const params: string[] = [];
  if (opts?.merge) {
    // updateMask limits the write to the fields we send, so a stored field this
    // client doesn't know about survives — the merge semantics setDoc gives.
    for (const key of Object.keys(data)) {
      if (data[key] !== undefined) params.push(`updateMask.fieldPaths=${encodeURIComponent(key)}`);
    }
  }
  if (apiKey) params.push(`key=${apiKey}`);
  const full = url + (params.length ? `?${params.join('&')}` : '');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 15000);
  try {
    const res = await fetch(full, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: toFsFields(data) }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Firestore write failed (${res.status}): ${detail.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Delete a document over REST. Swallows a not-found so removing something twice
 *  is harmless. A 15s abort keeps a dead network from hanging. */
export async function deleteDocViaRest(
  firestore: Firestore,
  collectionPath: string,
  docId: string,
  opts?: { timeoutMs?: number }
): Promise<void> {
  const { url, apiKey } = baseUrl(firestore, collectionPath, docId);
  const full = url + (apiKey ? `?key=${apiKey}` : '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 15000);
  try {
    const res = await fetch(full, { method: 'DELETE', signal: controller.signal });
    if (!res.ok && res.status !== 404) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Firestore delete failed (${res.status}): ${detail.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Decode one Firestore REST typed value back to a plain JS value. */
function fromFsValue(value: any): unknown {
  if (value == null || typeof value !== 'object') return null;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue?.values || []).map(fromFsValue);
  if ('mapValue' in value) return fromFsFields(value.mapValue?.fields || {});
  return null;
}

function fromFsFields(fields: Record<string, any>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(fields || {})) out[key] = fromFsValue(fields[key]);
  return out;
}

export interface RestDoc {
  id: string;
  data: Record<string, unknown>;
}

/**
 * Read every document of a collection over plain HTTPS.
 *
 * The SDK's onSnapshot listener rides the same streaming connection as its
 * writes, so on a network that blocks the stream it quietly keeps serving the
 * on-device cache: a document that reached the server never appears. This
 * one-shot GET is not affected, so a service can use it to (re)load the true
 * server list beside the listener. Pages through the collection, and aborts
 * rather than hanging on a dead network.
 */
export async function listCollectionViaRest(
  firestore: Firestore,
  collectionPath: string,
  opts?: { timeoutMs?: number }
): Promise<RestDoc[]> {
  const app = firestore.app;
  const projectId = app.options.projectId;
  const apiKey = app.options.apiKey;
  const base =
    `https://firestore.googleapis.com/v1/projects/${projectId}` +
    `/databases/(default)/documents/${collectionPath}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 10000);
  const docs: RestDoc[] = [];
  try {
    let pageToken = '';
    do {
      const params = ['pageSize=300'];
      if (pageToken) params.push(`pageToken=${encodeURIComponent(pageToken)}`);
      if (apiKey) params.push(`key=${apiKey}`);
      const res = await fetch(`${base}?${params.join('&')}`, { signal: controller.signal });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Firestore list failed (${res.status}): ${detail.slice(0, 200)}`);
      }
      const json: any = await res.json();
      for (const d of json?.documents || []) {
        const name: string = d?.name || '';
        docs.push({
          id: decodeURIComponent(name.slice(name.lastIndexOf('/') + 1)),
          data: fromFsFields(d?.fields || {}),
        });
      }
      pageToken = json?.nextPageToken || '';
    } while (pageToken);
    return docs;
  } finally {
    clearTimeout(timer);
  }
}
