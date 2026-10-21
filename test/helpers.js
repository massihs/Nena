import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { io as ioClient } from 'socket.io-client';

process.env.DB_PATH = ':memory:';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nena-test-'));
process.env.ROUTING_PROVIDER = 'estimate';
process.env.GEOCODER = 'none';
process.env.ADMIN_PHONES = '09120000000';

const { startServer } = await import('../server/index.js');

export async function boot() {
  const srv = await startServer(0);
  const base = `http://localhost:${srv.port}`;
  const sockets = [];

  async function api(token, method, url, body) {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ...data };
  }

  async function login(phone) {
    const otp = await api(null, 'POST', '/api/auth/otp', { phone });
    const v = await api(null, 'POST', '/api/auth/verify', { phone, code: otp.dev_code });
    if (!v.token) throw new Error(`login failed: ${JSON.stringify(v)}`);
    return v.token;
  }

  function socket(token, app) {
    const s = ioClient(base, { auth: { token, app }, transports: ['websocket'] });
    sockets.push(s);
    return new Promise((resolve, reject) => {
      s.on('connect', () => resolve(s));
      s.on('connect_error', reject);
    });
  }

  const waitFor = (s, event, pred = () => true, ms = 5000) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    const h = (data) => { if (pred(data)) { clearTimeout(t); s.off(event, h); resolve(data); } };
    s.on(event, h);
  });

  async function close() {
    sockets.forEach((s) => s.close());
    await srv.close();
  }

  return { api, login, socket, waitFor, close, base };
}

// Generates a checksum-valid Iranian national code.
export function nationalId(seed) {
  const d = String(seed).padStart(9, '0').slice(-9).split('').map(Number);
  const sum = d.reduce((a, n, i) => a + n * (10 - i), 0);
  const r = sum % 11;
  return d.join('') + (r < 2 ? r : 11 - r);
}

export const TEHRAN = {
  azadi: { lat: 35.6997, lng: 51.338, address: 'میدان آزادی' },
  enghelab: { lat: 35.7009, lng: 51.3913, address: 'میدان انقلاب' },
  tajrish: { lat: 35.8045, lng: 51.4339, address: 'میدان تجریش' },
};
