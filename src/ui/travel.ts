/**
 * Truck travel (§7.1). The truck is a key and a fast-travel menu; driving
 * eats a few minutes of daylight and the radio rides along.
 */

import type { Ctx, Renderer, ZoneId } from '../types';
import { SCREEN_H, SCREEN_W } from '../types';
import { anchorPos } from '../engine/map';

interface Dest {
  anchor: string;
  zone: ZoneId;
  label: string;
}

let selected = 0;
let dests: Dest[] = [];

const ZONE_ANCHORS: { anchor: string; zone: ZoneId; strKey: string }[] = [
  { anchor: 'travel_mainstreet', zone: 'mainstreet', strKey: 'zone_mainstreet' },
  { anchor: 'travel_boardwalk', zone: 'boardwalk', strKey: 'zone_boardwalk' },
  { anchor: 'travel_point', zone: 'point', strKey: 'zone_point' },
  { anchor: 'travel_harbor', zone: 'harbor', strKey: 'zone_harbor' },
  { anchor: 'travel_blackrock', zone: 'blackrock', strKey: 'zone_blackrock' },
  { anchor: 'travel_neck', zone: 'neck', strKey: 'zone_neck' },
  { anchor: 'travel_rockneck', zone: 'rockneck', strKey: 'zone_rockneck' },
  { anchor: 'travel_marsh', zone: 'marsh', strKey: 'zone_marsh' },
];

export function startTravel(ctx: Ctx): void {
  dests = ZONE_ANCHORS.map((z) => ({
    anchor: z.anchor,
    zone: z.zone,
    label: ctx.content.strings?.[z.strKey] ?? z.zone,
  }));
  selected = 0;
  ctx.ui.push('travel');
}

export function updateTravel(ctx: Ctx): void {
  const i = ctx.input;
  if (i.upPressed) selected = (selected - 1 + dests.length) % dests.length;
  if (i.downPressed) selected = (selected + 1) % dests.length;
  if (i.cancelPressed) {
    ctx.ui.pop();
    return;
  }
  if (i.confirmPressed) {
    const d = dests[selected];
    const pos = anchorPos(ctx.map, d.anchor);
    if (pos) {
      ctx.state.player.room = pos.room;
      ctx.state.player.pos = { ...pos.pos };
      ctx.state.clockMin = Math.min(24 * 60, ctx.state.clockMin + 8);
      ctx.audio.cue('door');
    }
    ctx.ui.pop();
  }
}

export function drawTravel(ctx: Ctx, r: Renderer): void {
  const bw = 180;
  const bh = 20 + dests.length * 14;
  const bx = Math.floor((SCREEN_W - bw) / 2);
  const by = Math.floor((SCREEN_H - bh) / 2);
  r.rect(0, 0, SCREEN_W, SCREEN_H, 0, 0.6);
  r.rect(bx, by, bw, bh, 1);
  r.frame(bx, by, bw, bh, 3);
  r.text(ctx.content.strings?.travel_title ?? 'DRIVE TO…', bx + 10, by + 6, 15);
  let y = by + 20;
  dests.forEach((d, i) => {
    const sel = i === selected;
    if (sel) r.text('>', bx + 6, y, 15);
    r.text(d.label, bx + 16, y, sel ? 15 : 13);
    y += 14;
  });
}
