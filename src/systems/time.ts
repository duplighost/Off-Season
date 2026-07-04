/**
 * The day/phase machinery (§7.0, §7.6). Nine days, 06:30 to midnight, phases
 * morning → day → dusk → night. Dusk begins at the per-day sunset from the
 * SUNSET_MIN curve; forced sleep at midnight; day 9 midnight resolves the
 * run through story.checkEnding.
 */

import {
  CLOCK_RATE,
  DAY_END_MIN,
  DAY_START_MIN,
  POPULATION_BY_DAY,
  SUNSET_MIN,
} from '../types';
import type { Ctx, DayPhase, GameState } from '../types';
import { applyEndOfDay } from './chores';
import { planDay } from './director';
import { checkEnding } from './story';

const LAST_DAY = 9;
/** Morning ends at 11:00. */
const MORNING_END_MIN = 11 * 60;
/** Dusk lasts 45 game-minutes after sunset, then night. */
const DUSK_LEN_MIN = 45;

export function clockStr(min: number): string {
  const m = Math.max(0, Math.floor(min));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h < 10 ? '0' : ''}${h}:${mm < 10 ? '0' : ''}${mm}`;
}

export function parseClock(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) {
    console.warn(`[time] unparseable clock string "${s}"`);
    return 0;
  }
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

export function sunsetMin(day: number): number {
  const d = Math.min(Math.max(1, Math.floor(day)), LAST_DAY);
  return SUNSET_MIN[d];
}

export function phaseFor(day: number, clockMin: number): DayPhase {
  if (clockMin < DAY_START_MIN) return 'night';
  if (clockMin < MORNING_END_MIN) return 'morning';
  const sunset = sunsetMin(day);
  if (clockMin < sunset) return 'day';
  if (clockMin < sunset + DUSK_LEN_MIN) return 'dusk';
  return 'night';
}

export function isAfterSundown(state: GameState): boolean {
  return state.clockMin >= sunsetMin(state.day);
}

/** Advances the clock in walk mode. Emits phaseChange on transitions and
 *  forces sleep() when the clock crosses midnight. */
export function updateTime(ctx: Ctx, dt: number): void {
  if (ctx.paused) return;
  const s = ctx.state;
  if (s.ending) return;

  const before = s.clockMin;
  s.clockMin = before + CLOCK_RATE * dt;

  const phase = phaseFor(s.day, s.clockMin);
  if (phase !== s.phase) {
    s.phase = phase;
    ctx.bus.emit({ type: 'phaseChange', phase });
  }

  // Edge-triggered so a day-9 resolution that declines to end the run
  // (placeholder content) doesn't re-fire every frame.
  if (before < DAY_END_MIN && s.clockMin >= DAY_END_MIN) {
    sleep(ctx);
  }
}

/** Rolls state to the given day: clock to 06:30, phase, population sign,
 *  stale events/deviations cleared. Emits dayStart, then hands the director
 *  its planning pass. Also the day-warp entry point for the debug pane. */
export function startDay(ctx: Ctx, day: number): void {
  const s = ctx.state;
  const d = Math.min(Math.max(1, Math.floor(day)), LAST_DAY);
  if (d !== day) console.warn(`[time] startDay(${day}) clamped to ${d}`);

  s.day = d;
  s.clockMin = DAY_START_MIN;
  s.population = POPULATION_BY_DAY[d] ?? s.population;
  s.activeEvents = [];
  for (const npc of Object.values(s.npcs)) npc.deviation = null;

  const phase = phaseFor(d, s.clockMin);
  const phaseChanged = phase !== s.phase;
  s.phase = phase;

  ctx.bus.emit({ type: 'dayStart', day: d });
  if (phaseChanged) ctx.bus.emit({ type: 'phaseChange', phase });

  planDay(ctx);
}

/** End of day: missed-chore debt, dayEnd, then either the next morning or —
 *  after day 9 — the ending resolution. Also invoked by the bed interact. */
export function sleep(ctx: Ctx): void {
  const s = ctx.state;
  if (s.ending) return;

  applyEndOfDay(ctx);
  ctx.bus.emit({ type: 'dayEnd', day: s.day });

  if (s.day >= LAST_DAY) {
    const ending = checkEnding(ctx);
    if (ending) {
      // Ending scenes are content-defined under the id convention
      // 'ending.{endingId}'; story.startScene warns and no-ops if missing.
      ctx.ui.startScene(`ending.${ending}`);
    } else {
      console.warn('[time] day 9 ended without a resolved ending; the night continues');
    }
    return;
  }

  startDay(ctx, s.day + 1);
}
