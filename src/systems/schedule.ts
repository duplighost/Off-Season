/**
 * NPC schedule + steering (§7.4, ARCHITECTURE.md systems/schedule.ts).
 *
 * Each frame `updateNpcs` resolves every NPC's target for the current day/clock
 * and moves them toward it:
 *   - Same room as the player and near the viewport  → walk (~55 px/s) with
 *     axis-separated collision slide against engine/map.isSolid.
 *   - Same room but off-screen                        → snap to the anchor
 *     (nobody sees the pop; they're simply in place when the player arrives).
 *   - Different target room, NPC not visible          → teleport to the anchor.
 *   - Different target room, NPC on-screen            → stall until the player
 *     looks away (no vanishing act in front of the camera).
 * On a day roll-over everyone snaps to their opening slot (§save.ts note).
 *
 * A director-set `deviation` (an event def id on the NpcState) overrides the
 * scheduled slot: the event's manifest supplies the deviation activity and,
 * optionally, a different anchor to stand at. Activity strings drive facing —
 * `stand_facing_water` faces south, `stare_at:{x},{y}` faces that point, and a
 * `waveAtPlayer` slot turns to greet a nearby Wren. Gigi, once adopted, ignores
 * her schedule and trails ~20 px behind the player, sitting when he stands.
 *
 * This module holds no narrative text; slot metadata and activity ids come from
 * content JSON. Determinism is preserved — no wall-clock, no Math.random.
 */

import { SCREEN_H, SCREEN_W } from '../types';
import type {
  Bus,
  Ctx,
  Dir,
  NpcId,
  NpcState,
  ScheduleSlot,
  Vec,
  WrongnessEventDef,
} from '../types';
import { anchorPos, isSolid } from '../engine/map';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const WALK_SPEED = 55; // px/s — NPCs stroll slower than the player's 70
const GIGI_SPEED = 80; // the cat trots to keep the tether taut
const TRAIL = 20; // px Gigi trails behind Wren
const SIT_NEAR = 34; // within this of the player, a still Wren = a sitting cat
const ARRIVE = 2; // px: close enough to the anchor to stop and idle
const FOOT_HALF = 5; // collision footprint half-extent (matches player.ts)
const EDGE = 0.001; // keep the far corners inside their own tile
const WAVE_LOOK = 90; // turn to face the player to greet within this range
/** Viewport half-size + a small margin, so NPCs start walking just off-screen
 *  rather than popping into a stride once fully in frame. */
const VIEW_MX = SCREEN_W / 2 + 24;
const VIEW_MY = SCREEN_H / 2 + 24;

// ---------------------------------------------------------------------------
// Small utilities (no game-logic randomness here)
// ---------------------------------------------------------------------------

const warned = new Set<string>();
function warnOnce(key: string, msg: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  if (typeof console !== 'undefined') console.warn(msg);
}

/** "16:10" -> 970 minutes. Local (no cycle onto systems/time.ts). */
function parseClockMin(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec((s ?? '').trim());
  if (!m) return NaN;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/** Is `clock` inside [start,end)? end<=start wraps past midnight. */
function slotActive(slot: ScheduleSlot, clock: number): boolean {
  const start = parseClockMin(slot.start);
  const end = parseClockMin(slot.end);
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  if (end <= start) return clock >= start || clock < end; // wraps midnight
  return clock >= start && clock < end;
}

function facingVec(d: Dir): Vec {
  switch (d) {
    case 'up':
      return { x: 0, y: -1 };
    case 'down':
      return { x: 0, y: 1 };
    case 'left':
      return { x: -1, y: 0 };
    default:
      return { x: 1, y: 0 };
  }
}

/** Point the given NPC at a world coordinate (dominant axis wins). */
function faceToward(npc: NpcState, tx: number, ty: number): void {
  const dx = tx - npc.pos.x;
  const dy = ty - npc.pos.y;
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return;
  if (Math.abs(dx) >= Math.abs(dy)) npc.facing = dx < 0 ? 'left' : 'right';
  else npc.facing = dy < 0 ? 'up' : 'down';
}

/** Parse the "stare_at:x,y" activity into a world point, or null. */
function parseStarePoint(activity: string): Vec | null {
  const i = activity.indexOf(':');
  if (i < 0) return null;
  const parts = activity.slice(i + 1).split(',');
  if (parts.length < 2) return null;
  const x = parseFloat(parts[0]);
  const y = parseFloat(parts[1]);
  if (Number.isNaN(x) || Number.isNaN(y)) return null;
  return { x, y };
}

function eventDef(ctx: Ctx, id: string): WrongnessEventDef | null {
  for (const e of ctx.content.events?.events ?? []) {
    if (e && e.id === id) return e;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Slot resolution
// ---------------------------------------------------------------------------

/** The NPC's active schedule slot for the current day+clock, or null. */
export function slotFor(ctx: Ctx, npc: NpcId): ScheduleSlot | null {
  const file = ctx.content.schedules;
  const list = file?.schedules;
  if (!Array.isArray(list) || list.length === 0) return null;
  const { day, clockMin } = ctx.state;
  for (const sched of list) {
    if (!sched || sched.npc !== npc) continue;
    if (!Array.isArray(sched.day) || !sched.day.includes(day)) continue;
    for (const slot of sched.slots ?? []) {
      if (slot && slotActive(slot, clockMin)) return slot;
    }
  }
  return null;
}

interface Target {
  room: string;
  pos: Vec;
  activity: string;
}

/** Target implied by a director deviation: the deviation activity, and either
 *  a fixed anchor from the event manifest or the NPC's current position. */
function deviationTarget(ctx: Ctx, npc: NpcState): Target {
  const def = eventDef(ctx, String(npc.deviation));
  const man = def?.manifest;
  const activity = man && man.deviation ? man.deviation : npc.activity || 'idle';
  const anchorName = man?.anchor;
  if (anchorName) {
    const ap = anchorPos(ctx.map, anchorName);
    if (ap) return { room: ap.room, pos: { x: ap.pos.x, y: ap.pos.y }, activity };
    warnOnce(`anchor:${anchorName}`, `[schedule] deviation anchor '${anchorName}' not found`);
  }
  return { room: npc.room, pos: { x: npc.pos.x, y: npc.pos.y }, activity };
}

/** Target implied by a schedule slot. */
function slotTarget(ctx: Ctx, npc: NpcState, slot: ScheduleSlot): Target {
  const activity = slot.activity || 'idle';
  const ap = anchorPos(ctx.map, slot.anchor);
  if (ap) return { room: ap.room, pos: { x: ap.pos.x, y: ap.pos.y }, activity };
  warnOnce(`anchor:${slot.anchor}`, `[schedule] slot anchor '${slot.anchor}' not found`);
  return { room: npc.room, pos: { x: npc.pos.x, y: npc.pos.y }, activity };
}

// ---------------------------------------------------------------------------
// Collision + steering
// ---------------------------------------------------------------------------

/** Any corner of a foot-box centred at (cx,cy) in a solid cell of `room`? */
function blocked(ctx: Ctx, room: string, cx: number, cy: number): boolean {
  const l = cx - FOOT_HALF;
  const r = cx + FOOT_HALF - EDGE;
  const t = cy - FOOT_HALF;
  const b = cy + FOOT_HALF - EDGE;
  return (
    isSolid(ctx.map, room, l, t) ||
    isSolid(ctx.map, room, r, t) ||
    isSolid(ctx.map, room, l, b) ||
    isSolid(ctx.map, room, r, b)
  );
}

/** Step toward (tx,ty), axis-separated so walls slide. Sets facing and returns
 *  true when it actually advanced (arrival snaps and returns false = idle). */
function stepToward(ctx: Ctx, npc: NpcState, tx: number, ty: number, maxStep: number): boolean {
  const dx = tx - npc.pos.x;
  const dy = ty - npc.pos.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= ARRIVE) {
    npc.pos.x = tx;
    npc.pos.y = ty;
    return false;
  }
  const step = Math.min(maxStep, dist);
  if (step <= 0) return false;
  const nx = (dx / dist) * step;
  const ny = (dy / dist) * step;
  let moved = false;
  if (nx !== 0 && !blocked(ctx, npc.room, npc.pos.x + nx, npc.pos.y)) {
    npc.pos.x += nx;
    moved = true;
  }
  if (ny !== 0 && !blocked(ctx, npc.room, npc.pos.x, npc.pos.y + ny)) {
    npc.pos.y += ny;
    moved = true;
  }
  if (moved) faceToward(npc, tx, ty);
  return moved;
}

function inViewport(a: Vec, b: Vec): boolean {
  return Math.abs(a.x - b.x) <= VIEW_MX && Math.abs(a.y - b.y) <= VIEW_MY;
}

/**
 * Move an NPC toward its target, choosing walk / snap / teleport by visibility.
 * Returns true if it visibly walked (so the caller leaves facing alone).
 */
function moveNpc(ctx: Ctx, npc: NpcState, target: Target, dt: number): boolean {
  const player = ctx.state.player;
  const sameRoomAsPlayer = npc.room === player.room;
  const onScreen = sameRoomAsPlayer && inViewport(npc.pos, player.pos);

  if (npc.room !== target.room) {
    // Crossing rooms: teleport only while unseen; otherwise wait a beat.
    if (!onScreen) {
      npc.room = target.room;
      npc.pos.x = target.pos.x;
      npc.pos.y = target.pos.y;
    }
    return false;
  }

  if (onScreen) return stepToward(ctx, npc, target.pos.x, target.pos.y, WALK_SPEED * dt);

  // Same room, off-screen: instantly in place, no wasted pathing.
  npc.pos.x = target.pos.x;
  npc.pos.y = target.pos.y;
  return false;
}

/** Facing for a standing NPC, from its activity (and greeting behaviour). */
function applyIdleFacing(ctx: Ctx, npc: NpcState, activity: string, slot: ScheduleSlot | null): void {
  if (activity.startsWith('stare_at:')) {
    const pt = parseStarePoint(activity);
    if (pt) faceToward(npc, pt.x, pt.y);
    return;
  }
  if (activity === 'stand_facing_water') {
    npc.facing = 'down'; // the Sound is to the south
    return;
  }
  if (slot?.waveAtPlayer) {
    const p = ctx.state.player;
    if (npc.room === p.room && Math.hypot(npc.pos.x - p.pos.x, npc.pos.y - p.pos.y) <= WAVE_LOOK) {
      faceToward(npc, p.pos.x, p.pos.y);
    }
  }
}

// ---------------------------------------------------------------------------
// Gigi (follow behaviour)
// ---------------------------------------------------------------------------

function behindPoint(ctx: Ctx): Vec {
  const p = ctx.state.player;
  const v = facingVec(p.facing);
  return { x: p.pos.x - v.x * TRAIL, y: p.pos.y - v.y * TRAIL };
}

function playerMoving(ctx: Ctx): boolean {
  if (ctx.paused) return false;
  return Math.abs(ctx.input.moveX) > 0.01 || Math.abs(ctx.input.moveY) > 0.01;
}

function updateGigi(ctx: Ctx, gigi: NpcState, dt: number): void {
  const player = ctx.state.player;
  // She pads into whatever room Wren is in; the transition is never watched
  // (Wren is the camera), so a snap on room change reads as "she followed".
  if (gigi.room !== player.room) {
    gigi.room = player.room;
    const b = behindPoint(ctx);
    gigi.pos.x = b.x;
    gigi.pos.y = b.y;
  }

  if (playerMoving(ctx)) {
    const b = behindPoint(ctx);
    stepToward(ctx, gigi, b.x, b.y, GIGI_SPEED * dt);
    gigi.activity = 'follow';
    return;
  }

  // Wren stands still: settle to a sit once she's caught up.
  if (Math.hypot(gigi.pos.x - player.pos.x, gigi.pos.y - player.pos.y) <= SIT_NEAR) {
    gigi.activity = 'sit';
    faceToward(gigi, player.pos.x, player.pos.y);
  } else {
    const b = behindPoint(ctx);
    stepToward(ctx, gigi, b.x, b.y, GIGI_SPEED * dt);
    gigi.activity = 'follow';
  }
}

// ---------------------------------------------------------------------------
// Day roll-over snap
// ---------------------------------------------------------------------------

/** Per-run day tracker keyed on the session bus, so a fresh game (new bus) and
 *  every day change (including debug warps) triggers a one-frame snap. */
const lastDayByBus = new WeakMap<Bus, number>();

function targetFor(ctx: Ctx, npc: NpcState): { target: Target; slot: ScheduleSlot | null } | null {
  if (npc.deviation) return { target: deviationTarget(ctx, npc), slot: null };
  const slot = slotFor(ctx, npc.id);
  if (slot) return { target: slotTarget(ctx, npc, slot), slot };
  return null;
}

/** Place everyone at their opening position for the day, no walking. */
function snapAll(ctx: Ctx): void {
  for (const npc of Object.values(ctx.state.npcs)) {
    if (npc.id === 'gigi' && npc.following) {
      npc.room = ctx.state.player.room;
      const b = behindPoint(ctx);
      npc.pos.x = b.x;
      npc.pos.y = b.y;
      npc.activity = 'sit';
      continue;
    }
    const resolved = targetFor(ctx, npc);
    if (!resolved) continue;
    const { target, slot } = resolved;
    npc.room = target.room;
    npc.pos.x = target.pos.x;
    npc.pos.y = target.pos.y;
    npc.activity = target.activity;
    applyIdleFacing(ctx, npc, target.activity, slot);
  }
}

// ---------------------------------------------------------------------------
// Frame update
// ---------------------------------------------------------------------------

export function updateNpcs(ctx: Ctx, dt: number): void {
  const s = ctx.state;

  // Empty cast (defensive): nothing to steer.
  if (!s.npcs || Object.keys(s.npcs).length === 0) return;
  if (!ctx.content.schedules?.schedules?.length) {
    warnOnce('no-schedules', '[schedule] no NPC schedules in content; NPCs will idle in place');
  }

  // Snap the whole cast on a day change (the save note relies on this to place
  // NPCs that new-game parks at the origin).
  if (lastDayByBus.get(ctx.bus) !== s.day) {
    lastDayByBus.set(ctx.bus, s.day);
    snapAll(ctx);
    return; // the snap frame is authoritative; steer from next frame on
  }

  for (const npc of Object.values(s.npcs)) {
    if (npc.id === 'gigi' && npc.following) {
      updateGigi(ctx, npc, dt);
      continue;
    }

    const resolved = targetFor(ctx, npc);
    if (!resolved) continue; // nothing scheduled: hold position and pose

    const { target, slot } = resolved;
    npc.activity = target.activity;
    const walked = moveNpc(ctx, npc, target, dt);
    if (!walked) applyIdleFacing(ctx, npc, target.activity, slot);
  }
}
