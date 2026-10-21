import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { db, tx } from '../db.js';
import { HttpError, now } from '../util.js';
import { addTx } from './wallet.js';

const zarinpalHost = () => (config.payment.zarinpalSandbox ? 'sandbox.zarinpal.com' : 'payment.zarinpal.com');

// Starts a wallet top-up; returns the gateway URL the browser should open.
export async function createPayment(userId, amount, returnApp = 'rider') {
  const { lastInsertRowid: id } = db.prepare('INSERT INTO payments (user_id, amount, return_app, created_at) VALUES (?, ?, ?, ?)')
    .run(userId, amount, returnApp === 'driver' ? 'driver' : 'rider', now());

  if (config.payment.provider === 'zarinpal') {
    const res = await fetch(`https://${zarinpalHost()}/pg/v4/payment/request.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        merchant_id: config.payment.zarinpalMerchant,
        amount: amount * 10, // gateway works in rials
        description: `شارژ کیف پول نِنا #${id}`,
        callback_url: `${config.publicUrl}/api/pay/callback`,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    if (data.data?.code !== 100) throw new HttpError(502, 'اتصال به درگاه پرداخت ناموفق بود');
    db.prepare('UPDATE payments SET authority = ? WHERE id = ?').run(data.data.authority, id);
    return { url: `https://${zarinpalHost()}/pg/StartPay/${data.data.authority}` };
  }

  const authority = `MOCK${id}${randomBytes(6).toString('hex')}`;
  db.prepare('UPDATE payments SET authority = ? WHERE id = ?').run(authority, id);
  return { url: `/api/pay/mock/${authority}` };
}

// Handles the gateway callback. Idempotent: a payment is credited at most once.
export async function verifyPayment(authority, status) {
  const payment = db.prepare('SELECT * FROM payments WHERE authority = ?').get(String(authority || ''));
  if (!payment) throw new HttpError(404, 'تراکنش یافت نشد');
  if (payment.status !== 'pending') return payment;

  let refId = null;
  if (status === 'OK') {
    if (config.payment.provider === 'zarinpal') {
      const res = await fetch(`https://${zarinpalHost()}/pg/v4/payment/verify.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ merchant_id: config.payment.zarinpalMerchant, amount: payment.amount * 10, authority }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json();
      if ([100, 101].includes(data.data?.code)) refId = String(data.data.ref_id);
    } else {
      refId = `T${Date.now()}`;
    }
  }

  return tx(() => {
    const fresh = db.prepare('SELECT * FROM payments WHERE id = ?').get(payment.id);
    if (fresh.status !== 'pending') return fresh;
    if (refId) {
      db.prepare("UPDATE payments SET status = 'paid', ref_id = ? WHERE id = ?").run(refId, payment.id);
      addTx(payment.user_id, payment.amount, 'topup', { description: `شارژ کیف پول — کد پیگیری ${refId}` });
    } else {
      db.prepare("UPDATE payments SET status = 'failed' WHERE id = ?").run(payment.id);
    }
    return db.prepare('SELECT * FROM payments WHERE id = ?').get(payment.id);
  });
}
