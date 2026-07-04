/**
 * Modal dialogue UI (§9.1). A municipal panel boxed at the bottom of the
 * screen: speaker tag, typewriter reveal (~40 chars/s), choice list. Confirm
 * fast-forwards the current line, then advances; on a choice node the list
 * appears when the line finishes and confirm commits the selection. All text
 * comes from content — this file renders it, it never authors it.
 *
 * The running conversation is transient UI state (never saved), so it lives
 * in a module-level singleton owned by the single Game instance. Because it's
 * a mutable module `let`, each function captures it into a local `b` after the
 * null guard (the renderer uses the same pattern) so narrowing survives calls.
 */

import { SCREEN_H, SCREEN_W } from '../types';
import type { Ctx, DialogueChoice, DialogueNode, NpcId, Renderer } from '../types';
import { applyEffects, bestNodeFor, condsMet, linesFor, nodeById } from '../systems/dialogue';
import { measure } from './font';

/** Characters revealed per second. */
const REVEAL_CPS = 40;

// Panel geometry (480x270 internal).
const BOX_X = 8;
const BOX_W = SCREEN_W - 16;
const BOX_H = 78;
const BOX_Y = SCREEN_H - BOX_H - 8;
const PAD_X = 10;
const INNER_W = BOX_W - PAD_X * 2;
const LINE_H = 10;
const TEXT_TOP = BOX_Y + 10;
const TEXT_BOTTOM = BOX_Y + BOX_H - 8;

// Palette indices.
const C_PANEL = 1;
const C_BORDER = 3;
const C_HAIRLINE = 2;
const C_TEXT = 13;
const C_TAG_BG = 3;
const C_TAG_TEXT = 0;
const C_SEL = 15;
const C_UNSEL = 3;

interface DialogueBox {
  node: DialogueNode;
  lines: string[]; // resolved (post-decay) pages
  lineIdx: number; // current page
  rows: string[]; // current page wrapped into display rows
  totalChars: number; // sum of row lengths (reveal target)
  charCount: number; // revealed so far (float)
  revealed: boolean;
  choosing: boolean;
  choices: DialogueChoice[]; // visible (condition-filtered) choices
  selected: number;
  choiceArmed: boolean; // one-frame settle before a choice can be committed
  elapsed: number; // for the blinking advance chevron
  lockAdvance: boolean; // debounce the key that opened the box
}

let box: DialogueBox | null = null;

export function dialogueActive(_ctx: Ctx): boolean {
  return box !== null;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export function startDialogue(ctx: Ctx, opts: { node?: string; npc?: NpcId }): void {
  if (box) {
    console.warn('[dialoguebox] dialogue already active; ignoring new startDialogue');
    return;
  }
  const node = opts.node
    ? nodeById(ctx, opts.node)
    : opts.npc
      ? bestNodeFor(ctx, opts.npc)
      : null;

  if (!node) {
    console.warn(`[dialoguebox] no dialogue node for ${opts.node ?? opts.npc ?? '(none)'}`);
    return;
  }

  box = {
    node,
    lines: [],
    lineIdx: 0,
    rows: [],
    totalChars: 0,
    charCount: 0,
    revealed: false,
    choosing: false,
    choices: [],
    selected: 0,
    choiceArmed: false,
    elapsed: 0,
    // If the interact key that opened this box is still held, wait for a
    // release before accepting the first advance so we don't skip line one.
    lockAdvance: !!ctx.input.interactHeld,
  };

  ctx.ui.push('dialogue');
  enterNode(ctx, node);
}

function enterNode(ctx: Ctx, node: DialogueNode | null): void {
  if (!box) return;
  if (!node) {
    endDialogue(ctx);
    return;
  }
  const b = box;
  b.node = node;
  b.lines = linesFor(node, ctx.state.day);
  if (b.lines.length === 0) b.lines = [''];
  b.lineIdx = 0;
  b.choices = [];
  b.selected = 0;

  // Node effects fire once on entry (types.ts: applied when the node shows).
  applyEffects(ctx, node.effects);
  if (node.oneShot && !ctx.state.seenNodes.includes(node.id)) {
    ctx.state.seenNodes.push(node.id);
  }

  beginPage(ctx);
}

function endDialogue(ctx: Ctx): void {
  if (!box) return;
  const endedId = box.node.id;
  box = null;
  // Pop before emitting: a dialogueEnded listener may push a scene, and it
  // must land on top of walk mode, not clobber this dialogue's slot.
  ctx.ui.pop();
  ctx.bus.emit({ type: 'dialogueEnded', node: endedId });
}

// ---------------------------------------------------------------------------
// Paging + reveal
// ---------------------------------------------------------------------------

function setPage(): void {
  if (!box) return;
  const b = box;
  const line = b.lines[b.lineIdx] ?? '';
  b.rows = wrapText(line, INNER_W);
  b.totalChars = b.rows.reduce((a, r) => a + r.length, 0);
  b.charCount = 0;
  b.revealed = b.totalChars === 0;
  b.choosing = false;
}

function beginPage(ctx: Ctx): void {
  setPage();
  if (box && box.revealed) onRevealed(ctx);
}

/** Called the moment a page finishes revealing; opens choices on a final page. */
function onRevealed(ctx: Ctx): void {
  if (!box) return;
  const b = box;
  const isLast = b.lineIdx >= b.lines.length - 1;
  if (!isLast) return;
  const visible = (b.node.choices ?? []).filter((c) => condsMet(ctx.state, c.conditions));
  if (visible.length > 0) {
    b.choices = visible;
    b.selected = 0;
    b.choosing = true;
    b.choiceArmed = false;
  }
}

function advancePage(ctx: Ctx): void {
  if (!box) return;
  const b = box;
  if (b.lineIdx < b.lines.length - 1) {
    b.lineIdx++;
    beginPage(ctx);
    return;
  }
  // Final page with no choices (a choice page would already be `choosing`).
  const g = b.node.goto ?? null;
  if (typeof g === 'string') enterNode(ctx, nodeById(ctx, g));
  else endDialogue(ctx);
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export function updateDialogue(ctx: Ctx, dt: number): void {
  if (!box) return;
  const b = box;
  b.elapsed += dt;
  if (b.lockAdvance && !ctx.input.interactHeld) b.lockAdvance = false;

  const input = ctx.input;

  // Typewriter progression (natural completion opens choices if last page).
  if (!b.revealed) {
    b.charCount += REVEAL_CPS * dt;
    if (b.charCount >= b.totalChars) {
      b.charCount = b.totalChars;
      b.revealed = true;
      onRevealed(ctx);
    }
  }

  if (b.choosing) {
    const n = b.choices.length;
    if (n === 0) {
      endDialogue(ctx);
      return;
    }
    // Settle one frame so the same confirm that finished the text can't also
    // commit choice 0.
    if (!b.choiceArmed) {
      b.choiceArmed = true;
      return;
    }
    if (input.upPressed) b.selected = (b.selected - 1 + n) % n;
    if (input.downPressed) b.selected = (b.selected + 1) % n;
    if (!b.lockAdvance && input.confirmPressed) {
      const choice = b.choices[b.selected];
      applyEffects(ctx, choice.effects);
      const g = choice.goto ?? null;
      if (typeof g === 'string') enterNode(ctx, nodeById(ctx, g));
      else endDialogue(ctx);
    }
    return;
  }

  if (!b.lockAdvance && input.confirmPressed) {
    if (!b.revealed) {
      b.charCount = b.totalChars;
      b.revealed = true;
      onRevealed(ctx);
    } else {
      advancePage(ctx);
    }
  }
}

// ---------------------------------------------------------------------------
// Draw
// ---------------------------------------------------------------------------

export function drawDialogue(ctx: Ctx, r: Renderer): void {
  if (!box) return;
  const b = box;

  // Panel: soft drop, slate fill, municipal double border.
  r.rect(BOX_X + 3, BOX_Y + 4, BOX_W, BOX_H, 0, 0.45);
  r.rect(BOX_X, BOX_Y, BOX_W, BOX_H, C_PANEL, 1);
  r.frame(BOX_X, BOX_Y, BOX_W, BOX_H, C_BORDER);
  r.frame(BOX_X + 2, BOX_Y + 2, BOX_W - 4, BOX_H - 4, C_HAIRLINE);

  // Speaker tag as a small tab riding the top border.
  const label = speakerLabel(ctx, b.node.speaker);
  if (label) {
    const tagW = r.textWidth(label) + 8;
    const tagX = BOX_X + 8;
    const tagY = BOX_Y - 9;
    r.rect(tagX, tagY, tagW, 11, C_TAG_BG, 1);
    r.frame(tagX, tagY, tagW, 11, 0);
    r.text(label, tagX + 4, tagY + 2, C_TAG_TEXT);
  }

  // Revealed text rows.
  let budget = Math.floor(b.charCount);
  let yy = TEXT_TOP;
  for (const row of b.rows) {
    if (yy > TEXT_BOTTOM) break;
    const n = Math.max(0, Math.min(row.length, budget));
    if (n > 0) r.text(row.slice(0, n), BOX_X + PAD_X, yy, C_TEXT, { maxWidth: INNER_W });
    budget -= row.length;
    yy += LINE_H;
  }

  if (b.choosing) {
    let cy = yy + 2;
    const maxCy = TEXT_BOTTOM - b.choices.length * LINE_H + 2;
    if (cy > maxCy) cy = Math.max(TEXT_TOP, maxCy);
    for (let i = 0; i < b.choices.length; i++) {
      const sel = i === b.selected;
      if (sel) r.rect(BOX_X + PAD_X - 3, cy - 1, INNER_W + 6, LINE_H, C_HAIRLINE, 0.5);
      const prefix = sel ? '> ' : '  ';
      r.text(prefix + b.choices[i].text, BOX_X + PAD_X, cy, sel ? C_SEL : C_UNSEL, {
        maxWidth: INNER_W,
      });
      cy += LINE_H;
    }
  } else if (b.revealed && Math.floor(b.elapsed * 2) % 2 === 0) {
    // Blinking advance chevron, bottom-right.
    const cx = BOX_X + BOX_W - 12;
    const cyp = BOX_Y + BOX_H - 9;
    r.rect(cx, cyp, 5, 1, C_SEL);
    r.rect(cx + 1, cyp + 1, 3, 1, C_SEL);
    r.rect(cx + 2, cyp + 2, 1, 1, C_SEL);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Display name for a speaker. Sourced from content strings ("speaker.june")
 * so no character names live in TypeScript; falls back to the technical id
 * (an identifier, not narrative) and shows nothing for the narrator.
 */
function speakerLabel(ctx: Ctx, speaker: string): string {
  const s = ctx.content.strings?.[`speaker.${speaker}`];
  if (typeof s === 'string' && s.length > 0) return s;
  if (speaker === 'narrator') return '';
  return speaker.replace(/_/g, ' ').toUpperCase();
}

/** Greedy word-wrap to a pixel width; hard-splits words longer than the line. */
function wrapText(s: string, maxW: number): string[] {
  const words = s.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [''];

  const rows: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (measure(test) <= maxW) {
      cur = test;
      continue;
    }
    if (cur) {
      rows.push(cur);
      cur = '';
    }
    if (measure(w) > maxW) {
      let chunk = '';
      for (const ch of w) {
        if (chunk && measure(chunk + ch) > maxW) {
          rows.push(chunk);
          chunk = ch;
        } else {
          chunk += ch;
        }
      }
      cur = chunk;
    } else {
      cur = w;
    }
  }
  if (cur) rows.push(cur);
  return rows.length > 0 ? rows : [''];
}
