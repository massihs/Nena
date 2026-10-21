import { config } from '../config.js';

export async function sendOtp(phone, code) {
  if (config.sms.provider === 'kavenegar') {
    const url = new URL(`https://api.kavenegar.com/v1/${config.sms.kavenegarKey}/verify/lookup.json`);
    url.searchParams.set('receptor', phone);
    url.searchParams.set('token', code);
    url.searchParams.set('template', config.sms.kavenegarTemplate);
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Kavenegar error ${res.status}`);
    return;
  }
  console.log(`[sms:mock] OTP for ${phone}: ${code}`);
}
