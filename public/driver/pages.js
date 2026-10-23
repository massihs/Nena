import { h, mount, icon, toast, toastError, busy, listItem, page, avatar, ratingPill, plateEl, vehicleArt, confirmDialog } from '/shared/ui.js';
import * as fa from '/shared/fa.js';
import { isInstalled } from '/shared/install.js';
import { openNotifications, openInstall } from '/shared/app-pages.js';

export const DRIVER_PUSH_LINES = ['درخواست سفر جدید (با صدا و لرزش)', 'پیام مسافر و لغو سفر', 'رزروهای شما و یادآوری زمان سفر', 'انعام، تسویه و وضعیت حساب'];

const LETTERS = 'ب ج د س ص ط ق ل م ن و ه ی ع پ ت ث ز ژ ش ف ک گ الف'.split(' ');
const DOCS = {
  license: 'گواهینامه رانندگی',
  national_card: 'کارت ملی',
  vehicle_card: 'کارت خودرو',
  insurance: 'بیمه‌نامه شخص ثالث',
  photo: 'عکس پرسنلی',
};

// ---------------------------------------------------------------------------
// registration (3 steps: personal, vehicle, documents)

export function openRegistration(ctx, { step = 1 } = {}) {
  const d = ctx.S.driver || {};
  const form = {
    name: ctx.S.user.name || '', national_id: d.national_id || '', license_no: d.license_no || '',
    vehicle_type: d.vehicle_type || 'eco', vehicle_model: d.vehicle_model || '', vehicle_color: d.vehicle_color || '',
    vehicle_year: d.vehicle_year || '', plate: d.plate || '', sheba: d.sheba || '',
  };
  const root = ctx.root;

  const frame = (n, ...content) => mount(root, h('div', { class: 'page', style: { animation: 'none' } },
    h('div', { class: 'page-body' },
      h('div', { class: 'row between mb' }, h('div', { class: 'brand' }, 'نِنا'), h('button', { class: 'btn btn-ghost btn-sm', onclick: ctx.logout }, 'خروج')),
      h('div', { class: 'reg-steps' }, [1, 2, 3].map((i) => h('i', { class: i <= n ? 'on' : '' }))),
      d.status === 'rejected' ? h('div', { class: 'card mb', style: { borderInlineStart: '4px solid var(--danger)' } }, h('div', { class: 'bold' }, 'درخواست قبلی شما رد شد'), h('div', { class: 'muted small' }, d.status_reason || 'لطفاً اطلاعات را اصلاح و دوباره ارسال کنید.')) : null,
      ...content)));

  const field = (label, key, attrs = {}) => h('div', { class: 'field' }, h('label', {}, label),
    h('input', { class: `input ${attrs.ltr ? 'ltr-input' : ''}`, value: form[key] ? (attrs.ltr ? fa.faDigits(form[key]) : form[key]) : '', oninput: (e) => { form[key] = fa.enDigits(e.target.value); }, ...attrs }),
    attrs.hint ? h('span', { class: 'hint' }, attrs.hint) : null);

  function step1() {
    frame(1,
      h('h2', {}, 'رانندۀ نِنا شوید'),
      h('p', { class: 'muted' }, 'اطلاعات هویتی خود را مطابق کارت ملی و گواهینامه وارد کنید.'),
      field('نام و نام خانوادگی', 'name', { autocomplete: 'name' }),
      field('کد ملی', 'national_id', { ltr: true, inputmode: 'numeric', maxlength: 10 }),
      field('شماره گواهینامه', 'license_no', { ltr: true, inputmode: 'numeric', maxlength: 10, hint: '۱۰ رقم درج‌شده روی گواهینامه' }),
      h('button', { class: 'btn btn-accent btn-lg btn-block mt', onclick: step2 }, 'ادامه'));
  }

  function step2() {
    const types = [['eco', 'نِنا اکو', 'car', 'هر سواری سالم و تمیز'], ['black', 'نِنا بلک', 'car-black', 'لوکس، مشکی، مدل ۱۳۹۸ به بعد']];
    const pick = h('div', { class: 'vehicle-pick' });
    const plateBox = h('div', {});
    const blackNote = h('div', { class: 'card small mt' });
    const drawPick = () => {
      mount(pick, types.map(([k, label, art, desc]) => h('button', { class: form.vehicle_type === k ? 'selected' : '', type: 'button', onclick: () => { form.vehicle_type = k; drawPick(); } },
        vehicleArt(art), label, h('span', { class: 'tiny muted', style: { fontWeight: 500 } }, desc))));
      blackNote.classList.toggle('hidden', form.vehicle_type !== 'black');
      mount(blackNote, h('div', { class: 'bold' }, 'شرایط نِنا بلک'),
        h('ul', { class: 'muted', style: { margin: '4px 0 0', paddingInlineStart: '18px' } },
          h('li', {}, 'خودروی سدان لوکس به رنگ مشکی (مثل کمری، سوناتا، اپتیما، بنز، BMW)'),
          h('li', {}, 'مدل ۱۳۹۸ (۲۰۱۹) یا جدیدتر، بدون آسیب ظاهری'),
          h('li', {}, 'پوشش رسمی و برخورد حرفه‌ای'),
          h('li', {}, 'کرایه بالاتر و سهم بیشتر برای شما')));
    };
    const drawPlate = () => {
      const parts = form.plate.split('|');
      if (form.vehicle_type === 'bike') {
        const a = h('input', { class: 'input', maxlength: 3, inputmode: 'numeric', placeholder: '۱۲۳', value: parts.length === 2 ? fa.faDigits(parts[0]) : '' });
        const b = h('input', { class: 'input', maxlength: 5, inputmode: 'numeric', placeholder: '۴۵۶۷۸', value: parts.length === 2 ? fa.faDigits(parts[1]) : '' });
        const sync = () => { form.plate = `${fa.enDigits(a.value)}|${fa.enDigits(b.value)}`; };
        a.oninput = sync; b.oninput = sync;
        mount(plateBox, h('div', { class: 'field' }, h('label', {}, 'پلاک موتورسیکلت'), h('div', { class: 'plate-input' }, a, h('span', {}, '/'), b)));
      } else {
        const p = parts.length === 4 ? parts : ['', 'ب', '', ''];
        const two = h('input', { class: 'input', maxlength: 2, inputmode: 'numeric', placeholder: '۱۲', value: fa.faDigits(p[0]), style: { width: '64px' } });
        const letter = h('select', { class: 'input', style: { width: '78px' } }, LETTERS.map((l) => h('option', { value: l, selected: l === p[1] }, l)));
        const three = h('input', { class: 'input', maxlength: 3, inputmode: 'numeric', placeholder: '۳۴۵', value: fa.faDigits(p[2]), style: { width: '80px' } });
        const region = h('input', { class: 'input', maxlength: 2, inputmode: 'numeric', placeholder: '۶۷', value: fa.faDigits(p[3]), style: { width: '64px' } });
        const sync = () => { form.plate = [two.value, letter.value, three.value, region.value].map(fa.enDigits).join('|'); };
        [two, letter, three, region].forEach((x) => { x.oninput = sync; x.onchange = sync; });
        sync();
        mount(plateBox, h('div', { class: 'field' }, h('label', {}, 'پلاک خودرو'),
          h('div', { class: 'plate-input' }, two, letter, three, h('span', { class: 'small muted' }, 'ایران'), region)));
      }
    };
    drawPick();
    drawPlate();
    const submit = h('button', { class: 'btn btn-accent btn-lg btn-block mt' }, 'ثبت و ادامه');
    submit.onclick = () => busy(submit, async () => {
      const { driver } = await ctx.api.post('/driver/register', form);
      ctx.S.driver = driver;
      d.status = driver.status;
      step3();
    });
    frame(2,
      h('h2', {}, 'مشخصات وسیله نقلیه'),
      h('div', { class: 'field' }, h('label', {}, 'سرویس'), pick, blackNote),
      field('مدل', 'vehicle_model', { placeholder: 'مثلاً پژو ۲۰۶ (اکو) یا تویوتا کمری (بلک)' }),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, field('رنگ', 'vehicle_color', { placeholder: 'سفید / مشکی' })), h('div', { class: 'grow' }, field('سال ساخت', 'vehicle_year', { ltr: true, inputmode: 'numeric', placeholder: '۱۴۰۰' }))),
      plateBox,
      field('شماره شبا (اختیاری)', 'sheba', { ltr: true, placeholder: 'IR...', hint: 'برای واریز درآمد؛ بعداً هم قابل ثبت است' }),
      submit,
      h('button', { class: 'btn btn-ghost btn-block mt', onclick: step1 }, 'مرحله قبل'));
  }

  function step3() {
    const docs = ctx.S.driver?.documents || {};
    const rows = Object.entries(DOCS).map(([kind, label]) => {
      const status = h('span', { class: `badge ${docs[kind] ? 'green' : ''}` }, docs[kind] ? 'بارگذاری شد' : 'لازم');
      const input = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });
      const btn = h('button', { class: 'btn btn-sm', type: 'button', onclick: () => input.click() }, icon('upload'), docs[kind] ? 'تغییر' : 'انتخاب');
      input.onchange = () => busy(btn, async () => {
        const file = input.files[0];
        if (!file) return;
        const data = await shrinkImage(file);
        const { driver } = await ctx.api.post('/driver/documents', { kind, data });
        ctx.S.driver = driver;
        status.className = 'badge green';
        status.textContent = 'بارگذاری شد';
      });
      return h('div', { class: 'doc-row' }, h('span', { class: 'li-icon' }, icon('doc')), h('div', { class: 'grow' }, h('div', { class: 'bold' }, label), status), btn, input);
    });
    frame(3,
      h('h2', {}, 'بارگذاری مدارک'),
      h('p', { class: 'muted' }, 'از هر مدرک یک عکس واضح بگیرید. اطلاعات شما نزد نِنا محفوظ است.'),
      h('div', { class: 'card' }, rows),
      h('button', { class: 'btn btn-accent btn-lg btn-block mt', onclick: () => ctx.start().catch(toastError) }, 'ارسال برای بررسی'),
      h('button', { class: 'btn btn-ghost btn-block mt', onclick: step2 }, 'مرحله قبل'));
  }

  ({ 1: step1, 2: step2, 3: step3 })[step]();
}

// Resizes photos client-side so uploads stay small on mobile data.
function shrinkImage(file, max = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => reject(new Error('فایل تصویر قابل خواندن نیست'));
    img.src = URL.createObjectURL(file);
  });
}

// ---------------------------------------------------------------------------
// menu

export function openMenu(ctx) {
  const { S } = ctx;
  const drawer = h('nav', { class: 'drawer' });
  const backdrop = h('div', { class: 'drawer-backdrop' });
  const close = () => { drawer.classList.remove('open'); backdrop.classList.remove('open'); setTimeout(() => { drawer.remove(); backdrop.remove(); }, 250); };
  backdrop.onclick = close;
  const go = (fn) => () => { close(); fn(ctx); };
  mount(drawer,
    h('div', { class: 'drawer-head' }, avatar(S.user.name, 'lg'),
      h('div', {}, h('div', { class: 'bold' }, S.user.name), h('div', { class: 'row gap-sm small muted' }, ratingPill(S.driver.rating), `${fa.num(S.driver.rating_count)} امتیاز`))),
    h('div', { class: 'list' },
      listItem({ iconName: 'chart', title: 'درآمد', onclick: go(openEarnings) }),
      listItem({ iconName: 'calendar', title: 'رزروها', sub: 'سفرهای از پیش رزروشده را بپذیرید', onclick: go(openReservations) }),
      listItem({ iconName: 'history', title: 'سفرهای من', onclick: go(openTrips) }),
      listItem({ iconName: 'wallet', title: 'کیف پول و تسویه', onclick: go(openWallet) }),
      listItem({ iconName: 'star', title: 'امتیاز و عملکرد', onclick: go(openPerformance) }),
      listItem({ iconName: 'car', title: 'خودرو و مدارک', onclick: go(openVehicle) }),
      listItem({ iconName: 'bell', title: 'اعلان‌ها', sub: 'درخواست سفر حتی وقتی صفحه خاموش است', onclick: go((c) => openNotifications(c, { lines: DRIVER_PUSH_LINES })) }),
      isInstalled() ? null : listItem({ iconName: 'upload', title: 'نصب اپ رانندگان', onclick: go(openInstall) }),
      listItem({ iconName: 'help', title: 'پشتیبانی رانندگان', onclick: go(openSupport) }),
      listItem({ iconName: 'user', title: 'اپ مسافر', href: '/rider/' }),
      listItem({ iconName: 'logout', title: 'خروج', onclick: async () => { if (await confirmDialog('خروج', 'از حساب خارج می‌شوید و آفلاین خواهید شد.', { ok: 'خروج', danger: true })) ctx.logout(); } })));
  document.body.append(drawer, backdrop);
  requestAnimationFrame(() => { drawer.classList.add('open'); backdrop.classList.add('open'); });
}

export function openEarnings(ctx) {
  const p = page('درآمد');
  let range = 'today';
  const body = h('div', {});
  const tabs = h('div', { class: 'tabs' });
  const drawTabs = () => mount(tabs, [['today', 'امروز'], ['week', '۷ روز'], ['month', '۳۰ روز']].map(([k, l]) => h('button', { class: range === k ? 'active' : '', onclick: () => { range = k; drawTabs(); load(); } }, l)));
  drawTabs();
  const load = async () => {
    mount(body, h('div', { class: 'empty' }, h('span', { class: 'spinner' })));
    try {
      const e = await ctx.api.get(`/driver/earnings?range=${range}`);
      const max = Math.max(1, ...e.by_day.map((d) => d.earning));
      const stat = (label, value) => h('div', { class: 'stat' }, h('div', { class: 's-label' }, label), h('div', { class: 's-value', style: { fontSize: '18px' } }, value));
      mount(body,
        h('div', { class: 'center mt-lg' }, h('div', { class: 'muted small' }, 'مجموع درآمد'), h('div', { style: { fontSize: '36px', fontWeight: 900 } }, fa.toman(e.total))),
        e.by_day.length > 1 ? h('div', { class: 'bars mt' }, e.by_day.map((d, i) => h('div', { class: `bar ${i === e.by_day.length - 1 ? 'today' : ''}`, 'data-tip': `${fa.toman(d.earning)} • ${fa.num(d.trips)} سفر` },
          h('i', { style: { height: `${(d.earning / max) * 100}%` } }),
          h('small', {}, e.by_day.length <= 7 ? fa.jWeekday(d.date) : (i % 5 === 0 ? fa.faDigits(new Intl.DateTimeFormat('fa-IR-u-ca-persian', { day: 'numeric' }).format(d.date)) : ''))))) : null,
        h('div', { class: 'stats mt-lg' },
          stat('تعداد سفر', fa.num(e.trips)),
          stat('ساعت رانندگی', fa.num(e.drive_minutes / 60, 1)),
          stat('مسافت', fa.km(e.distance_km)),
          stat('انعام', fa.toman(e.tips)),
          stat('نقد دریافتی', fa.toman(e.cash_collected)),
          stat('کمیسیون نِنا', fa.toman(e.commission)),
          e.compensation ? stat('جبران لغو', fa.toman(e.compensation)) : null));
    } catch (err) { toastError(err); }
  };
  mount(p.body, tabs, body);
  load();
}

function openTrips(ctx) {
  const p = page('سفرهای من');
  ctx.api.get('/driver/rides').then(({ rides }) => {
    mount(p.body, rides.length ? h('div', { class: 'list' }, rides.map((r) => listItem({
      iconName: r.status === 'completed' ? 'check' : 'close',
      title: `${r.pickup.address || 'مبدأ'} ← ${r.dropoff.address || 'مقصد'}`,
      sub: `${fa.jDateTime(r.created_at)} • ${r.type_name}${r.rating_by_rider ? ` • ⭐ ${fa.num(r.rating_by_rider)}` : ''}`,
      end: h('div', { class: 'col gap-sm', style: { alignItems: 'flex-end' } },
        h('span', { class: 'bold small' }, r.status === 'completed' ? fa.toman(r.earning) : '—'),
        h('span', { class: `badge ${r.status === 'completed' ? 'green' : 'red'}` }, fa.STATUS_FA[r.status])),
    }))) : h('div', { class: 'empty' }, icon('history'), h('p', {}, 'هنوز سفری انجام نداده‌اید')));
  }).catch(toastError);
}

const TX_FA = {
  ride_earning: 'تسویه سفر', tip: 'انعام', cancel_compensation: 'جبران لغو سفر', payout: 'برداشت', payout_refund: 'برگشت برداشت',
  topup: 'پرداخت بدهی / شارژ', adjustment: 'اصلاح موجودی', referral: 'هدیه', ride_payment: 'پرداخت سفر', cancel_fee: 'هزینه لغو', debt_settled: 'تسویه بدهی',
};

function openWallet(ctx) {
  const p = page('کیف پول و تسویه');
  const render = async () => {
    const w = await ctx.api.get('/driver/wallet');
    const debt = w.balance < 0;
    const sheba = h('input', { class: 'input ltr-input', placeholder: 'IR000000000000000000000000', value: w.sheba || '' });
    const saveSheba = h('button', { class: 'btn' }, 'ذخیره');
    saveSheba.onclick = () => busy(saveSheba, async () => { await ctx.api.post('/driver/sheba', { sheba: fa.enDigits(sheba.value) }); toast('شماره شبا ثبت شد', 'success'); render(); });
    const amount = h('input', { class: 'input ltr-input', inputmode: 'numeric', value: debt ? '' : String(Math.max(0, w.balance)) });
    const action = h('button', { class: 'btn btn-accent btn-lg btn-block mt' }, debt ? 'پرداخت بدهی' : 'درخواست تسویه');
    action.onclick = () => busy(action, async () => {
      const v = Number(fa.enDigits(amount.value).replace(/\D/g, ''));
      if (debt) {
        const { url } = await ctx.api.post('/driver/wallet/topup', { amount: v || -w.balance });
        location.href = url;
      } else {
        await ctx.api.post('/driver/payouts', { amount: v });
        toast('درخواست تسویه ثبت شد؛ ظرف ۲۴ ساعت کاری واریز می‌شود', 'success');
        render();
      }
    });
    mount(p.body,
      h('div', { class: 'card', style: { background: debt ? 'var(--danger-soft)' : 'var(--accent-soft)' } },
        h('div', { class: 'small muted' }, debt ? 'بدهی شما به نِنا (کمیسیون سفرهای نقدی)' : 'قابل برداشت'),
        h('div', { style: { fontSize: '30px', fontWeight: 900 } }, fa.toman(Math.abs(w.balance)))),
      h('div', { class: 'field mt' }, h('label', {}, debt ? 'مبلغ پرداخت (تومان)' : `مبلغ برداشت (حداقل ${fa.toman(w.min_payout)})`), amount),
      action,
      h('h3', { class: 'mt-lg' }, 'حساب بانکی'),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, sheba), saveSheba),
      w.payouts.length ? [h('h3', { class: 'mt-lg' }, 'درخواست‌های تسویه'), h('div', { class: 'list' }, w.payouts.map((po) => listItem({
        iconName: 'money', title: fa.toman(po.amount), sub: fa.jDateTime(po.created_at),
        end: h('span', { class: `badge ${po.status === 'paid' ? 'green' : po.status === 'rejected' ? 'red' : 'yellow'}` }, { pending: 'در انتظار', paid: 'واریز شد', rejected: 'رد شد' }[po.status]),
      })))] : null,
      h('h3', { class: 'mt-lg' }, 'تراکنش‌ها'),
      w.transactions.length ? h('div', { class: 'list' }, w.transactions.map((t) => listItem({
        iconName: t.amount > 0 ? 'plus' : 'minus', title: TX_FA[t.type] || t.type, sub: fa.jDateTime(t.created_at),
        end: h('span', { class: 'bold small', style: { direction: 'ltr', color: t.amount > 0 ? 'var(--accent)' : 'var(--fg)' } }, `${t.amount > 0 ? '+' : '−'}${fa.num(Math.abs(t.amount), 0)}`),
      }))) : h('div', { class: 'empty' }, 'تراکنشی ندارید'));
  };
  render().catch(toastError);
}

function openPerformance(ctx) {
  const p = page('امتیاز و عملکرد');
  const d = ctx.S.driver;
  mount(p.body,
    h('div', { class: 'center' }, h('div', { style: { fontSize: '48px', fontWeight: 900 } }, fa.num(d.rating, 2)), h('div', { class: 'muted' }, `بر اساس ${fa.num(d.rating_count)} امتیاز مسافران`)),
    h('div', { class: 'stats mt-lg' },
      h('div', { class: 'stat' }, h('div', { class: 's-label' }, 'نرخ پذیرش'), h('div', { class: 's-value' }, `${fa.num(d.acceptance_rate)}٪`)),
      h('div', { class: 'stat' }, h('div', { class: 's-label' }, 'امتیاز'), h('div', { class: 's-value' }, fa.num(d.rating, 2)))),
    h('div', { class: 'card mt-lg' },
      h('div', { class: 'bold' }, 'نکات افزایش امتیاز'),
      h('ul', { class: 'muted small' }, h('li', {}, 'خودرو را تمیز و خوشبو نگه دارید'), h('li', {}, 'پیش از حرکت مسیر را با مسافر هماهنگ کنید'), h('li', {}, 'قوانین راهنمایی و رانندگی را رعایت کنید'), h('li', {}, 'درخواست‌ها را سریع بپذیرید و کمتر لغو کنید'))));
}

function openVehicle(ctx) {
  const p = page('خودرو و مدارک');
  const d = ctx.S.driver;
  mount(p.body,
    h('div', { class: 'card row' }, h('div', { style: { width: '64px', height: '40px' } }, vehicleArt({ bike: 'bike', van: 'van', black: 'car-black' }[d.vehicle_type] || 'car')),
      h('div', { class: 'grow' }, h('div', { class: 'bold' }, `${d.vehicle_model} ${d.vehicle_color}`), h('div', { class: 'muted small' }, `${fa.VEHICLE_FA[d.vehicle_type]} • مدل ${fa.faDigits(d.vehicle_year)}`)),
      plateEl(d.plate)),
    h('h3', { class: 'mt-lg' }, 'مدارک'),
    h('div', { class: 'card' }, Object.entries(DOCS).map(([k, label]) => h('div', { class: 'doc-row' }, h('span', { class: 'li-icon' }, icon('doc')), h('div', { class: 'grow bold' }, label), h('span', { class: `badge ${d.documents[k] ? 'green' : 'red'}` }, d.documents[k] ? 'تأیید شده' : 'ناقص')))),
    h('p', { class: 'muted small mt' }, 'برای تغییر خودرو یا مدارک حساب فعال، با پشتیبانی رانندگان تماس بگیرید.'),
    h('a', { class: 'btn btn-block mt', href: `tel:${ctx.S.cfg.support_phone}` }, icon('phone'), 'تماس با پشتیبانی'));
}

function openSupport(ctx) {
  const p = page('پشتیبانی رانندگان');
  const faq = [
    ['کمیسیون نِنا چقدر است؟', 'کمیسیون بسته به نوع سرویس بین ۱۲ تا ۱۵ درصد کرایه است و در جزئیات هر سفر نمایش داده می‌شود.'],
    ['تسویه حساب چگونه انجام می‌شود؟', 'از بخش کیف پول درخواست تسویه دهید. مبلغ ظرف ۲۴ ساعت کاری به حساب شبای ثبت‌شده واریز می‌شود.'],
    ['بدهی من از کجا آمده؟', 'در سفرهای نقدی کل کرایه را دریافت می‌کنید و کمیسیون نِنا به‌صورت بدهی ثبت می‌شود و از درآمدهای کیف پول کسر می‌گردد.'],
    ['مسافر نیامد، چه کنم؟', 'پس از چند دقیقه انتظار در مبدأ، گزینه «مسافر نیامد» فعال می‌شود و هزینه لغو به شما تعلق می‌گیرد.'],
  ];
  mount(p.body,
    h('a', { class: 'btn btn-primary btn-lg btn-block', href: `tel:${ctx.S.cfg.support_phone}` }, icon('phone'), 'تماس با پشتیبانی'),
    faq.map(([q, a]) => h('details', { class: 'card mt' }, h('summary', { class: 'bold', style: { cursor: 'pointer' } }, q), h('p', { class: 'muted mt' }, a))));
}

// ---------------------------------------------------------------------------
// reservations (rides booked in advance)

export function openReservations(ctx, tab = 'open') {
  const p = page('رزروها');
  const tabs = h('div', { class: 'tabs' });
  const body = h('div', { class: 'mt' });
  const drawTabs = (counts = {}) => mount(tabs, [['open', `رزروهای باز${counts.open != null ? ` (${fa.num(counts.open)})` : ''}`], ['mine', `رزروهای من${counts.mine != null ? ` (${fa.num(counts.mine)})` : ''}`]]
    .map(([k, l]) => h('button', { class: tab === k ? 'active' : '', onclick: () => { tab = k; render(); } }, l)));
  const card = (r, mine) => {
    const btn = h('button', { class: `btn btn-sm ${mine ? 'btn-danger-soft' : 'btn-accent'}` }, mine ? 'انصراف' : 'پذیرش رزرو');
    btn.onclick = async () => {
      if (mine && !(await confirmDialog('انصراف از رزرو', 'رزرو به رانندگان دیگر سپرده می‌شود. انصراف‌های مکرر بر امتیاز شما اثر دارد.', { ok: 'انصراف', danger: true }))) return;
      busy(btn, async () => {
        await ctx.api.post(`/driver/reservations/${r.id}/${mine ? 'release' : 'claim'}`);
        toast(mine ? 'از رزرو انصراف دادید' : `رزرو ${fa.jWeekday(r.scheduled_at)} ساعت ${fa.jTime(r.scheduled_at)} برای شما ثبت شد`, mine ? '' : 'success');
        render();
        ctx.refreshIdle?.();
      });
    };
    return h('div', { class: 'card mb' },
      h('div', { class: 'row between' },
        h('div', {}, h('div', { class: 'bold', style: { fontSize: '18px' } }, `${fa.jWeekday(r.scheduled_at)} ${fa.jDateShort(r.scheduled_at)}`),
          h('div', { class: 'muted small' }, `ساعت ${fa.jTime(r.scheduled_at)} • ${r.type_name}${r.pickup_distance_km != null ? ` • ${fa.km(r.pickup_distance_km)} از شما` : ''}`)),
        h('div', { style: { textAlign: 'left' } }, h('div', { class: 'bold', style: { color: 'var(--accent)' } }, fa.toman(r.estimated_earning)), h('div', { class: 'tiny muted' }, 'درآمد شما'))),
      h('div', { class: 'list mt' },
        listItem({ iconName: 'dot', title: r.pickup.address || 'مبدأ', sub: 'مبدأ' }),
        listItem({ iconName: 'pin', title: r.dropoff.address || 'مقصد', sub: `${fa.km(r.distance_km)} • حدود ${fa.minutes(r.duration_min)}` })),
      h('div', { class: 'row between mt' }, h('span', { class: 'small row gap-sm' }, ratingPill(r.rider.rating), r.rider.name || 'مسافر'), btn));
  };
  async function render() {
    drawTabs();
    mount(body, h('div', { class: 'empty' }, h('span', { class: 'spinner' })));
    try {
      const { open, mine } = await ctx.api.get('/driver/reservations');
      drawTabs({ open: open.length, mine: mine.length });
      const list = tab === 'open' ? open : mine;
      mount(body,
        tab === 'mine' && mine.length ? h('div', { class: 'policy mb' },
          h('div', {}, icon('clock'), 'کمی قبل از زمان سفر، سفر خودکار برای شما شروع می‌شود؛ در آن زمان آنلاین و آزاد باشید.'),
          h('div', {}, icon('bell'), 'یک ساعت قبل یادآوری دریافت می‌کنید.')) : null,
        list.length ? list.map((r) => card(r, tab === 'mine')) : h('div', { class: 'empty' }, icon('calendar'),
          h('p', {}, tab === 'open' ? 'فعلاً رزرو بازی در نزدیکی شما نیست' : 'رزروی ندارید؛ از «رزروهای باز» یکی را بپذیرید')));
    } catch (err) { mount(body, h('div', { class: 'empty' }, err.message)); }
  }
  mount(p.body, tabs, body);
  render();
}
