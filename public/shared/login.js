import { h, mount, busy, toast } from './ui.js';
import { enDigits, faDigits } from './fa.js';

// Phone + SMS-code login used by all three apps.
export function renderLogin(root, api, { title, subtitle, onDone, footer }) {
  let phone = '';

  function phoneStep() {
    const input = h('input', {
      class: 'input ltr-input', type: 'tel', inputmode: 'numeric', autocomplete: 'tel', placeholder: '۰۹۱۲ ۳۴۵ ۶۷۸۹', value: phone,
    });
    const btn = h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'submit' }, 'ادامه');
    const form = h('form', {
      onsubmit: (e) => {
        e.preventDefault();
        busy(btn, async () => {
          phone = enDigits(input.value);
          const res = await api.post('/auth/otp', { phone });
          phone = res.phone;
          codeStep(res.dev_code);
        });
      },
    },
    h('div', { class: 'field' }, h('label', {}, 'شماره موبایل'), input),
    btn,
    h('p', { class: 'hint mt' }, 'با ورود به نِنا، شرایط استفاده و حریم خصوصی را می‌پذیرید.'));
    mount(root, h('div', { class: 'auth card' },
      h('div', { class: 'logo' }, 'نِنا'),
      h('h2', {}, title), h('p', { class: 'muted' }, subtitle), h('div', { class: 'mt' }, form), footer || null));
    setTimeout(() => input.focus(), 50);
  }

  function codeStep(devCode) {
    const input = h('input', { class: 'input otp-input', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 5 });
    const btn = h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'submit' }, 'ورود');
    const resend = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', disabled: true });
    let left = 60;
    const tick = () => {
      resend.textContent = left > 0 ? `ارسال مجدد کد تا ${faDigits(left)} ثانیه` : 'ارسال مجدد کد';
      resend.disabled = left > 0;
      if (left-- > 0) timer = setTimeout(tick, 1000);
    };
    let timer;
    tick();
    resend.onclick = () => busy(resend, async () => {
      const res = await api.post('/auth/otp', { phone });
      toast('کد جدید ارسال شد');
      if (res.dev_code) input.value = res.dev_code;
      left = 60; tick();
    });

    const submit = () => busy(btn, async () => {
      const res = await api.post('/auth/verify', { phone, code: enDigits(input.value) });
      clearTimeout(timer);
      api.setToken(res.token);
      await onDone(res);
    });
    input.addEventListener('input', () => { if (enDigits(input.value).length === 5) submit(); });

    mount(root, h('div', { class: 'auth card' },
      h('div', { class: 'logo' }, 'نِنا'),
      h('h2', {}, 'کد تأیید را وارد کنید'),
      h('p', { class: 'muted' }, `کد ۵ رقمی به شماره ${faDigits(phone)} پیامک شد.`),
      devCode ? h('p', { class: 'badge yellow' }, `محیط آزمایشی — کد: ${faDigits(devCode)}`) : null,
      h('form', { class: 'mt', onsubmit: (e) => { e.preventDefault(); submit(); } },
        h('div', { class: 'field' }, input), btn),
      h('div', { class: 'row between mt' },
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { clearTimeout(timer); phoneStep(); } }, 'ویرایش شماره'),
        resend)));
    if (devCode) input.value = devCode;
    setTimeout(() => input.focus(), 50);

    // Android Chrome can read the SMS code automatically.
    if ('OTPCredential' in window) {
      navigator.credentials.get({ otp: { transport: ['sms'] } })
        .then((otp) => { if (otp?.code) { input.value = otp.code; submit(); } })
        .catch(() => {});
    }
  }

  phoneStep();
}
