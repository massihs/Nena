import { h, mount, icon, toast, toastError, busy, page } from './ui.js';
import { pushState, enablePush, disablePush } from './push.js';
import { isIos, canPrompt, promptInstall } from './install.js';

// Notification settings, shared wording for rider and driver.
export async function openNotifications(ctx, { lines = ['پذیرش و رسیدن راننده', 'پیام‌های راننده', 'یادآوری و پذیرش سفرهای رزروی', 'رسید پایان سفر'] } = {}) {
  const p = page('اعلان‌ها');
  const render = async () => {
    const state = await pushState();
    const toggle = h('button', { class: `btn btn-lg btn-block mt ${state === 'on' ? '' : 'btn-primary'}` }, state === 'on' ? 'خاموش کردن اعلان‌ها' : 'روشن کردن اعلان‌ها');
    toggle.onclick = () => busy(toggle, async () => {
      if (state === 'on') { await disablePush(ctx.api); toast('اعلان‌ها خاموش شد'); } else { await enablePush(ctx.api); toast('اعلان‌ها فعال شد', 'success'); }
      render();
    });
    const test = h('button', { class: 'btn btn-block mt' }, 'ارسال اعلان آزمایشی');
    test.onclick = () => busy(test, async () => { const r = await ctx.api.post('/push/test', { app: ctx.api.app }); toast(r.sent ? 'اعلان ارسال شد' : 'دستگاهی برای ارسال پیدا نشد'); });
    const status = {
      on: h('span', { class: 'badge green' }, 'فعال'), off: h('span', { class: 'badge' }, 'غیرفعال'),
      denied: h('span', { class: 'badge red' }, 'مسدود در مرورگر'), unsupported: h('span', { class: 'badge red' }, 'پشتیبانی نمی‌شود'),
      'ios-install': h('span', { class: 'badge yellow' }, 'نیاز به نصب اپ'),
    }[state];
    mount(p.body,
      h('div', { class: 'card' },
        h('div', { class: 'row between' }, h('h3', { style: { margin: 0 } }, 'اعلان‌های نِنا'), status),
        h('p', { class: 'muted small mt' }, 'حتی وقتی اپ بسته است:'),
        h('ul', { class: 'small', style: { margin: 0, paddingInlineStart: '18px' } }, lines.map((l) => h('li', {}, l))),
        state === 'denied' ? h('p', { class: 'small mt' }, 'اجازه اعلان را در تنظیمات مرورگر (نماد قفل کنار آدرس سایت) برای این سایت فعال کنید.') : null,
        state === 'ios-install' ? h('p', { class: 'small mt' }, 'در آیفون اعلان فقط برای اپ نصب‌شده کار می‌کند: در Safari دکمه اشتراک ← «Add to Home Screen» را بزنید و نِنا را از صفحه اصلی باز کنید.') : null,
        ['on', 'off'].includes(state) ? toggle : null,
        state === 'on' ? test : null));
  };
  render().catch(toastError);
}

export function openInstall() {
  const p = page('نصب اپ نِنا');
  const btn = h('button', { class: 'btn btn-primary btn-lg btn-block mt' }, icon('upload'), 'نصب روی این دستگاه');
  btn.onclick = () => busy(btn, async () => { if (await promptInstall()) toast('نِنا نصب شد', 'success'); });
  mount(p.body,
    h('div', { class: 'center' }, h('img', { src: '/icon.svg', alt: '', style: { width: '88px', borderRadius: '22px' } }), h('h2', { class: 'mt' }, 'نِنا روی صفحه اصلی'), h('p', { class: 'muted' }, 'سریع‌تر باز می‌شود، تمام‌صفحه است و اعلان‌ها را دریافت می‌کند.')),
    canPrompt() ? btn : h('div', { class: 'card mt' },
      isIos()
        ? [h('div', { class: 'bold' }, 'آیفون و آیپد (Safari)'), h('ol', { class: 'small' }, h('li', {}, 'دکمه اشتراک (مربع با فلش رو به بالا) را بزنید'), h('li', {}, '«Add to Home Screen» را انتخاب کنید'), h('li', {}, 'نِنا را از صفحه اصلی باز کنید'))]
        : [h('div', { class: 'bold' }, 'اندروید (Chrome)'), h('ol', { class: 'small' }, h('li', {}, 'منوی ⋮ بالای مرورگر را باز کنید'), h('li', {}, '«Install app» یا «Add to Home screen» را بزنید'))]));
}
