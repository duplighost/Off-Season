/**
 * The Ledger (§5, §8.2) — the winter manifest: 200 souls by name and
 * household, and one blank line at the bottom of every year's page. Always
 * exactly one. Form 12-C is filed here when the loophole is open.
 */

import type { Ctx, Renderer } from '../types';
import { SCREEN_H, SCREEN_W } from '../types';

let selected = 0;

export function updateLedger(ctx: Ctx): void {
  const i = ctx.input;
  const canFile =
    !!ctx.state.flags.form12c_available &&
    !!ctx.state.flags.signatory_secured &&
    ctx.state.juneTrust >= 70 &&
    !ctx.state.flags.form12c_filed;

  if (canFile) {
    if (i.upPressed || i.downPressed) selected = selected === 0 ? 1 : 0;
    if (i.confirmPressed && selected === 1) {
      fileForm12C(ctx);
      return;
    }
  }
  if (i.cancelPressed || (i.confirmPressed && (!canFile || selected === 0))) {
    ctx.ui.pop();
  }
}

function fileForm12C(ctx: Ctx): void {
  const s = ctx.state;
  s.flags.form12c_filed = true;
  s.ledger.amended = true;
  s.ledger.count = 201;
  s.flags.count_clean = true;
  s.population = 201;
  ctx.audio.cue('pen');
  ctx.ui.toast(ctx.content.strings?.form12c_filed ?? 'Filed.');
  ctx.ui.pop();
}

export function drawLedger(ctx: Ctx, r: Renderer): void {
  const bw = 300;
  const bh = 220;
  const bx = Math.floor((SCREEN_W - bw) / 2);
  const by = Math.floor((SCREEN_H - bh) / 2);

  r.rect(0, 0, SCREEN_W, SCREEN_H, 0, 0.6);
  // the book: aged paper
  r.rect(bx, by, bw, bh, 8);
  r.frame(bx, by, bw, bh, 9);
  // spine
  r.rect(bx + bw / 2 - 1, by, 2, bh, 9, 0.5);

  const title = ctx.content.strings?.ledger_title ?? 'THE LEDGER';
  r.text(title, bx + 12, by + 8, 1, { serif: true });
  const count = `${ctx.content.strings?.ledger_count ?? 'COUNT'}: ${ctx.state.ledger.count}`;
  r.text(count, bx + bw - r.textWidth(count, true) - 12, by + 8, 1, { serif: true });

  // ruled lines: two columns of ~14 abstract entries
  let ly = by + 26;
  const colW = (bw - 36) / 2;
  for (let i = 0; i < 28; i++) {
    const col = i < 14 ? 0 : 1;
    const lx = bx + 12 + col * (colW + 12);
    const yy = ly + (i % 14) * 12;
    r.rect(lx, yy + 8, colW, 1, 9, 0.4);
    // ink marks (illegible names)
    drawInk(r, lx + 2, yy + 2, colW - 6, i * 7);
  }

  // the single blank 201st line, always at the very bottom.
  const blankY = by + bh - 20;
  r.rect(bx + 12, blankY + 8, bw - 24, 1, 9);
  if (ctx.state.flags.form12c_filed) {
    // fresh ink
    r.text(ctx.content.strings?.ledger_201 ?? '201.', bx + 14, blankY, 14, { serif: true });
    drawInk(r, bx + 40, blankY + 1, 120, 3);
  }

  // Form 12-C action
  const canFile =
    !!ctx.state.flags.form12c_available &&
    !!ctx.state.flags.signatory_secured &&
    ctx.state.juneTrust >= 70 &&
    !ctx.state.flags.form12c_filed;
  if (canFile) {
    const oy = by + bh + 6;
    const close = ctx.content.strings?.ledger_close ?? 'Close';
    const file = ctx.content.strings?.form12c_file ?? 'File Form 12-C';
    r.text((selected === 0 ? '> ' : '  ') + close, bx + 12, oy, selected === 0 ? 15 : 3);
    r.text((selected === 1 ? '> ' : '  ') + file, bx + 100, oy, selected === 1 ? 15 : 3);
  }
}

function drawInk(r: Renderer, x: number, y: number, w: number, seed: number): void {
  let cursor = x;
  let s = seed | 1;
  while (cursor < x + w - 4) {
    s = (Math.imul(s, 48271) & 0x7fffffff) >>> 0;
    const len = 3 + (s % 6);
    r.rect(cursor, y + 4, len, 2, 1, 0.5);
    cursor += len + 2 + (s % 3);
  }
}
