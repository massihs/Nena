import { h, mount, icon, toastError } from '/shared/ui.js';
import * as fa from '/shared/fa.js';
import { barChart, comparison, funnel, split, kpi } from './charts.js';

const PERIODS = [[1, 'امروز'], [7, '۷ روز'], [30, '۳۰ روز'], [90, '۹۰ روز']];
const pct = (v) => `${fa.num(v, 1)}٪`;
// Compact money for KPI tiles ("۴۱۲٫۲ میلیون تومان"); the exact amount shows on hover.
const money = (v) => (Math.abs(v) >= 1e6 ? `${fa.num(v / 1e6, 1)} میلیون تومان` : fa.toman(v));

export async function economicsPage(ctx, days = ctx.S.econDays || 30) {
  ctx.S.econDays = days;
  const main = ctx.S.main;
  const tabs = h('div', { class: 'tabs', style: { maxWidth: '420px' } }, PERIODS.map(([d, l]) =>
    h('button', { class: d === days ? 'active' : '', onclick: () => economicsPage(ctx, d).catch(toastError) }, l)));
  mount(main, h('div', { class: 'row between wrap' }, h('h1', { style: { margin: 0 } }, 'اقتصاد و درآمد'), tabs), h('div', { class: 'empty' }, h('span', { class: 'spinner' })));

  const e = await ctx.api.get(`/admin/economics?days=${days}`);
  const c = e.current, p = e.previous;
  const vs = (k) => ({ current: c[k], previous: p[k] });
  const periodLabel = days === 1 ? 'دیروز' : `${fa.num(days)} روز قبل از آن`;

  // Daily series need at least two days; for "today" show the hourly profile only.
  const dayLabel = (d) => fa.faDigits(new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', day: 'numeric', month: 'numeric' }).format(d.date));
  const every = days > 30 ? 10 : days > 7 ? 5 : 1;
  const dailyChart = (key, format) => barChart(e.daily.map((d) => ({
    label: dayLabel(d), value: d[key], tip: `${fa.jDateShort(d.date)}: ${format(d[key])}`,
  })), { format: key === 'trips' || key === 'requests' ? (v) => fa.num(v, 0) : fa.tomanShort, labelEvery: every, highlight: e.daily.length - 1 });

  const hourChart = barChart(e.hourly.map((x) => ({
    label: fa.faDigits(x.hour), value: x.requests,
    tip: `ساعت ${fa.faDigits(x.hour)} تا ${fa.faDigits((x.hour + 1) % 24)}: ${fa.num(x.requests)} درخواست، ${fa.num(x.completed)} سفر انجام‌شده`,
  })), { labelEvery: 3 });

  const services = e.services.filter((s) => s.active || s.trips);
  const card = (title, body, extra) => h('div', { class: 'card' }, h('div', { class: 'row between' }, h('h3', {}, title), extra || null), body);

  const csv = () => {
    const rows = [['date', 'requests', 'trips', 'gmv_toman', 'net_revenue_toman'], ...e.daily.map((d) => [new Date(d.date + 3.5 * 3600e3).toISOString().slice(0, 10), d.requests, d.trips, d.gmv, d.net_revenue])];
    const blob = new Blob(['﻿' + rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `nena-economics-${days}d.csv` });
    a.click();
    URL.revokeObjectURL(a.href);
  };

  mount(main,
    h('div', { class: 'row between wrap' },
      h('h1', { style: { margin: 0 } }, 'اقتصاد و درآمد'),
      h('div', { class: 'row' }, tabs, h('button', { class: 'btn btn-sm', onclick: csv }, icon('doc'), 'خروجی CSV'))),
    h('p', { class: 'muted small mt' }, `از ${fa.jDate(e.from)} تا امروز — درصدها در مقایسه با ${periodLabel}`),

    h('div', { class: 'section-title' }, h('h2', {}, 'درآمد')),
    h('div', { class: 'stats' },
      kpi('ارزش ناخالص سفرها (GMV)', money(c.gmv), { ...vs('gmv'), title: fa.toman(c.gmv) }),
      kpi('درآمد خالص نِنا', money(c.net_revenue), { ...vs('net_revenue'), title: fa.toman(c.net_revenue), sub: `کمیسیون − تخفیف` }),
      kpi('کمیسیون', money(c.commission), { ...vs('commission'), title: fa.toman(c.commission), sub: `نرخ برداشت ${pct(c.take_rate)}` }),
      kpi('هزینه تخفیف‌ها', money(c.discounts), { ...vs('discounts'), title: fa.toman(c.discounts), lowerIsBetter: true }),
      kpi('درآمد رانندگان', money(c.driver_earnings), { ...vs('driver_earnings'), title: fa.toman(c.driver_earnings), sub: `شامل ${fa.toman(c.tips)} انعام` }),
      kpi('میانگین کرایه', money(c.avg_fare), { ...vs('avg_fare'), title: fa.toman(c.avg_fare) })),

    h('div', { class: 'section-title' }, h('h2', {}, 'عملکرد')),
    h('div', { class: 'stats' },
      kpi('سفرهای انجام‌شده', fa.num(c.trips), vs('trips')),
      kpi('درخواست‌ها', fa.num(c.requests), vs('requests')),
      kpi('نرخ تکمیل', pct(c.completion_rate), vs('completion_rate')),
      kpi('نرخ لغو', pct(c.cancel_rate), { ...vs('cancel_rate'), lowerIsBetter: true }),
      kpi('بدون راننده', fa.num(c.no_driver), { ...vs('no_driver'), lowerIsBetter: true }),
      kpi('مسافران فعال', fa.num(c.active_riders), { ...vs('active_riders'), sub: `${fa.num(c.new_riders)} کاربر جدید` }),
      kpi('رانندگان فعال', fa.num(c.active_drivers), { ...vs('active_drivers'), sub: `${fa.num(c.new_drivers)} ثبت‌نام جدید` }),
      kpi('مسافت طی‌شده', fa.km(c.distance_km), vs('distance_km'))),

    days > 1 ? h('div', { class: 'grid-cards mt-lg' },
      card('ارزش ناخالص روزانه', dailyChart('gmv', fa.toman)),
      card('درآمد خالص روزانه نِنا', dailyChart('net_revenue', fa.toman)),
      card('سفرهای انجام‌شده در روز', dailyChart('trips', fa.num)),
      card('درخواست‌ها بر اساس ساعت روز', hourChart)) : h('div', { class: 'grid-cards mt-lg' }, card('درخواست‌ها بر اساس ساعت روز', hourChart)),

    h('div', { class: 'grid-cards mt-lg' },
      card('مقایسه سرویس‌ها', services.length ? comparison([
        { label: 'سفرهای انجام‌شده', value: (s) => s.trips, format: (v) => fa.num(v, 0) },
        { label: 'ارزش ناخالص', value: (s) => s.gmv, format: fa.toman },
        { label: 'درآمد خالص نِنا', value: (s) => s.net_revenue, format: fa.toman },
        { label: 'میانگین کرایه', value: (s) => s.avg_fare, format: fa.toman },
      ], services) : h('div', { class: 'empty' }, 'هنوز سفری ثبت نشده است')),
      card('قیف سفر', h('div', {},
        funnel([{ label: 'درخواست', value: c.requests }, { label: 'پذیرش راننده', value: c.accepted }, { label: 'انجام‌شده', value: c.trips }]),
        h('div', { class: 'row wrap small muted mt' },
          h('span', {}, `لغو: ${fa.num(c.cancelled)}`), h('span', {}, `بدون راننده: ${fa.num(c.no_driver)}`),
          h('span', {}, `هزینه لغو دریافتی: ${fa.toman(c.cancel_fees)}`)))),
      card('اثر افزایش قیمت', h('div', {},
        h('div', { class: 'stats' },
          kpi('سفرهای با ضریب', `${fa.num(c.surge_trips)}`, { sub: c.trips ? pct((c.surge_trips / c.trips) * 100) : '' }),
          kpi('درآمد اضافه از ضریب', money(c.surge_extra), { ...vs('surge_extra'), title: fa.toman(c.surge_extra) }),
          kpi('میانگین ضریب', `×${fa.num(c.avg_surge, 2)}`)),
        h('p', { class: 'tiny muted mt' }, 'درآمد اضافه = کرایه با ضریب − همان کرایه بدون ضریب.'),
        services.length > 1 ? h('div', { class: 'small mt' }, services.map((s) => h('div', { class: 'kv' }, h('span', {}, s.name), h('span', {}, `میانگین ×${fa.num(s.avg_surge, 2)}`)))) : null,
        h('a', { class: 'btn btn-sm mt', href: '#surge' }, icon('fire'), 'مدیریت افزایش قیمت'))),
      card('جریان پول', h('div', {},
        h('div', { class: 'small bold mb' }, 'روش پرداخت سفرها'),
        split({ label: 'نقدی', value: c.cash }, { label: 'کیف پول', value: c.wallet }),
        h('div', { class: 'divider' }),
        h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'شارژ کیف پول (ورودی)'), h('span', { class: 'bold' }, fa.toman(c.topups))),
        h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'تسویه واریزشده به رانندگان'), h('span', { class: 'bold' }, fa.toman(c.payouts_paid))),
        h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'هزینه توقف دریافتی'), h('span', { class: 'bold' }, fa.toman(c.wait_fees))),
        h('div', { class: 'divider' }),
        h('div', { class: 'small bold mb' }, 'مانده حساب‌ها (هم‌اکنون)'),
        h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'بدهی رانندگان به نِنا (کمیسیون نقدی)'), h('span', { class: 'bold' }, fa.toman(e.balances.driver_debt))),
        h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'طلب رانندگان از نِنا'), h('span', { class: 'bold' }, fa.toman(e.balances.owed_to_drivers))),
        h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'تسویه‌های در انتظار'), h('span', { class: 'bold' }, fa.toman(e.balances.pending_payouts))),
        h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'اعتبار کیف پول مسافران'), h('span', { class: 'bold' }, fa.toman(e.balances.rider_wallets))),
        h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'بدهی مسافران (هزینه لغو)'), h('span', { class: 'bold' }, fa.toman(e.balances.rider_debt)))))),

    h('div', { class: 'section-title' }, h('h2', {}, 'برترین رانندگان دوره')),
    h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['راننده', 'سرویس', 'سفر', 'درآمد', 'امتیاز'].map((x) => h('th', {}, x)))),
      h('tbody', {}, e.top_drivers.length ? e.top_drivers.map((d) => h('tr', {},
        h('td', { class: 'bold' }, d.name), h('td', {}, fa.VEHICLE_FA[d.vehicle_type] || d.vehicle_type), h('td', {}, fa.num(d.trips)),
        h('td', {}, fa.toman(d.earnings)), h('td', {}, fa.num(d.rating, 2))))
        : h('tr', {}, h('td', { colspan: 5, class: 'empty' }, 'سفری در این دوره انجام نشده است'))))),

    days > 1 ? h('details', { class: 'card mt-lg' },
      h('summary', { class: 'bold', style: { cursor: 'pointer' } }, 'جدول روزانه'),
      h('div', { class: 'table-wrap mt' }, h('table', {},
        h('thead', {}, h('tr', {}, ['روز', 'درخواست', 'سفر', 'ارزش ناخالص', 'درآمد خالص'].map((x) => h('th', {}, x)))),
        h('tbody', {}, [...e.daily].reverse().map((d) => h('tr', {},
          h('td', {}, `${fa.jWeekday(d.date)} ${fa.jDateShort(d.date)}`), h('td', {}, fa.num(d.requests)), h('td', {}, fa.num(d.trips)),
          h('td', {}, fa.toman(d.gmv)), h('td', {}, fa.toman(d.net_revenue)))))))) : null);
}
