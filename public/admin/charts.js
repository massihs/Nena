// Small chart kit for the admin panel: thin rounded bars on a baseline, hover tooltips,
// direct labels, recessive axes. Colors come from CSS custom properties in admin.css.
import { h } from '/shared/ui.js';
import * as fa from '/shared/fa.js';

// Vertical bar chart for one measure over time or categories.
export function barChart(data, { format = (v) => fa.num(v, 0), height = 170, labelEvery = 1, highlight = -1, unit = '' } = {}) {
  const max = Math.max(...data.map((d) => d.value), 0);
  const top = niceMax(max);
  const grid = [1, 0.5].map((k) => h('div', { class: 'vz-grid', style: { bottom: `${k * 100}%` } }, h('span', {}, format(top * k))));
  return h('div', { class: 'vz-bars-wrap' },
    unit ? h('div', { class: 'vz-unit' }, unit) : null,
    h('div', { class: 'vz-bars', style: { height: `${height}px` } },
      grid,
      data.map((d, i) => h('div', {
        class: `vz-bar ${i === highlight ? 'hl' : ''}`,
        tabindex: '0',
        'data-tip': d.tip || `${d.label}: ${format(d.value)}`,
        'aria-label': d.tip || `${d.label}: ${format(d.value)}`,
      },
      h('i', { style: { height: top ? `${(d.value / top) * 100}%` : '0' } })))),
    h('div', { class: 'vz-xlabels' }, data.map((d, i) => h('span', {}, i % labelEvery === 0 ? d.label : ''))));
}

// Rounds up to 1, 2 or 5 × 10^n so gridline labels are readable.
function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 5, 10].map((m) => m * p).find((m) => m >= v);
}

// Compares series (e.g. services) across several measures, each scaled on its own.
export function comparison(measures, series) {
  return h('div', { class: 'vz-compare' },
    h('div', { class: 'vz-legend' }, series.map((s, i) => h('span', {}, h('i', { style: { background: `var(--viz-${i + 1})` } }), s.name))),
    measures.map((m) => {
      const max = Math.max(...series.map((s) => m.value(s)), 0) || 1;
      return h('div', { class: 'vz-measure' },
        h('div', { class: 'vz-mlabel' }, m.label),
        series.map((s, i) => h('div', { class: 'vz-hrow', 'data-tip': `${s.name} — ${m.label}: ${m.format(m.value(s))}` },
          h('span', { class: 'vz-hname' }, s.name),
          h('span', { class: 'vz-htrack' }, h('i', { style: { width: `${(m.value(s) / max) * 100}%`, background: `var(--viz-${i + 1})` } })),
          h('span', { class: 'vz-hval' }, m.format(m.value(s))))));
    }));
}

// Ordered stages (request → accepted → completed) on the sequential blue ramp.
export function funnel(steps) {
  const first = steps[0]?.value || 0;
  return h('div', { class: 'vz-funnel' }, steps.map((s, i) => h('div', { class: 'vz-fstep' },
    h('div', { class: 'vz-flabel' }, s.label),
    h('div', { class: 'vz-ftrack' }, h('i', { class: `ramp-${i}`, style: { width: first ? `${Math.max(2, (s.value / first) * 100)}%` : '0' } })),
    h('div', { class: 'vz-fval' }, fa.num(s.value, 0), h('small', {}, first ? ` (${fa.num((s.value / first) * 100, 0)}٪)` : '')))));
}

// Share of a whole split in two (cash vs wallet), with labels on both sides.
export function split(a, b) {
  const total = a.value + b.value;
  const pa = total ? (a.value / total) * 100 : 50;
  return h('div', { class: 'vz-split' },
    h('div', { class: 'vz-strack' }, h('i', { class: 'a', style: { width: `${pa}%` } }), h('i', { class: 'b', style: { width: `${100 - pa}%` } })),
    h('div', { class: 'row between small' },
      h('span', {}, h('b', {}, a.label), ` ${fa.toman(a.value)} (${fa.num(pa, 0)}٪)`),
      h('span', {}, h('b', {}, b.label), ` ${fa.toman(b.value)} (${fa.num(100 - pa, 0)}٪)`)));
}

// KPI tile with change versus the previous period. `lowerIsBetter` flips the good/bad reading.
export function kpi(label, value, { current, previous, sub, lowerIsBetter = false, title } = {}) {
  let delta = null;
  if (current != null && previous != null) {
    if (!previous) delta = current ? h('span', { class: 'vz-delta new' }, 'جدید') : null;
    else {
      const pct = ((current - previous) / Math.abs(previous)) * 100;
      const good = lowerIsBetter ? pct <= 0 : pct >= 0;
      delta = h('span', { class: `vz-delta ${Math.abs(pct) < 0.5 ? '' : good ? 'good' : 'bad'}` },
        `${pct >= 0 ? '▲' : '▼'} ${fa.num(Math.abs(pct), 0)}٪`);
    }
  }
  return h('div', { class: 'stat vz-kpi', title: title || null },
    h('div', { class: 's-label' }, label),
    h('div', { class: 's-value' }, value),
    h('div', { class: 'row gap-sm tiny muted' }, delta, sub ? h('span', {}, sub) : null));
}

// Blue ramp (light → dark) for multipliers between 1 and max.
const RAMP = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
export function rampColor(value, min, max) {
  const k = Math.max(0, Math.min(1, (value - min) / ((max - min) || 1)));
  return RAMP[Math.min(RAMP.length - 1, Math.floor(k * RAMP.length))];
}
export const RAMP_COLORS = RAMP;
