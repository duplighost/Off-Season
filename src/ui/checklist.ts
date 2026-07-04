/**
 * The Closing Checklist card (§7.2) — one laminated card, nine items,
 * doubles as the quest UI. Item 9 is illegible worn marks until Day 8.
 */

import type { ChoreDef, Ctx, Renderer } from '../types';
import { SCREEN_H, SCREEN_W } from '../types';

export function updateChecklist(ctx: Ctx): void {
  const i = ctx.input;
  if (i.cancelPressed || i.checklistPressed || i.confirmPressed) {
    ctx.ui.pop();
  }
}

export function drawChecklist(ctx: Ctx, r: Renderer): void {
  const chores: ChoreDef[] = (ctx.content.chores?.chores ?? []).slice().sort((a, b) => a.item - b.item);
  const cw = 260;
  const ch = 210;
  const cx = Math.floor((SCREEN_W - cw) / 2);
  const cy = Math.floor((SCREEN_H - ch) / 2);

  // Dim the world.
  r.rect(0, 0, SCREEN_W, SCREEN_H, 0, 0.55);
  // The laminated card (clapboard white with a slight sheen frame).
  r.rect(cx, cy, cw, ch, 13);
  r.frame(cx, cy, cw, ch, 2);
  r.frame(cx + 2, cy + 2, cw - 4, ch - 4, 3);

  // Coffee ring stain, drawn as a broken circle in rust.
  drawCoffeeRing(r, cx + cw - 54, cy + 30, 20);

  const header = ctx.content.strings?.checklist_header ?? 'THE CLOSING';
  r.text(header, cx + 14, cy + 10, 1);
  r.rect(cx + 14, cy + 22, cw - 28, 1, 2);

  let y = cy + 30;
  for (let item = 1; item <= 9; item++) {
    const def = chores.find((c) => c.item === item);
    const rec = def ? ctx.state.choresDone[def.id] : undefined;
    const done = !!rec?.done;
    const today = def && def.day === ctx.state.day;

    // checkbox
    const bx = cx + 16;
    r.frame(bx, y, 8, 8, 0);
    if (done) {
      r.text('x', bx + 1, y + 1, 14);
    }

    let label: string;
    if (item === 9 && ctx.state.day < 8) {
      // illegible — worn glyph boxes
      label = '';
      drawIllegible(r, bx + 14, y + 1, 120);
    } else {
      label = def?.title ?? `Item ${item}`;
    }
    const color = done ? 2 : today ? 14 : 1;
    if (label) r.text(label, bx + 14, y, color, { maxWidth: cw - 48, serif: false });

    if (today && def) {
      const deadline = def.deadline === 'sundown' ? '· by sundown' : def.deadline === 'midnight' ? '' : `· by ${def.deadline}`;
      if (deadline) r.text(deadline, bx + 14, y + 9, 10);
      y += 9;
    }
    y += 15;
  }

  const hint = ctx.content.strings?.checklist_close ?? 'C / Esc to close';
  r.text(hint, cx + 14, cy + ch - 12, 2);
}

function drawIllegible(r: Renderer, x: number, y: number, w: number): void {
  // A worn, laminated-over line: broken dashes and specks.
  let cursor = x;
  const segs = [7, 3, 11, 4, 6, 9, 3, 8, 5];
  let i = 0;
  while (cursor < x + w) {
    const len = segs[i % segs.length];
    if (i % 2 === 0) r.rect(cursor, y + 3, len, 2, 2, 0.6);
    cursor += len + 2;
    i++;
  }
}

function drawCoffeeRing(r: Renderer, cx: number, cy: number, rad: number): void {
  const steps = 40;
  for (let i = 0; i < steps; i++) {
    // leave a gap so it reads as a ring, not a disc
    if (i > 26 && i < 31) continue;
    const a = (i / steps) * Math.PI * 2;
    const px = Math.round(cx + Math.cos(a) * rad);
    const py = Math.round(cy + Math.sin(a) * rad * 0.7);
    r.rect(px, py, 2, 2, 10, 0.4);
  }
}
