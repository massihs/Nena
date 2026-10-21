import { db, tx } from '../db.js';
import { now } from '../util.js';

// Applies a signed amount (toman) to a user's wallet and records it in the ledger.
export function addTx(userId, amount, type, { rideId = null, description = '' } = {}) {
  if (!amount) return null;
  return tx(() => {
    db.prepare('UPDATE users SET wallet = wallet + ? WHERE id = ?').run(amount, userId);
    const { wallet } = db.prepare('SELECT wallet FROM users WHERE id = ?').get(userId);
    db.prepare(`INSERT INTO transactions (user_id, amount, balance_after, type, ride_id, description, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(userId, amount, wallet, type, rideId, description, now());
    return wallet;
  });
}

export function listTx(userId, limit = 50) {
  return db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(userId, limit);
}
