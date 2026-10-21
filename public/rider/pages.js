import {
  h, mount, icon, toast, toastError, busy, listItem, page, avatar, ratingPill, plateEl, debounce, copyText, shareLink, confirmDialog,
} from '/shared/ui.js';
import * as fa from '/shared/fa.js';
import { openChat as chat } from '/shared/chat.js';
import { openSafety as safety } from '/shared/safety.js';

const RIDER_REPLIES = ['دارم میام', 'کجا هستید؟', 'لطفاً چند دقیقه صبر کنید', 'جلوی در منتظرم', 'ممنون'];

export function openChat(ctx, ride, otherLabel) {
  return chat({ api: ctx.api, socket: ctx.S.socket, ride, myId: ctx.S.user.id, otherLabel, quickReplies: RIDER_REPLIES });
}

export function openSafety(ctx, ride) {
  safety({
    api: ctx.api, ride, shareUrl: `${location.origin}/track/${ride.share_token}`,
    emergencyContact: ctx.S.user.emergency_contact, supportPhone: ctx.S.cfg.support_phone,
  });
}

// Address picker page; resolves with {lat, lng, address} or null.
export function searchPlace(ctx, title) {
  return new Promise((resolve) => {
    let done = false;
    const p = page(title, { onClose: () => { if (!done) resolve(null); } });
    const finish = (place) => { done = true; p.close(); resolve(place); };
    const input = h('input', { class: 'input', placeholder: 'جستجوی آدرس یا مکان', autofocus: true });
    const results = h('div', { class: 'list mt' });
    const suggestions = () => {
      const items = [];
      if (ctx.S.me && !ctx.S.me.approximate) {
        items.push(listItem({ iconName: 'locate', title: 'موقعیت فعلی من', onclick: async () => finish({ lat: ctx.S.me.lat, lng: ctx.S.me.lng, address: (await ctx.reverse(ctx.S.me)) || 'موقعیت فعلی' }) }));
      }
      const c = ctx.map.getCenter();
      items.push(listItem({ iconName: 'pin', title: 'مرکز فعلی نقشه', sub: 'نقطه‌ای که روی نقشه می‌بینید', onclick: async () => finish({ lat: c.lat, lng: c.lng, address: (await ctx.reverse(c)) || 'نقطه انتخابی' }) }));
      ctx.S.places.forEach((pl) => items.push(listItem({ iconName: 'star', title: pl.title, sub: pl.address, onclick: () => finish({ lat: pl.lat, lng: pl.lng, address: pl.address || pl.title }) })));
      mount(results, items);
    };
    const run = debounce(async (q) => {
      if (q.trim().length < 2) return suggestions();
      const c = ctx.S.me || ctx.map.getCenter();
      try {
        const { results: items } = await ctx.api.get(`/geo/search?q=${encodeURIComponent(q)}&lat=${c.lat}&lng=${c.lng}`);
        mount(results, items.length
          ? items.map((it) => listItem({ iconName: 'pin', title: it.title, sub: it.address, onclick: () => finish({ lat: it.lat, lng: it.lng, address: [it.title, it.address].filter(Boolean).join('، ') }) }))
          : h('div', { class: 'empty' }, 'نتیجه‌ای یافت نشد'));
      } catch (err) { mount(results, h('div', { class: 'empty' }, err.message)); }
    }, 350);
    input.addEventListener('input', () => run(input.value));
    mount(p.body, input, results);
    suggestions();
    setTimeout(() => input.focus(), 50);
  });
}

// ---------------------------------------------------------------------------

export function openMenu(ctx) {
  const { S } = ctx;
  const drawer = h('nav', { class: 'drawer' });
  const backdrop = h('div', { class: 'drawer-backdrop' });
  const close = () => { drawer.classList.remove('open'); backdrop.classList.remove('open'); setTimeout(() => { drawer.remove(); backdrop.remove(); }, 250); };
  backdrop.onclick = close;
  const go = (fn) => () => { close(); fn(ctx); };

  mount(drawer,
    h('div', { class: 'drawer-head' },
      avatar(S.user.name, 'lg'),
      h('div', {}, h('div', { class: 'bold' }, S.user.name || 'کاربر نِنا'), h('div', { class: 'row gap-sm small muted' }, ratingPill(S.user.rating), h('span', { class: 'ltr' }, fa.faDigits(S.user.phone))))),
    h('div', { class: 'list' },
      listItem({ iconName: 'history', title: 'سفرهای من', onclick: go(openHistory) }),
      listItem({ iconName: 'calendar', title: 'سفرهای رزرو شده', onclick: go(openScheduled) }),
      listItem({ iconName: 'wallet', title: 'کیف پول', sub: fa.toman(S.user.wallet), onclick: go(openWallet) }),
      listItem({ iconName: 'star', title: 'مکان‌های منتخب', onclick: go(openPlaces) }),
      listItem({ iconName: 'tag', title: 'کدهای تخفیف', onclick: go(openPromos) }),
      listItem({ iconName: 'gift', title: 'دعوت از دوستان', sub: 'هدیه برای شما و دوستتان', onclick: go(openInvite) }),
      listItem({ iconName: 'shield', title: 'ایمنی', onclick: go(openSafetySettings) }),
      listItem({ iconName: 'user', title: 'حساب کاربری', onclick: go(openProfile) }),
      listItem({ iconName: 'help', title: 'پشتیبانی', onclick: go(openSupport) }),
      listItem({ iconName: 'car', title: 'رانندۀ نِنا شوید', sub: 'با خودروی خودتان درآمد کسب کنید', href: '/driver/' }),
      listItem({
        iconName: 'logout', title: 'خروج',
        onclick: async () => { if (await confirmDialog('خروج از حساب', 'آیا مطمئن هستید؟', { ok: 'خروج', danger: true })) { ctx.api.setToken(null); location.reload(); } },
      })),
    h('p', { class: 'tiny muted center mt' }, 'نِنا • نسخه ۱.۰'));
  document.body.append(drawer, backdrop);
  requestAnimationFrame(() => { drawer.classList.add('open'); backdrop.classList.add('open'); });
}

const statusBadge = (s) => h('span', { class: `badge ${s === 'completed' ? 'green' : s === 'cancelled' || s === 'no_driver' ? 'red' : 'blue'}` }, fa.STATUS_FA[s] || s);

function openHistory(ctx) {
  const p = page('سفرهای من');
  const list = h('div', { class: 'list' });
  let pageNo = 0;
  const more = h('button', { class: 'btn btn-block mt' }, 'سفرهای قبلی');
  const load = async () => {
    const { rides } = await ctx.api.get(`/rider/rides?page=${pageNo++}`);
    if (!rides.length && pageNo === 1) list.append(h('div', { class: 'empty' }, icon('history'), h('p', {}, 'هنوز سفری نداشته‌اید')));
    rides.forEach((r) => list.append(listItem({
      iconName: r.is_delivery ? 'doc' : 'car',
      title: r.dropoff.address || 'مقصد',
      sub: `${fa.jDateTime(r.created_at)} • ${r.type_name}`,
      onclick: () => openReceipt(ctx, r),
      end: h('div', { class: 'col gap-sm', style: { alignItems: 'flex-end' } }, h('span', { class: 'bold small' }, fa.toman(r.status === 'completed' ? r.payable : r.cancel_fee)), statusBadge(r.status)),
    })));
    more.classList.toggle('hidden', rides.length < 20);
  };
  more.onclick = () => busy(more, load);
  mount(p.body, list, more);
  load().catch(toastError);
}

function openReceipt(ctx, r) {
  const p = page(`سفر ${fa.jDateShort(r.created_at)}`);
  const kv = (k, v) => h('div', { class: 'kv' }, h('span', { class: 'muted' }, k), h('span', {}, v));
  mount(p.body,
    h('div', { class: 'row between' }, h('h3', {}, r.type_name), statusBadge(r.status)),
    h('div', { class: 'list' },
      listItem({ iconName: 'dot', title: r.pickup.address || 'مبدأ', sub: r.started_at ? fa.jTime(r.started_at) : 'مبدأ' }),
      listItem({ iconName: 'pin', title: r.dropoff.address || 'مقصد', sub: r.completed_at ? fa.jTime(r.completed_at) : 'مقصد' })),
    r.driver ? h('div', { class: 'card mt driver-card' }, avatar(r.driver.name), h('div', { class: 'grow' }, h('div', { class: 'bold' }, r.driver.name), h('div', { class: 'small muted' }, `${r.driver.vehicle_model} ${r.driver.vehicle_color}`)), plateEl(r.driver.plate)) : null,
    h('div', { class: 'card mt' },
      kv('تاریخ', fa.jDateTime(r.created_at)),
      kv('مسافت', fa.km(r.distance_km)),
      r.status === 'completed' ? [
        kv('کرایه', fa.toman(r.fare_final - r.wait_fee)),
        r.wait_fee ? kv('هزینه توقف', fa.toman(r.wait_fee)) : null,
        r.discount ? kv('تخفیف', `− ${fa.toman(r.discount)}`) : null,
        r.tip ? kv('انعام', fa.toman(r.tip)) : null,
        kv('پرداخت از کیف پول', fa.toman(r.paid_wallet)),
        kv('پرداخت نقدی', fa.toman(r.paid_cash)),
        h('div', { class: 'kv total' }, h('span', {}, 'جمع'), h('span', {}, fa.toman(r.payable + r.tip))),
      ] : null,
      r.status === 'cancelled' ? [kv('لغو توسط', { rider: 'شما', driver: 'راننده', admin: 'پشتیبانی' }[r.cancelled_by] || '—'), kv('هزینه لغو', fa.toman(r.cancel_fee))] : null,
      r.rating_by_rider ? kv('امتیاز شما', `${fa.num(r.rating_by_rider)} از ۵`) : null),
    h('a', { class: 'btn btn-block mt', href: `tel:${ctx.S.cfg.support_phone}` }, icon('help'), 'گزارش مشکل در این سفر'));
}

async function openScheduled(ctx) {
  const p = page('سفرهای رزرو شده');
  const render = async () => {
    const { rides } = await ctx.api.get('/rider/rides/scheduled');
    mount(p.body, rides.length ? h('div', { class: 'list' }, rides.map((r) => listItem({
      iconName: 'calendar', title: fa.jDateTime(r.scheduled_at), sub: `${r.type_name} • ${r.dropoff.address || ''}`,
      end: h('button', {
        class: 'btn btn-sm btn-danger-soft',
        onclick: async (e) => {
          e.stopPropagation();
          if (!(await confirmDialog('لغو رزرو', 'این رزرو لغو شود؟', { ok: 'لغو رزرو', danger: true }))) return;
          try { await ctx.api.post(`/rider/rides/${r.id}/cancel`, { reason: 'لغو رزرو' }); toast('رزرو لغو شد'); render(); } catch (err) { toastError(err); }
        },
      }, 'لغو'),
    }))) : h('div', { class: 'empty' }, icon('calendar'), h('p', {}, 'رزرو فعالی ندارید'), h('p', { class: 'small' }, 'از صفحه اصلی گزینه «رزرو» را بزنید.')));
  };
  render().catch(toastError);
}

const TX_FA = {
  topup: 'شارژ کیف پول', ride_payment: 'پرداخت سفر', ride_earning: 'درآمد سفر', tip: 'انعام', cancel_fee: 'هزینه لغو',
  cancel_compensation: 'جبران لغو', referral: 'هدیه دعوت', payout: 'تسویه', payout_refund: 'برگشت تسویه', adjustment: 'اصلاح موجودی', debt_settled: 'تسویه بدهی',
};
export const txRow = (t) => listItem({
  iconName: t.amount > 0 ? 'plus' : 'minus',
  title: TX_FA[t.type] || t.type,
  sub: `${fa.jDateTime(t.created_at)}${t.description ? ` • ${t.description}` : ''}`,
  end: h('span', { class: 'bold small', style: { color: t.amount > 0 ? 'var(--accent)' : 'var(--fg)', direction: 'ltr' } }, `${t.amount > 0 ? '+' : '−'}${fa.num(Math.abs(t.amount), 0)}`),
});

export async function openWallet(ctx) {
  const p = page('کیف پول');
  const { balance, transactions } = await ctx.api.get('/rider/wallet').catch((e) => { toastError(e); return { balance: 0, transactions: [] }; });
  let amount = 100000;
  const custom = h('input', { class: 'input ltr-input', inputmode: 'numeric', placeholder: 'مبلغ دلخواه (تومان)' });
  const chips = h('div', { class: 'chips' });
  const draw = () => mount(chips, [50000, 100000, 200000, 500000].map((v) => h('button', { class: `chip ${amount === v ? 'active' : ''}`, onclick: () => { amount = v; custom.value = ''; draw(); } }, fa.tomanShort(v))));
  draw();
  const pay = h('button', { class: 'btn btn-primary btn-lg btn-block mt' }, 'پرداخت و شارژ');
  pay.onclick = () => busy(pay, async () => {
    const v = custom.value ? Number(fa.enDigits(custom.value).replace(/\D/g, '')) : amount;
    const { url } = await ctx.api.post('/rider/wallet/topup', { amount: v, app: 'rider' });
    location.href = url;
  });
  mount(p.body,
    h('div', { class: 'card', style: { background: 'var(--primary)', color: 'var(--primary-fg)' } },
      h('div', { class: 'small', style: { opacity: 0.7 } }, 'موجودی کیف پول نِنا'),
      h('div', { style: { fontSize: '30px', fontWeight: 900 } }, fa.toman(balance)),
      balance < 0 ? h('div', { class: 'small' }, 'این مبلغ بدهی است و در سفر بعدی دریافت می‌شود') : null),
    h('h3', { class: 'mt-lg' }, 'افزایش موجودی'),
    chips,
    h('div', { class: 'field mt' }, custom),
    h('p', { class: 'hint' }, 'پرداخت از طریق درگاه امن بانکی (شتاب) انجام می‌شود.'),
    pay,
    h('h3', { class: 'mt-lg' }, 'تراکنش‌ها'),
    transactions.length ? h('div', { class: 'list' }, transactions.map(txRow)) : h('div', { class: 'empty' }, 'تراکنشی ثبت نشده است'));
}

function openPlaces(ctx) {
  const p = page('مکان‌های منتخب');
  const render = () => mount(p.body,
    h('div', { class: 'list' },
      ctx.S.places.map((pl) => listItem({
        iconName: pl.label === 'home' ? 'home' : pl.label === 'work' ? 'work' : 'star', title: pl.title, sub: pl.address,
        end: h('button', {
          class: 'btn btn-sm btn-ghost', 'aria-label': 'حذف',
          onclick: async (e) => { e.stopPropagation(); await ctx.api.del(`/rider/places/${pl.id}`); await ctx.loadPlaces(); render(); },
        }, icon('trash')),
      }))),
    h('div', { class: 'col mt' },
      ['home', 'work', 'other'].map((label) => h('button', {
        class: 'btn btn-block',
        onclick: async () => {
          const place = await searchPlace(ctx, label === 'home' ? 'آدرس خانه' : label === 'work' ? 'آدرس محل کار' : 'مکان جدید');
          if (!place) return;
          let title;
          if (label === 'other') title = prompt('نام این مکان؟', 'باشگاه') || 'مکان من';
          try { await ctx.api.post('/rider/places', { ...place, label, title }); await ctx.loadPlaces(); render(); } catch (err) { toastError(err); }
        },
      }, icon('plus'), label === 'home' ? 'تنظیم خانه' : label === 'work' ? 'تنظیم محل کار' : 'افزودن مکان'))));
  render();
}

function openPromos(ctx) {
  const p = page('کدهای تخفیف');
  const input = h('input', { class: 'input ltr-input', placeholder: 'کد تخفیف' });
  const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'بررسی');
  const result = h('div', { class: 'mt' });
  mount(p.body,
    h('form', {
      class: 'row',
      onsubmit: (e) => {
        e.preventDefault();
        busy(btn, async () => {
          const r = await ctx.api.post('/rider/promo/check', { code: input.value });
          mount(result, h('div', { class: 'card' }, h('div', { class: 'bold' }, r.code), h('p', { class: 'muted' }, r.description || 'کد معتبر است'), h('p', { class: 'small' }, 'هنگام انتخاب سرویس، این کد را در بخش «کد تخفیف» وارد کنید.')));
        });
      },
    }, h('div', { class: 'grow' }, input), btn),
    result,
    h('div', { class: 'card mt' }, h('div', { class: 'bold' }, 'NENA50'), h('p', { class: 'muted small' }, '۵۰٪ تخفیف سفر اول تا سقف ۴۰ هزار تومان')));
}

function openInvite(ctx) {
  const p = page('دعوت از دوستان');
  const code = ctx.S.user.referral_code;
  const refInput = h('input', { class: 'input ltr-input', placeholder: 'کد معرف' });
  const refBtn = h('button', { class: 'btn', type: 'submit' }, 'ثبت');
  mount(p.body,
    h('div', { class: 'center' }, icon('gift'), h('h2', { class: 'mt' }, 'هدیه برای هر دو نفر'), h('p', { class: 'muted' }, 'کد خود را برای دوستانتان بفرستید. پس از اولین سفر آن‌ها، به کیف پول هر دو نفر اعتبار هدیه اضافه می‌شود.')),
    h('div', { class: 'card mt row between' }, h('span', { class: 'bold ltr', style: { fontSize: '22px', letterSpacing: '3px' } }, code), h('button', { class: 'btn btn-sm', onclick: () => copyText(code) }, icon('copy'), 'کپی')),
    h('button', { class: 'btn btn-primary btn-lg btn-block mt', onclick: () => shareLink('نِنا', `با کد ${code} در نِنا ثبت‌نام کن و هدیه بگیر!`, `${location.origin}/rider/`) }, icon('share'), 'ارسال دعوت‌نامه'),
    ctx.S.user.referred ? null : h('div', { class: 'mt-lg' },
      h('h3', {}, 'کد معرف دارید؟'),
      h('form', {
        class: 'row',
        onsubmit: (e) => { e.preventDefault(); busy(refBtn, async () => { await ctx.api.post('/me/referral', { code: refInput.value }); toast('کد معرف ثبت شد', 'success'); await ctx.refreshUser(); }); },
      }, h('div', { class: 'grow' }, refInput), refBtn)));
}

function openSafetySettings(ctx) {
  const p = page('ایمنی');
  const contact = h('input', { class: 'input ltr-input', type: 'tel', placeholder: '۰۹۱۲...', value: ctx.S.user.emergency_contact ? fa.faDigits(ctx.S.user.emergency_contact) : '' });
  const save = h('button', { class: 'btn btn-primary btn-block' }, 'ذخیره مخاطب اضطراری');
  save.onclick = () => busy(save, async () => {
    ctx.S.user = (await ctx.api.patch('/me', { emergency_contact: fa.enDigits(contact.value) })).user;
    toast('ذخیره شد', 'success');
  });
  const feature = (ic, title, text) => h('div', { class: 'row', style: { alignItems: 'flex-start', marginBottom: '14px' } }, h('span', { class: 'li-icon' }, icon(ic)), h('div', {}, h('div', { class: 'bold' }, title), h('div', { class: 'muted small' }, text)));
  mount(p.body,
    feature('share', 'اشتراک سفر', 'موقعیت زنده سفر را با خانواده و دوستان به اشتراک بگذارید.'),
    feature('sos', 'دکمه اضطراری', 'در حین سفر، با یک لمس با پلیس ۱۱۰ تماس بگیرید و پشتیبانی نِنا را مطلع کنید.'),
    feature('shield', 'رانندگان احراز هویت‌شده', 'مدارک همه رانندگان (کارت ملی، گواهینامه، کارت خودرو) بررسی می‌شود.'),
    feature('dot', 'کد سفر', 'در صورت فعال بودن، راننده فقط با کد ۴ رقمی شما سفر را شروع می‌کند.'),
    h('div', { class: 'divider' }),
    h('div', { class: 'field' }, h('label', {}, 'مخاطب اضطراری'), contact, h('span', { class: 'hint' }, 'در مواقع اضطراری می‌توانید لینک سفر را با یک لمس برای او پیامک کنید.')),
    save);
}

function openProfile(ctx) {
  const p = page('حساب کاربری');
  const u = ctx.S.user;
  const name = h('input', { class: 'input', value: u.name || '' });
  const email = h('input', { class: 'input ltr-input', type: 'email', value: u.email || '' });
  const save = h('button', { class: 'btn btn-primary btn-lg btn-block' }, 'ذخیره');
  save.onclick = () => busy(save, async () => {
    ctx.S.user = (await ctx.api.patch('/me', { name: name.value, email: email.value })).user;
    toast('ذخیره شد', 'success');
  });
  mount(p.body,
    h('div', { class: 'center mb' }, h('div', { class: 'row', style: { justifyContent: 'center' } }, avatar(u.name, 'lg')), h('div', { class: 'mt' }, ratingPill(u.rating)), h('p', { class: 'muted small mt' }, `عضو از ${fa.jDate(u.created_at)}`)),
    h('div', { class: 'field' }, h('label', {}, 'نام و نام خانوادگی'), name),
    h('div', { class: 'field' }, h('label', {}, 'شماره موبایل'), h('input', { class: 'input ltr-input', value: fa.faDigits(u.phone), disabled: true })),
    h('div', { class: 'field' }, h('label', {}, 'ایمیل (برای دریافت رسید)'), email),
    save);
}

function openSupport(ctx) {
  const p = page('پشتیبانی');
  const faq = [
    ['کرایه چطور محاسبه می‌شود؟', 'کرایه بر اساس ورودی ثابت، مسافت، زمان تقریبی سفر و ضریب تقاضا محاسبه و پیش از درخواست به شما نمایش داده می‌شود.'],
    ['هزینه لغو سفر چقدر است؟', `لغو تا ${fa.num(ctx.S.cfg.free_cancel_seconds / 60)} دقیقه پس از پذیرش راننده رایگان است. پس از آن یا بعد از رسیدن راننده، ${fa.toman(ctx.S.cfg.cancel_fee)} دریافت می‌شود.`],
    ['وسیله‌ام را در خودرو جا گذاشته‌ام', 'از بخش «سفرهای من» سفر موردنظر را باز کنید و با پشتیبانی تماس بگیرید تا با راننده هماهنگ شویم.'],
    ['چطور کیف پول را شارژ کنم؟', 'از منو وارد «کیف پول» شوید، مبلغ را انتخاب کرده و از طریق درگاه بانکی پرداخت کنید.'],
    ['هزینه توقف چیست؟', 'پس از رسیدن راننده، چند دقیقه انتظار رایگان است و پس از آن به ازای هر دقیقه هزینه توقف محاسبه می‌شود.'],
  ];
  mount(p.body,
    h('a', { class: 'btn btn-primary btn-lg btn-block', href: `tel:${ctx.S.cfg.support_phone}` }, icon('phone'), `تماس با پشتیبانی (${fa.faDigits(ctx.S.cfg.support_phone)})`),
    h('h3', { class: 'mt-lg' }, 'سؤالات متداول'),
    faq.map(([q, a]) => h('details', { class: 'card mt' }, h('summary', { class: 'bold', style: { cursor: 'pointer' } }, q), h('p', { class: 'muted mt' }, a))));
}
