/**
 * Scene renderer (§8, restraint always). Draws whatever the story VM has
 * staged: full-screen serif slides on black (dreams, endings), letterboxed
 * text boxes, choice lists, and fades. No spectacle.
 */

import type { Ctx, Renderer } from '../types';
import { SCREEN_H, SCREEN_W } from '../types';
import { currentSceneText, currentSlide, fadeLevel } from '../systems/story';

function wrap(r: Renderer, text: string, maxWidth: number, serif: boolean): string[] {
  const words = text.split(' ');
  const rows: string[] = [];
  let cur = '';
  for (const w of words) {
    const trial = cur ? cur + ' ' + w : w;
    if (r.textWidth(trial, serif) > maxWidth && cur) {
      rows.push(cur);
      cur = w;
    } else {
      cur = trial;
    }
  }
  if (cur) rows.push(cur);
  return rows;
}

export function drawScene(ctx: Ctx, r: Renderer): void {
  const slide = currentSlide(ctx);
  const box = currentSceneText(ctx);

  // Slides render on a full black field.
  if (slide) {
    r.rect(0, 0, SCREEN_W, SCREEN_H, 0, 1);
    const rows = wrap(r, slide.text, SCREEN_W - 80, true);
    const lh = 12;
    let y = Math.floor(SCREEN_H / 2 - (rows.length * lh) / 2);
    for (const row of rows) {
      const w = r.textWidth(row, true);
      r.text(row, Math.floor((SCREEN_W - w) / 2), y, 13, { serif: true });
      y += lh;
    }
  } else if (box) {
    // Letterboxed dialogue-style box near the bottom.
    r.letterbox(0.5);
    const bx = 24;
    const bw = SCREEN_W - 48;
    const by = SCREEN_H - 84;
    const bh = 68;
    r.rect(bx, by, bw, bh, 0, 0.85);
    r.frame(bx, by, bw, bh, 2);
    let y = by + 8;
    if (box.speaker) {
      r.text(box.speaker.toUpperCase(), bx + 8, y, 15);
      y += 10;
    }
    for (const line of box.lines) {
      for (const row of wrap(r, line, bw - 16, false)) {
        r.text(row, bx + 8, y, 13);
        y += 9;
      }
    }
    if (box.choices && box.choices.length) {
      y += 2;
      box.choices.forEach((c, i) => {
        const sel = i === box.selected;
        if (sel) r.text('>', bx + 6, y, 15);
        r.text(c.text, bx + 16, y, sel ? 15 : 3);
        y += 9;
      });
    }
  }

  // Fade overlay on top of everything.
  const fl = fadeLevel();
  if (fl > 0) r.rect(0, 0, SCREEN_W, SCREEN_H, 0, fl);
}
