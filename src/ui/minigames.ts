/**
 * Chore minigames (§7.2): the fussy little rites.
 *  - hold_timing: an oscillating marker; release inside the band. 3 hits.
 *  - meter_read:  a dial + digits; confirm logs the reading.
 *  - switch:      hold interact ~2s → an enormous THUNK and a white flash.
 */

import type { ChoreDef, ChoreStep, ChoreStepType, Ctx, Renderer } from '../types';
import { SCREEN_H, SCREEN_W } from '../types';
import { stepResolved } from '../systems/chores';

interface MgState {
  kind: ChoreStepType;
  chore: ChoreDef;
  step: ChoreStep;
  // hold_timing
  pos: number;
  vel: number;
  band: number; // half-width
  hits: number;
  needHits: number;
  // switch
  hold: number;
  holdNeed: number;
  flash: number;
  // meter
  digits: number[];
  cursor: number;
  done: boolean;
}

let mg: MgState | null = null;

export function minigameActive(_ctx: Ctx): boolean {
  return mg !== null;
}

export function startMinigame(ctx: Ctx, kind: ChoreStepType, chore: ChoreDef, step: ChoreStep): void {
  const diff = step.difficulty ?? 1;
  mg = {
    kind,
    chore,
    step,
    pos: 0,
    vel: 0.9 + diff * 0.25,
    band: Math.max(0.1, 0.28 - diff * 0.05),
    hits: 0,
    needHits: kind === 'boat_task' ? 2 : 3,
    hold: 0,
    holdNeed: 2,
    flash: 0,
    digits: [0, 0, 0, 0],
    cursor: 0,
    done: false,
  };
  ctx.ui.push(kind === 'meter_read' ? 'meter' : 'minigame');
}

function finish(ctx: Ctx): void {
  const choreId = mg?.chore.id;
  mg = null;
  ctx.ui.pop();
  if (choreId) stepResolved(ctx, choreId);
}

export function updateMinigame(ctx: Ctx, dt: number): void {
  if (!mg) return;
  const input = ctx.input;

  if (mg.kind === 'switch') {
    if (input.interactHeld) {
      mg.hold += dt;
      if (mg.hold >= mg.holdNeed && !mg.done) {
        mg.done = true;
        mg.flash = 0.5;
        ctx.audio.cue('thunk', { volume: 1 });
      }
    } else if (!mg.done) {
      mg.hold = Math.max(0, mg.hold - dt * 2);
    }
    if (mg.done) {
      mg.flash -= dt;
      if (mg.flash <= 0) finish(ctx);
    }
    if (input.cancelPressed && !mg.done) {
      mg = null;
      ctx.ui.pop();
    }
    return;
  }

  if (mg.kind === 'meter_read') {
    if (input.leftPressed) mg.cursor = (mg.cursor + 3) % 4;
    if (input.rightPressed) mg.cursor = (mg.cursor + 1) % 4;
    if (input.upPressed) mg.digits[mg.cursor] = (mg.digits[mg.cursor] + 1) % 10;
    if (input.downPressed) mg.digits[mg.cursor] = (mg.digits[mg.cursor] + 9) % 10;
    if (input.confirmPressed) {
      ctx.audio.cue('pen');
      finish(ctx);
    }
    if (input.cancelPressed) {
      mg = null;
      ctx.ui.pop();
    }
    return;
  }

  // hold_timing / boat_task
  mg.pos += mg.vel * dt;
  if (mg.pos > 1) {
    mg.pos = 2 - mg.pos;
    mg.vel = -mg.vel;
  } else if (mg.pos < 0) {
    mg.pos = -mg.pos;
    mg.vel = -mg.vel;
  }
  if (input.interactPressed || input.confirmPressed) {
    // band centered at 0.5
    if (Math.abs(mg.pos - 0.5) <= mg.band) {
      mg.hits += 1;
      ctx.audio.cue(mg.kind === 'boat_task' ? 'winch' : 'winch');
      if (mg.hits >= mg.needHits) {
        finish(ctx);
        return;
      }
      // speed up slightly each hit
      mg.vel *= mg.vel > 0 ? 1.12 : 1.12;
    } else {
      ctx.audio.cue('chain', { volume: 0.5 });
    }
  }
  if (input.cancelPressed) {
    mg = null;
    ctx.ui.pop();
  }
}

export function drawMinigame(ctx: Ctx, r: Renderer): void {
  if (!mg) return;
  const cx = Math.floor(SCREEN_W / 2);

  if (mg.kind === 'switch') {
    if (mg.flash > 0) {
      r.rect(0, 0, SCREEN_W, SCREEN_H, 13, Math.min(1, mg.flash * 2));
      return;
    }
    const bw = 160;
    const bx = cx - bw / 2;
    const by = 150;
    r.rect(bx - 4, by - 4, bw + 8, 24, 0, 0.8);
    r.frame(bx - 4, by - 4, bw + 8, 24, 2);
    const p = Math.min(1, mg.hold / mg.holdNeed);
    r.rect(bx, by, Math.floor(bw * p), 16, 14);
    r.text(ctx.content.strings?.mg_switch ?? 'HOLD', bx, by - 16, 13);
    return;
  }

  if (mg.kind === 'meter_read') {
    const bx = cx - 70;
    const by = 110;
    r.rect(bx - 8, by - 8, 156, 70, 1, 0.95);
    r.frame(bx - 8, by - 8, 156, 70, 3);
    r.text(ctx.content.strings?.mg_meter ?? 'LOG THE READING', bx, by - 2, 13);
    for (let i = 0; i < 4; i++) {
      const dx = bx + i * 34;
      const sel = i === mg.cursor;
      r.rect(dx, by + 16, 28, 34, sel ? 15 : 13);
      r.frame(dx, by + 16, 28, 34, 0);
      r.text(String(mg.digits[i]), dx + 10, by + 28, 0);
    }
    return;
  }

  // hold_timing / boat_task — vertical bar
  const bx = cx - 12;
  const top = 60;
  const h = 150;
  r.rect(bx - 4, top - 4, 32, h + 8, 0, 0.8);
  r.frame(bx - 4, top - 4, 32, h + 8, 2);
  // band
  const bandTop = top + (0.5 - mg.band) * h;
  const bandH = mg.band * 2 * h;
  r.rect(bx, bandTop, 24, bandH, 5, 0.6);
  // marker
  const my = top + mg.pos * h;
  r.rect(bx - 2, my - 2, 28, 4, 14);
  // hit pips
  for (let i = 0; i < mg.needHits; i++) {
    r.rect(bx + i * 8, top + h + 10, 6, 6, i < mg.hits ? 15 : 2);
  }
  r.text(ctx.content.strings?.mg_timing ?? 'TIME IT', bx - 20, top - 18, 13);
}
