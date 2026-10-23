import webpush from 'web-push';
import { db } from '../db.js';
import { now } from '../util.js';
import { isVisible } from '../realtime.js';

// VAPID keys come from the environment, or are generated once and kept in the database
// (so subscriptions keep working across restarts when the database is on a persistent disk).
let vapid = null;
function keys() {
  if (vapid) return vapid;
  let pub = process.env.VAPID_PUBLIC_KEY;
  let priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    const get = (k) => db.prepare('SELECT value FROM secrets WHERE key = ?').get(k)?.value;
    pub = get('vapid_public');
    priv = get('vapid_private');
    if (!pub || !priv) {
      ({ publicKey: pub, privateKey: priv } = webpush.generateVAPIDKeys());
      const put = db.prepare('INSERT OR REPLACE INTO secrets (key, value) VALUES (?, ?)');
      put.run('vapid_public', pub);
      put.run('vapid_private', priv);
    }
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:support@nena.ir', pub, priv);
  vapid = { publicKey: pub, privateKey: priv };
  return vapid;
}

export const publicKey = () => keys().publicKey;

let sender = (subscription, payload, options) => webpush.sendNotification(subscription, payload, options);
// Tests replace the network call.
export function setPushSender(fn) { sender = fn; }

export function saveSubscription(userId, app, sub) {
  const endpoint = String(sub?.endpoint || '');
  const p256dh = String(sub?.keys?.p256dh || '');
  const auth = String(sub?.keys?.auth || '');
  if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) return false;
  db.prepare(`INSERT INTO push_subscriptions (user_id, app, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, app = excluded.app, p256dh = excluded.p256dh, auth = excluded.auth`)
    .run(userId, app, endpoint, p256dh, auth, now());
  return true;
}

export function removeSubscription(endpoint) {
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(String(endpoint || ''));
}

// Sends a notification to every device of a user for one app. Skipped while that app is open
// and visible (the in-app toast covers it), unless `always` is set.
export async function pushTo(userId, app, { title, body, url, tag, urgent = false, always = false }) {
  if (!userId) return 0;
  const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ? AND app = ?').all(userId, app);
  if (!subs.length) return 0;
  if (!always && await isVisible(userId, app)) return 0;
  keys();
  const payload = JSON.stringify({ title, body, url: url || `/${app}/`, tag, urgent });
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await sender({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: urgent ? 60 : 3600, urgency: urgent ? 'high' : 'normal' });
      sent++;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) removeSubscription(s.endpoint); // expired subscription
      else console.warn('[push]', err.statusCode || '', err.message);
    }
  }));
  return sent;
}

// Fire-and-forget helper for call sites that must not wait on the network.
export function notify(userId, app, message) {
  pushTo(userId, app, message).catch((err) => console.warn('[push]', err.message));
}

export function notifyAdmins(message) {
  for (const { id } of db.prepare('SELECT id FROM users WHERE is_admin = 1').all()) notify(id, 'admin', message);
}
