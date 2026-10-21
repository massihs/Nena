import { h, modal, icon, toast, shareLink, busy } from './ui.js';
import { getPosition } from './map.js';

// Safety toolkit: emergency numbers, SOS alert to Nena support, trip sharing.
export function openSafety({ api, ride, shareUrl, emergencyContact, supportPhone }) {
  modal((close) => {
    const sos = h('button', { class: 'btn btn-danger btn-lg btn-block' }, icon('sos'), 'ارسال هشدار اضطراری به نِنا');
    sos.onclick = () => busy(sos, async () => {
      const pos = await getPosition({ timeout: 4000 });
      await api.post(`/rides/${ride.id}/sos`, pos || {});
      toast('هشدار ارسال شد؛ تیم پشتیبانی فوراً با شما تماس می‌گیرد', 'success');
    });
    return h('div', {},
      h('div', { class: 'row' }, h('span', { class: 'li-icon', style: { color: 'var(--danger)' } }, icon('shield')), h('h3', { style: { margin: 0 } }, 'ایمنی سفر')),
      h('p', { class: 'muted small mt' }, 'در شرایط خطر ابتدا با پلیس تماس بگیرید. موقعیت سفر شما برای پشتیبانی نِنا ثبت می‌شود.'),
      h('div', { class: 'col mt' },
        h('a', { class: 'btn btn-danger btn-lg btn-block', href: 'tel:110' }, icon('phone'), 'تماس با پلیس ۱۱۰'),
        sos,
        h('a', { class: 'btn btn-lg btn-block', href: 'tel:115' }, 'اورژانس ۱۱۵'),
        shareUrl ? h('button', { class: 'btn btn-lg btn-block', onclick: () => shareLink('سفر من با نِنا', 'موقعیت زنده سفر من:', shareUrl) }, icon('share'), 'اشتراک موقعیت زنده سفر') : null,
        emergencyContact && shareUrl
          ? h('a', { class: 'btn btn-lg btn-block', href: `sms:${emergencyContact}?body=${encodeURIComponent(`من در سفر با نِنا هستم. موقعیت زنده: ${shareUrl}`)}` }, icon('chat'), 'پیامک به مخاطب اضطراری')
          : null,
        supportPhone ? h('a', { class: 'btn btn-ghost btn-block', href: `tel:${supportPhone}` }, 'تماس با پشتیبانی نِنا') : null,
        h('button', { class: 'btn btn-ghost btn-block', onclick: close }, 'بستن')));
  });
}

