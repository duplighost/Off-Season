/**
 * NPC rendering + interaction probe (ARCHITECTURE.md game/npc.ts).
 *
 *   drawNpcs(ctx, r, cam) — draws every NPC in the player's room, y-sorted so
 *     nearer bodies overlap farther ones. Humanoids are 16×24 two-frame sprites
 *     (idle frame 0 / walk frame 1); facing is expressed by a horizontal flip
 *     (the sprites face the camera, so only left/right read differently). Gigi
 *     draws as the tuxedo cat. Movement animation is derived from how far a body
 *     has travelled since the last frame — pure presentation, never serialized.
 *     Two special poses: the Low-Tide Club raises a hand (frame 1) when their
 *     slot waves and Wren is within 60 px, and a sitting/idle body holds frame 0.
 *
 *   npcAt(ctx, pos, radius) — the interaction probe: the nearest NPC in the
 *     player's room within `radius` of the probe point, or null.
 *
 * All positions are world pixels with the NPC's `pos` as the feet baseline; the
 * renderer's active camera (set in r.begin) does the world→screen transform and
 * off-screen culling, so this module passes world coordinates straight through.
 */

import type { Camera, Ctx, NpcId, NpcState, Renderer, Vec } from '../types';
import { slotFor } from '../systems/schedule';

// Sprite dimensions by kind (must match engine/sprites.ts registrations).
const HUMAN_W = 16;
const HUMAN_H = 24;
const CAT_W = 12;
const CAT_H = 10;

/** Distance a body must travel (px) between walk-frame flips. */
const ANIM_STRIDE = 8;
/** Below this per-frame travel a body is considered standing still. */
const MOVE_EPS = 0.06;
/** The Low-Tide Club waves when Wren comes within this range. */
const WAVE_RANGE = 60;

/** NpcId -> sprite id. Gigi is the tuxedo cat; everyone else is `npc_<id>`. */
function spriteFor(id: NpcId): string {
  return id === 'gigi' ? 'cat_tuxedo' : `npc_${id}`;
}

function isCat(id: NpcId): boolean {
  return id === 'gigi';
}

// ---------------------------------------------------------------------------
// Per-NPC animation cadence (presentation state, module-side, not in the save)
// ---------------------------------------------------------------------------

interface AnimState {
  room: string;
  lx: number;
  ly: number;
  dist: number;
  frame: 0 | 1;
}

const anim = new Map<NpcId, AnimState>();

function animFor(npc: NpcState): AnimState {
  let a = anim.get(npc.id);
  if (!a) {
    a = { room: npc.room, lx: npc.pos.x, ly: npc.pos.y, dist: 0, frame: 0 };
    anim.set(npc.id, a);
  }
  return a;
}

/** True when this NPC should show the raised-hand wave frame. */
function wantsWave(ctx: Ctx, npc: NpcState): boolean {
  if (npc.deviation) return false; // Day 8: they stop waving because they listen
  const player = ctx.state.player;
  if (npc.room !== player.room) return false;
  const slot = slotFor(ctx, npc.id);
  if (!slot?.waveAtPlayer) return false;
  return Math.hypot(npc.pos.x - player.pos.x, npc.pos.y - player.pos.y) <= WAVE_RANGE;
}

/** Which sprite frame to draw this NPC on. */
function frameFor(ctx: Ctx, npc: NpcState): number {
  if (wantsWave(ctx, npc)) return 1;

  const a = animFor(npc);
  // Reset the cadence across a teleport / room change so a big jump doesn't
  // read as a stride.
  if (a.room !== npc.room) {
    a.room = npc.room;
    a.lx = npc.pos.x;
    a.ly = npc.pos.y;
    a.dist = 0;
    a.frame = 0;
    return 0;
  }

  const d = Math.hypot(npc.pos.x - a.lx, npc.pos.y - a.ly);
  a.lx = npc.pos.x;
  a.ly = npc.pos.y;

  if (d > MOVE_EPS) {
    a.dist += d;
    while (a.dist >= ANIM_STRIDE) {
      a.dist -= ANIM_STRIDE;
      a.frame = a.frame === 0 ? 1 : 0;
    }
    return a.frame;
  }

  // Standing (idle / sitting): hold the resting frame.
  a.dist = 0;
  a.frame = 0;
  return 0;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

export function drawNpcs(ctx: Ctx, r: Renderer, _cam: Camera): void {
  const s = ctx.state;
  if (!s.npcs) return;
  const room = s.player.room;

  const here: NpcState[] = [];
  for (const npc of Object.values(s.npcs)) {
    if (npc && npc.room === room) here.push(npc);
  }
  // Y-sort by the feet baseline so lower sprites paint on top.
  here.sort((a, b) => a.pos.y - b.pos.y);

  for (const npc of here) {
    const cat = isCat(npc.id);
    const w = cat ? CAT_W : HUMAN_W;
    const h = cat ? CAT_H : HUMAN_H;
    const frame = frameFor(ctx, npc);
    const flipX = npc.facing === 'left';
    // Bottom-centre the sprite on pos (pos.y is the feet line = the sort key).
    const wx = Math.round(npc.pos.x - w / 2);
    const wy = Math.round(npc.pos.y - h);
    r.drawSprite(spriteFor(npc.id), wx, wy, { frame, flipX });
  }
}

// ---------------------------------------------------------------------------
// Interaction probe
// ---------------------------------------------------------------------------

/** Nearest interactable NPC in the player's room within `radius` of `pos`. */
export function npcAt(ctx: Ctx, pos: Vec, radius: number): NpcState | null {
  const s = ctx.state;
  if (!s.npcs) return null;
  const room = s.player.room;
  const r2 = radius * radius;
  let best: NpcState | null = null;
  let bestD2 = Infinity;
  for (const npc of Object.values(s.npcs)) {
    if (!npc || npc.room !== room) continue;
    const dx = npc.pos.x - pos.x;
    const dy = npc.pos.y - pos.y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= r2 && d2 < bestD2) {
      bestD2 = d2;
      best = npc;
    }
  }
  return best;
}
