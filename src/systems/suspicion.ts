/**
 * Suspicion & Trust (§7.5).
 *
 * Town Suspicion (0–100) rises from anomalies traceable to Wren and falls
 * slowly on clean days. June Trust (0–100) and the four signatory trust
 * tracks are built through visits, honesty, and supplies. None of these
 * numbers ever kill Wren — they change dialogue temperature and gate endings.
 */

import type { Ctx } from '../types';

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function addSuspicion(ctx: Ctx, delta: number, _reason?: string): void {
  if (!delta) return;
  const s = ctx.state;
  const before = s.suspicion;
  s.suspicion = clamp(s.suspicion + delta, 0, 100);
  const applied = s.suspicion - before;
  if (applied !== 0) {
    // Mark that suspicion rose today so the clean-day decay is withheld.
    if (applied > 0) s.flags.suspicion_rose_today = true;
    ctx.bus.emit({ type: 'suspicionChanged', value: s.suspicion, delta: applied });
  }
}

export function addTrust(ctx: Ctx, delta: number): void {
  if (!delta) return;
  const s = ctx.state;
  const before = s.juneTrust;
  s.juneTrust = clamp(s.juneTrust + delta, 0, 100);
  const applied = s.juneTrust - before;
  if (applied !== 0) ctx.bus.emit({ type: 'trustChanged', value: s.juneTrust, delta: applied });
}

export function addSignatoryTrust(ctx: Ctx, who: string, delta: number): void {
  if (!delta) return;
  const s = ctx.state;
  const cur = s.signatoryTrust[who] ?? 0;
  s.signatoryTrust[who] = clamp(cur + delta, 0, 10);
}

/** <30 → 0 (calm), <60 → 1 (attentive), <80 → 2 (temperature up), else 3 (they help you look). */
export function suspicionTier(v: number): 0 | 1 | 2 | 3 {
  if (v < 30) return 0;
  if (v < 60) return 1;
  if (v < 80) return 2;
  return 3;
}

/** Zones where being out late reads as suspicious. */
const LATE_ZONES = new Set(['blackrock', 'harbor', 'rockneck']);

export function updateSuspicion(ctx: Ctx, dt: number): void {
  const s = ctx.state;

  // Late-night trickle: past 22:30, out in the wrong zone, +0.5/game-min.
  if (s.clockMin >= 22 * 60 + 30) {
    const zone = s.flags.cur_zone;
    if (typeof zone === 'string' && LATE_ZONES.has(zone)) {
      // dt is real seconds; clock advances CLOCK_RATE game-min/sec.
      s.suspicion = clamp(s.suspicion + 0.5 * dt, 0, 100);
      s.flags.suspicion_rose_today = true;
      if (!s.flags._late_out_counted) {
        s.stats.nightsOutLate += 1;
        s.flags._late_out_counted = true;
      }
    }
  }

  // Double-order rule: at 3+ food-for-two buys, Roz clocks it once.
  const orders = Number(s.flags.bought_food_for_two ?? 0);
  s.stats.doubleOrders = orders;
  if (orders >= 3 && !s.flags.roz_noticed_orders) {
    s.flags.roz_noticed_orders = true;
    addSuspicion(ctx, 5, 'double_orders');
  }
}

/**
 * Applied at each dayStart: if nothing raised suspicion the previous day,
 * a clean day earns −2. Called by the day-start bus listener in game.ts.
 */
export function applyDailySuspicionDecay(ctx: Ctx): void {
  const s = ctx.state;
  if (!s.flags.suspicion_rose_today) {
    addSuspicion(ctx, -2, 'clean_day');
  }
  s.flags.suspicion_rose_today = false;
  s.flags._late_out_counted = false;
}
