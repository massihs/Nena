// Web push: permission, subscription and state for one app ('rider' | 'driver' | 'admin').
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function keyBytes(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const registration = () => navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready);

// 'unsupported' | 'ios-install' | 'denied' | 'off' | 'on'
export async function pushState() {
  if (!supported()) return isIos() && !standalone() ? 'ios-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await registration();
  const sub = await reg.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

// Must be called from a user gesture (tap) — browsers block the permission prompt otherwise.
export async function enablePush(api) {
  if (!supported()) throw new Error(isIos() && !standalone()
    ? 'در آیفون ابتدا نِنا را به صفحه اصلی اضافه کنید (دکمه اشتراک ← Add to Home Screen)'
    : 'این مرورگر از اعلان پشتیبانی نمی‌کند');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('اجازه نمایش اعلان داده نشد؛ از تنظیمات مرورگر فعال کنید');
  const reg = await registration();
  const { key } = await api.get('/push/key');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  await api.post('/push/subscribe', { app: api.app, subscription: sub.toJSON() });
  return 'on';
}

export async function disablePush(api) {
  if (!supported()) return 'unsupported';
  const reg = await registration();
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await api.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe();
  }
  return 'off';
}

// Re-sends an existing subscription after login so the server links it to the current user.
export async function syncPush(api) {
  try {
    if (!supported() || Notification.permission !== 'granted') return;
    const reg = await registration();
    const sub = await reg.pushManager.getSubscription();
    if (sub) await api.post('/push/subscribe', { app: api.app, subscription: sub.toJSON() });
  } catch { /* offline or blocked */ }
}
