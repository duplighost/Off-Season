/**
 * Debug pane (built in M0). Day-warp, clock-scrub, stat editors, teleport,
 * flag inspector, the director's planned events, and the M1 "Day 7 mode"
 * contrast toggle that force-applies late-game palette/audio/decay on Day 1 —
 * the slice whose whole job is to prove the delta.
 */

import type { Ctx, Renderer, ZoneId } from '../types';
import { SCREEN_H } from '../types';
import { startDay } from '../systems/time';
import { anchorPos } from '../engine/map';

interface Btn {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  onClick: (ctx: Ctx) => void;
}

let scroll = 0;

function buildButtons(ctx: Ctx): Btn[] {
  const b: Btn[] = [];
  const s = ctx.state;
  let y = 16;
  const row = (label: string, onClick: (c: Ctx) => void, x = 6, w = 70) => {
    b.push({ x, y, w, h: 11, label, onClick });
  };

  // Day warp
  row('Day-', (c) => startDay(c, Math.max(1, c.state.day - 1)), 6, 34);
  row(`D${s.day}`, () => {}, 42, 24);
  row('Day+', (c) => startDay(c, Math.min(9, c.state.day + 1)), 68, 34);
  y += 14;

  // Clock scrub
  row('Clk-', (c) => (c.state.clockMin = Math.max(0, c.state.clockMin - 30)), 6, 34);
  row('Clk+', (c) => (c.state.clockMin = Math.min(24 * 60, c.state.clockMin + 30)), 42, 34);
  y += 14;

  // Stats
  row('Susp-', (c) => (c.state.suspicion = Math.max(0, c.state.suspicion - 5)), 6, 40);
  row(`S${Math.round(s.suspicion)}`, () => {}, 48, 30);
  row('Susp+', (c) => (c.state.suspicion = Math.min(100, c.state.suspicion + 5)), 80, 40);
  y += 14;
  row('Trust-', (c) => (c.state.juneTrust = Math.max(0, c.state.juneTrust - 5)), 6, 40);
  row(`T${Math.round(s.juneTrust)}`, () => {}, 48, 30);
  row('Trust+', (c) => (c.state.juneTrust = Math.min(100, c.state.juneTrust + 5)), 80, 40);
  y += 14;
  row('Debt-', (c) => (c.state.disruptionDebt = Math.max(0, c.state.disruptionDebt - 1)), 6, 40);
  row(`W${s.disruptionDebt}`, () => {}, 48, 30);
  row('Debt+', (c) => (c.state.disruptionDebt += 1), 80, 40);
  y += 16;

  // Day 7 mode (M1 contrast toggle)
  const on = !!s.flags._day7_mode;
  row(`Day7 mode: ${on ? 'ON' : 'off'}`, (c) => (c.state.flags._day7_mode = !c.state.flags._day7_mode), 6, 120);
  y += 16;

  // Teleport to zones
  const zones: { z: ZoneId; a: string }[] = [
    { z: 'mainstreet', a: 'travel_mainstreet' },
    { z: 'boardwalk', a: 'travel_boardwalk' },
    { z: 'point', a: 'travel_point' },
    { z: 'harbor', a: 'travel_harbor' },
    { z: 'blackrock', a: 'travel_blackrock' },
    { z: 'neck', a: 'travel_neck' },
    { z: 'rockneck', a: 'travel_rockneck' },
    { z: 'marsh', a: 'travel_marsh' },
  ];
  let tx = 6;
  for (const zn of zones) {
    b.push({
      x: tx,
      y,
      w: 54,
      h: 11,
      label: zn.z.slice(0, 7),
      onClick: (c) => {
        const p = anchorPos(c.map, zn.a);
        if (p) {
          c.state.player.room = p.room;
          c.state.player.pos = { ...p.pos };
        }
      },
    });
    tx += 58;
    if (tx > 160) {
      tx = 6;
      y += 13;
    }
  }
  return b;
}

let cachedButtons: Btn[] = [];

export function updateDebug(ctx: Ctx): void {
  cachedButtons = buildButtons(ctx);
  const i = ctx.input;
  if (i.mouseClicked) {
    for (const btn of cachedButtons) {
      if (i.mouseX >= btn.x && i.mouseX <= btn.x + btn.w && i.mouseY >= btn.y && i.mouseY <= btn.y + btn.h) {
        btn.onClick(ctx);
        cachedButtons = buildButtons(ctx);
        break;
      }
    }
  }
  if (i.debugPressed) ctx.ui.pop();
}

export function drawDebug(ctx: Ctx, r: Renderer): void {
  const panelW = 210;
  r.rect(0, 0, panelW, SCREEN_H, 0, 0.82);
  r.text('DEBUG', 6, 4, 14);

  for (const btn of cachedButtons) {
    const hot =
      ctx.input.mouseX >= btn.x &&
      ctx.input.mouseX <= btn.x + btn.w &&
      ctx.input.mouseY >= btn.y &&
      ctx.input.mouseY <= btn.y + btn.h;
    r.rect(btn.x, btn.y, btn.w, btn.h, hot ? 2 : 1);
    r.frame(btn.x, btn.y, btn.w, btn.h, 3);
    r.text(btn.label, btn.x + 3, btn.y + 2, 13);
  }

  // Right column: readouts.
  const rx = panelW + 6;
  let y = 6;
  r.text(`seed ${ctx.state.seed}`, rx, y, 3); y += 10;
  r.text(`zone ${ctx.state.flags.cur_zone ?? '-'}`, rx, y, 3); y += 10;
  r.text(`room ${ctx.state.player.room}`, rx, y, 3); y += 10;
  r.text(`events today: ${ctx.state.activeEvents.length}`, rx, y, 3); y += 12;

  r.text('PLANNED:', rx, y, 14); y += 10;
  for (const ev of ctx.state.activeEvents.slice(0, 10)) {
    r.text(`${ev.active ? '●' : '○'} ${ev.id.replace('evt.', '')}`, rx, y, ev.witnessed ? 15 : 3); y += 9;
  }

  // Flag list (scrollable-ish), far right.
  const fx = rx + 130;
  let fy = 6;
  r.text('FLAGS:', fx, fy, 14); fy += 10;
  const keys = Object.keys(ctx.state.flags).filter((k) => !k.startsWith('_') && !k.startsWith('chore_')).slice(scroll, scroll + 24);
  for (const k of keys) {
    const v = ctx.state.flags[k];
    r.text(`${k}=${v}`, fx, fy, 2); fy += 8;
  }
}
