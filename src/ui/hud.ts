/**
 * HUD (§7.9). The population sign is the horror instrument that turns on the
 * player late; the checklist one-liner keeps the rite present; the interact
 * prompt and toasts are the plumbing.
 */

import type { Ctx, Renderer } from '../types';
import { SCREEN_W } from '../types';
import { clockStr } from '../systems/time';
import { activeChore, currentStep } from '../systems/chores';
import { radioTicker } from '../systems/radio';

interface Toast {
  msg: string;
  t: number;
}
const toasts: Toast[] = [];

export function pushToast(msg: string): void {
  toasts.push({ msg, t: 3 });
}

let tickerOffset = 0;

export function drawHud(ctx: Ctx, r: Renderer): void {
  const s = ctx.state;

  // Day + clock, top-left.
  const dayStr = `${(ctx.content.strings?.day_label ?? 'DAY')} ${s.day}`;
  r.text(dayStr, 6, 5, 13);
  r.text(clockStr(s.clockMin), 6, 14, 3);

  // Population sign, top-right (the green town-line sign).
  drawPopSign(ctx, r);

  // Current checklist item, bottom-left.
  const chore = activeChore(ctx);
  if (chore) {
    const step = currentStep(ctx, chore);
    let hint = chore.title;
    if (chore.item === 9 && s.day < 8) hint = ctx.content.strings?.item9_illegible ?? '· · · · ·';
    r.text('☐ ' + hint, 6, 258, 15, { maxWidth: 260 });
    void step;
  }

  // Radio ticker, top-center marquee.
  const ticker = radioTicker(ctx);
  if (ticker) {
    const w = r.textWidth(ticker);
    tickerOffset = (tickerOffset + 0.3) % (w + 120);
    const x = 120 - tickerOffset + 120;
    r.rect(96, 4, SCREEN_W - 200, 9, 0, 0.4);
    r.text(ticker, Math.floor(x), 5, 6, { maxWidth: SCREEN_W - 210 });
  }

  // Toasts, center-bottom.
  drawToasts(r);
}

function drawPopSign(ctx: Ctx, r: Renderer): void {
  const label = ctx.content.strings?.town_name ?? 'LANTERN NECK';
  const pop = `POP. ${ctx.state.population}`;
  const w = Math.max(r.textWidth(label), r.textWidth(pop)) + 12;
  const x = SCREEN_W - w - 6;
  const y = 4;
  // green municipal sign
  r.rect(x, y, w, 24, 11);
  r.frame(x, y, w, 24, 13);
  r.text(label, x + 6, y + 4, 13);
  r.text(pop, x + 6, y + 13, 13);
}

export function updateToasts(dt: number): void {
  for (const t of toasts) t.t -= dt;
  while (toasts.length && toasts[0].t <= 0) toasts.shift();
}

function drawToasts(r: Renderer): void {
  let y = 200;
  for (const t of toasts) {
    const w = r.textWidth(t.msg) + 12;
    const x = Math.floor((SCREEN_W - w) / 2);
    const a = Math.min(1, t.t);
    r.rect(x, y, w, 12, 0, 0.7 * a);
    r.text(t.msg, x + 6, y + 3, 13);
    y -= 14;
  }
}
