/**
 * Wren's avatar: movement, collision, walk animation, per-surface footstep
 * foley, and zone tracking (ARCHITECTURE.md game/player.ts).
 *
 *   updatePlayer(ctx, dt) — 8-dir normalized movement at ~70 px/s, axis-
 *     separated slide against engine/map.isSolid (corner-sampled footprint),
 *     walk-frame selection, footstep cues chosen by the tile underfoot, and
 *     state.flags.cur_zone kept current via map.zoneAt. Facing tracks the input
 *     direction (even into a wall) for the interaction probe.
 *   playerRect(state) — the collision footprint in world pixels.
 *
 * Movement is skipped while a modal owns the clock (ctx.paused). The chosen
 * walk frame is written to state.flags.player_frame (0..7: down d0/d1, up u0/u1,
 * left l0/l1, right r0/r1 — the frame order of the `player` sprite) so game.ts
 * can draw it; playerFrame() exposes the same value. Animation/footstep cadence
 * is pure presentation, driven off frame delta, so it lives module-side rather
 * than in the serialized GameState.
 */

import { TILE } from '../types';
import type { Ctx, Dir, GameState, Rect } from '../types';
import { isSolid, zoneAt } from '../engine/map';

const SPEED = 70; // px/s walk (design bible §7.6)
const HALF_W = 5; // collision footprint half-extents -> 10x10 box at the feet
const HALF_H = 5;
const EDGE = 0.001; // keep the far corners just inside the footprint's own tile
const STEP_STRIDE = 18; // px travelled between footstep foley cues
const ANIM_STRIDE = 10; // px travelled between walk-frame flips
const INV_SQRT2 = 0.7071067811865476;

/** Sprite base frame per facing (each direction has a 2-frame walk pair). */
const DIR_BASE: Record<Dir, number> = { down: 0, up: 2, left: 4, right: 6 };

// Presentation-only cadence state (not game logic, not serialized).
let stepDist = STEP_STRIDE;
let animDist = 0;
let subframe = 0;
let footLeft = false;
let warnedRoom = '';

/** Map the tile underfoot to a footstep cue id (engine/audio.ts cue names). */
function footstepCue(tile: string | null): string {
  switch (tile) {
    case 'boardwalk':
    case 'floor_wood':
      return 'footstep_wood';
    case 'sand':
      return 'footstep_sand';
    case 'grass':
    case 'marsh':
      return 'footstep_grass';
    case 'road':
    case 'sidewalk':
    case 'floor_tile':
    default:
      // road/sidewalk/tile plus any other hard walkable (dirt, rail, concrete
      // pool floor): the municipal footstep.
      return 'footstep_road';
  }
}

/** Tile type at the player's feet in the current room, or null if off-grid. */
function surfaceTile(ctx: Ctx, s: GameState): string | null {
  const room = ctx.map.rooms[s.player.room];
  if (!room) return null;
  const tx = Math.floor(s.player.pos.x / TILE);
  const ty = Math.floor(s.player.pos.y / TILE);
  if (tx < 0 || ty < 0 || tx >= room.width || ty >= room.height) return null;
  return room.tiles[ty * room.width + tx] ?? null;
}

/** Any corner of the footprint centred at (cx,cy) in a solid cell? */
function collides(ctx: Ctx, room: string, cx: number, cy: number): boolean {
  const l = cx - HALF_W;
  const r = cx + HALF_W - EDGE;
  const t = cy - HALF_H;
  const b = cy + HALF_H - EDGE;
  return (
    isSolid(ctx.map, room, l, t) ||
    isSolid(ctx.map, room, r, t) ||
    isSolid(ctx.map, room, l, b) ||
    isSolid(ctx.map, room, r, b)
  );
}

export function updatePlayer(ctx: Ctx, dt: number): void {
  const s = ctx.state;
  const p = s.player;

  // Intended direction (zeroed while a modal freezes the clock).
  let ix = ctx.paused ? 0 : ctx.input.moveX;
  let iy = ctx.paused ? 0 : ctx.input.moveY;
  ix = ix < -1 ? -1 : ix > 1 ? 1 : ix;
  iy = iy < -1 ? -1 : iy > 1 ? 1 : iy;
  const moving = ix !== 0 || iy !== 0;

  // Facing follows input, horizontal wins ties (more legible sprite), and it
  // updates even when a wall blocks the step so the interaction probe aims
  // where the player is trying to go.
  if (moving) {
    if (ix !== 0 && Math.abs(ix) >= Math.abs(iy)) p.facing = ix < 0 ? 'left' : 'right';
    else if (iy !== 0) p.facing = iy < 0 ? 'up' : 'down';
  }

  // Normalize so diagonals aren't faster than cardinals.
  let nx = ix;
  let ny = iy;
  if (ix !== 0 && iy !== 0) {
    nx *= INV_SQRT2;
    ny *= INV_SQRT2;
  }

  const room = p.room;
  const known = !!ctx.map.rooms[room];
  if (!known && room !== warnedRoom) {
    console.warn(`[player] room '${room}' not in compiled map; moving without collision`);
    warnedRoom = room;
  }

  const startX = p.pos.x;
  const startY = p.pos.y;
  const dx = nx * SPEED * dt;
  const dy = ny * SPEED * dt;

  // Axis-separated slide: block one axis without stopping the other.
  if (dx !== 0) {
    const cand = p.pos.x + dx;
    if (!known || !collides(ctx, room, cand, p.pos.y)) p.pos.x = cand;
  }
  if (dy !== 0) {
    const cand = p.pos.y + dy;
    if (!known || !collides(ctx, room, p.pos.x, cand)) p.pos.y = cand;
  }

  const movedDist = Math.hypot(p.pos.x - startX, p.pos.y - startY);
  const walking = moving && movedDist > 0.01;

  // Walk-frame selection: flip the 2-frame pair every ANIM_STRIDE of travel;
  // stand on the base frame when idle or pinned against a wall.
  if (walking) {
    animDist += movedDist;
    while (animDist >= ANIM_STRIDE) {
      animDist -= ANIM_STRIDE;
      subframe ^= 1;
    }
  } else {
    animDist = 0;
    subframe = 0;
  }
  s.flags.player_frame = DIR_BASE[p.facing] + subframe;

  // Footstep foley: cadence by distance, surface by the tile underfoot,
  // gently panned left/right for a stride feel.
  if (walking) {
    stepDist += movedDist;
    if (stepDist >= STEP_STRIDE) {
      stepDist -= STEP_STRIDE;
      footLeft = !footLeft;
      ctx.audio.cue(footstepCue(surfaceTile(ctx, s)), {
        volume: 0.5,
        pan: footLeft ? -0.12 : 0.12,
      });
    }
  } else {
    stepDist = STEP_STRIDE; // primed so the first step on moving lands promptly
  }

  // Zone tracking: outdoor ZoneId if inside a zone rect, else the room id
  // (interiors carry no zones, so this reads e.g. 'diner', 'town').
  const zone = zoneAt(ctx.map, room, p.pos);
  s.flags.cur_zone = zone ?? room;
}

/** Collision footprint in world pixels (feet box, centred on player.pos). */
export function playerRect(state: GameState): Rect {
  return {
    x: state.player.pos.x - HALF_W,
    y: state.player.pos.y - HALF_H,
    w: HALF_W * 2,
    h: HALF_H * 2,
  };
}

/** Current sprite frame (0..7) for the `player` sprite; mirrors the value
 *  updatePlayer writes to state.flags.player_frame. */
export function playerFrame(state: GameState): number {
  const f = state.flags.player_frame;
  return typeof f === 'number' ? f : (DIR_BASE[state.player.facing] ?? 0);
}
