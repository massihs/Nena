import { db } from '../db.js';
import { now } from '../util.js';
import { driverRating } from './drivers.js';

export const DAY = 24 * 3600 * 1000;
const IRST = 3.5 * 3600 * 1000;
// Tehran calendar day index for a timestamp.
const dayIndex = (t) => Math.floor((t + IRST) / DAY);
export const startOfTehranDay = (t = now()) => dayIndex(t) * DAY - IRST;

const one = (sql, ...p) => db.prepare(sql).get(...p);

// Money and volume for completed rides plus request outcomes in [from, to).
function summary(from, to) {
  const r = one(`SELECT COUNT(*) AS trips, COALESCE(SUM(fare_final), 0) AS gmv, COALESCE(SUM(discount), 0) AS discounts,
      COALESCE(SUM(commission), 0) AS commission, COALESCE(SUM(tip), 0) AS tips,
      COALESCE(SUM(fare_final - commission + tip), 0) AS driver_earnings, COALESCE(SUM(distance_km), 0) AS distance_km,
      COALESCE(SUM(paid_cash), 0) AS cash, COALESCE(SUM(paid_wallet), 0) AS wallet,
      COALESCE(SUM(wait_fee), 0) AS wait_fees,
      COALESCE(SUM(CASE WHEN surge > 1 THEN 1 ELSE 0 END), 0) AS surge_trips,
      COALESCE(SUM(CASE WHEN surge > 1 THEN fare_final - ROUND(fare_final / surge) ELSE 0 END), 0) AS surge_extra,
      COALESCE(AVG(surge), 1) AS avg_surge,
      COUNT(DISTINCT rider_id) AS active_riders, COUNT(DISTINCT driver_id) AS active_drivers
    FROM rides WHERE status = 'completed' AND completed_at >= ? AND completed_at < ?`, from, to);
  const q = one(`SELECT COUNT(*) AS requests,
      COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled,
      COALESCE(SUM(CASE WHEN status = 'no_driver' THEN 1 ELSE 0 END), 0) AS no_driver,
      COALESCE(SUM(CASE WHEN accepted_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS accepted,
      COALESCE(SUM(cancel_fee), 0) AS cancel_fees
    FROM rides WHERE status != 'scheduled' AND created_at >= ? AND created_at < ?`, from, to);
  const net = r.commission - r.discounts;
  return {
    ...r, ...q,
    net_revenue: net,
    take_rate: r.gmv ? (r.commission / r.gmv) * 100 : 0,
    avg_fare: r.trips ? Math.round(r.gmv / r.trips) : 0,
    completion_rate: q.requests ? (r.trips / q.requests) * 100 : 0,
    cancel_rate: q.requests ? (q.cancelled / q.requests) * 100 : 0,
    topups: one("SELECT COALESCE(SUM(amount), 0) AS s FROM payments WHERE status = 'paid' AND created_at >= ? AND created_at < ?", from, to).s,
    payouts_paid: one("SELECT COALESCE(SUM(amount), 0) AS s FROM payouts WHERE status = 'paid' AND processed_at >= ? AND processed_at < ?", from, to).s,
    new_riders: one('SELECT COUNT(*) AS n FROM users WHERE created_at >= ? AND created_at < ?', from, to).n,
    new_drivers: one('SELECT COUNT(*) AS n FROM drivers WHERE created_at >= ? AND created_at < ?', from, to).n,
  };
}

export function economics(days) {
  const to = now();
  const from = startOfTehranDay(to) - (days - 1) * DAY;
  const prevFrom = from - days * DAY;

  const firstDay = dayIndex(from);
  const daily = Array.from({ length: days }, (_, i) => ({ date: (firstDay + i) * DAY - IRST, trips: 0, gmv: 0, net_revenue: 0, requests: 0 }));
  for (const r of db.prepare("SELECT completed_at, fare_final, commission, discount FROM rides WHERE status = 'completed' AND completed_at >= ?").all(from)) {
    const d = daily[dayIndex(r.completed_at) - firstDay];
    if (!d) continue;
    d.trips++; d.gmv += r.fare_final; d.net_revenue += r.commission - r.discount;
  }
  const hourly = Array.from({ length: 24 }, (_, h) => ({ hour: h, requests: 0, completed: 0 }));
  for (const r of db.prepare("SELECT created_at, status FROM rides WHERE status != 'scheduled' AND created_at >= ?").all(from)) {
    const d = daily[dayIndex(r.created_at) - firstDay];
    if (d) d.requests++;
    const h = new Date(r.created_at + IRST).getUTCHours();
    hourly[h].requests++;
    if (r.status === 'completed') hourly[h].completed++;
  }

  const services = db.prepare(`SELECT t.key, t.name, t.active,
      COALESCE(SUM(CASE WHEN r.status = 'completed' THEN 1 ELSE 0 END), 0) AS trips,
      COALESCE(SUM(CASE WHEN r.status = 'completed' THEN r.fare_final ELSE 0 END), 0) AS gmv,
      COALESCE(SUM(CASE WHEN r.status = 'completed' THEN r.commission - r.discount ELSE 0 END), 0) AS net_revenue,
      COALESCE(AVG(CASE WHEN r.status = 'completed' THEN r.surge END), 1) AS avg_surge,
      COUNT(r.id) AS requests
    FROM ride_types t LEFT JOIN rides r ON r.type = t.key AND r.status != 'scheduled' AND r.created_at >= ?
    GROUP BY t.key ORDER BY t.sort`).all(from)
    .filter((s) => s.active || s.requests)
    .map((s) => ({ ...s, avg_fare: s.trips ? Math.round(s.gmv / s.trips) : 0 }));

  const topDrivers = db.prepare(`SELECT r.driver_id, u.name, d.vehicle_type, d.rating_sum, d.rating_count, COUNT(*) AS trips,
      SUM(r.fare_final - r.commission + r.tip) AS earnings
    FROM rides r JOIN users u ON u.id = r.driver_id JOIN drivers d ON d.user_id = r.driver_id
    WHERE r.status = 'completed' AND r.completed_at >= ? GROUP BY r.driver_id ORDER BY earnings DESC LIMIT 5`).all(from)
    .map((d) => ({ id: d.driver_id, name: d.name, vehicle_type: d.vehicle_type, trips: d.trips, earnings: d.earnings, rating: driverRating(d) }));

  // Balances right now (not tied to the period).
  const balances = {
    driver_debt: -one('SELECT COALESCE(SUM(u.wallet), 0) AS s FROM users u JOIN drivers d ON d.user_id = u.id WHERE u.wallet < 0').s,
    owed_to_drivers: one('SELECT COALESCE(SUM(u.wallet), 0) AS s FROM users u JOIN drivers d ON d.user_id = u.id WHERE u.wallet > 0').s,
    rider_wallets: one('SELECT COALESCE(SUM(wallet), 0) AS s FROM users WHERE wallet > 0 AND id NOT IN (SELECT user_id FROM drivers)').s,
    rider_debt: -one('SELECT COALESCE(SUM(wallet), 0) AS s FROM users WHERE wallet < 0 AND id NOT IN (SELECT user_id FROM drivers)').s,
    pending_payouts: one("SELECT COALESCE(SUM(amount), 0) AS s FROM payouts WHERE status = 'pending'").s,
  };

  return { days, from, to, current: summary(from, to), previous: summary(prevFrom, from), daily, hourly, services, top_drivers: topDrivers, balances };
}
