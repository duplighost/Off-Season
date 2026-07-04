/**
 * Title screen. Dark, a slow Lantern beam sweeping the black. New / Continue.
 */

import type { Ctx, Renderer } from '../types';
import { SCREEN_H, SCREEN_W } from '../types';
import { hasSave } from '../engine/save';

let selected = 0;
let beam = 0;
let seedDigits = '';

export function updateTitle(ctx: Ctx): { action: 'new' | 'continue' | null; seed?: number } {
  const i = ctx.input;
  const canContinue = hasSave();
  const options = canContinue ? 2 : 1;

  if (i.upPressed || i.downPressed) selected = (selected + 1) % options;

  if (ctx.debug) {
    // crude seed entry: number keys captured via mouse-less fallback omitted;
    // seed stays default unless set through the debug pane.
  }

  if (i.confirmPressed) {
    if (canContinue && selected === 0) return { action: 'continue' };
    const seed = seedDigits ? parseInt(seedDigits, 10) : 88291;
    return { action: 'new', seed };
  }
  return { action: null };
}

export function drawTitle(ctx: Ctx, r: Renderer): void {
  beam = (beam + 0.006) % 1;
  r.rect(0, 0, SCREEN_W, SCREEN_H, 0, 1);

  // Lantern beam: a faint wedge of window-light sweeping.
  const cxp = SCREEN_W / 2;
  const cyp = SCREEN_H / 2 - 10;
  const ang = beam * Math.PI * 2;
  for (let d = 0; d < 200; d += 3) {
    const x = Math.round(cxp + Math.cos(ang) * d);
    const y = Math.round(cyp + Math.sin(ang) * d * 0.5);
    if (x >= 0 && x < SCREEN_W && y >= 0 && y < SCREEN_H) {
      r.rect(x, y, 2, 2, 15, 0.12);
    }
  }

  const title = ctx.content.strings?.game_title ?? 'OFF-SEASON';
  const tw = r.textWidth(title, true);
  r.text(title, Math.floor((SCREEN_W - tw) / 2), 70, 15, { serif: true });
  const sub = ctx.content.strings?.game_sub ?? 'Mind the Slack.';
  const sw = r.textWidth(sub);
  r.text(sub, Math.floor((SCREEN_W - sw) / 2), 86, 6);

  const canContinue = hasSave();
  let y = 150;
  const items: string[] = [];
  if (canContinue) items.push(ctx.content.strings?.menu_continue ?? 'Continue');
  items.push(ctx.content.strings?.menu_new ?? 'New Game');
  const offset = canContinue ? 0 : 0;
  items.forEach((label, i) => {
    const sel = i === selected + offset || (i === selected);
    const isSel = i === selected;
    const w = r.textWidth(label);
    r.text(label, Math.floor((SCREEN_W - w) / 2), y, isSel ? 15 : 3);
    void sel;
    y += 16;
  });
}
