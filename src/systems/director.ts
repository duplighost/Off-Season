/**
 * The Wrongness Director (design bible §7.3). An unease-budget placement system
 * pointed at dread instead of zombies: each day it spends a budget W to schedule
 * a handful of JSON-defined wrongness events, then activates them on a clock,
 * runs the cat "tell" before each, and marks events the player lingers on as
 * witnessed — which escalates that event's family the next time it spawns.
 *
 * Invariants honoured here:
 *  - Determinism: every random choice draws from the `director:{day}` stream, so
 *    the same seed + same state produces the same haunting (bible §0.2, §7.3).
 *  - The Slack is never rendered: events manifest only through their JSON block
 *    (game/manifest.ts). This module places and schedules; it draws nothing.
 *  - No narrative text: examine strings live in the event manifest (content).
 *
 * Budget:      W = DIRECTOR_BASE[day] + disruptionDebt * DEBT_MULT
 * Max/day:     2 + floor(day/3)
 * Placement:   never room 'diner'; before day 7 never two same-zone same-day.
 * Escalation:  once any member of a family is witnessed, the family's next
 *              spawn walks one rung further along its escalatesTo chain.
 */

import {
  DEBT_MULT,
  DIRECTOR_BASE,
  SCREEN_H,
  SCREEN_W,
  TILE,
} from '../types';
import type {
  ActiveEvent,
  ContentBundle,
  Ctx,
  GameState,
  NpcId,
  NpcState,
  RoomId,
  Vec,
  WrongnessEventDef,
} from '../types';
import { anchorPos, zoneAt } from '../engine/map';
import { evalCond } from './dialogue';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Activation clock window: events become visible somewhere in 10:00–22:00. */
const ACTIVATION_START = 10 * 60;
const ACTIVATION_END = 22 * 60;
/** Cat tell fires 10–40 (game-min ≈ real-sec at CLOCK_RATE 1) before activation. */
const CAT_TELL_MIN = 10;
const CAT_TELL_MAX = 40;
/** Cumulative seconds the viewport must dwell on an active event to witness it. */
const WITNESS_LINGER_SEC = 1.5;
/** Radius (px) around the Book Ark within which its cats sense an event early. */
const BOOKARK_RADIUS = 88;
/** How close (px) a cat/event must be to the player to count as "in the room". */
const NEAR_PLAYER_RADIUS = 140;

/** NPCs that can deliver the cat tell. Only Gigi is a cat in the roster; the
 *  Book Ark's other cats are ambient and carry no NpcState to drive. */
const CAT_NPCS: readonly NpcId[] = ['gigi'];

const warned = new Set<string>();
function warnOnce(key: string, msg: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(msg);
}

// ---------------------------------------------------------------------------
// Event def index (cached per content bundle)
// ---------------------------------------------------------------------------

const indexCache = new WeakMap<ContentBundle, Map<string, WrongnessEventDef>>();

function indexOf(content: ContentBundle): Map<string, WrongnessEventDef> {
  const cached = indexCache.get(content);
  if (cached) return cached;
  const byId = new Map<string, WrongnessEventDef>();
  for (const def of content.events?.events ?? []) {
    if (!def || typeof def.id !== 'string') continue;
    if (!byId.has(def.id)) byId.set(def.id, def);
    else warnOnce(`dup:${def.id}`, `[director] duplicate event id '${def.id}'; keeping first`);
  }
  indexCache.set(content, byId);
  return byId;
}

export function eventDefById(ctx: Ctx, id: string): WrongnessEventDef | null {
  return indexOf(ctx.content).get(id) ?? null;
}

// ---------------------------------------------------------------------------
// Budget & geometry helpers
// ---------------------------------------------------------------------------

function clampDayIndex(day: number): number {
  if (day < 0) return 0;
  if (day > DIRECTOR_BASE.length - 1) return DIRECTOR_BASE.length - 1;
  return Math.floor(day);
}

function budgetFor(s: GameState): number {
  const base = DIRECTOR_BASE[clampDayIndex(s.day)] ?? 0;
  return base + Math.max(0, s.disruptionDebt) * DEBT_MULT;
}

function maxEventsFor(day: number): number {
  return 2 + Math.floor(Math.max(0, day) / 3);
}

/** The key an event occupies for the "no two same-zone same-day" rule: the
 *  outdoor ZoneId when placed on the town map, else the interior room id. */
function zoneKeyOf(ctx: Ctx, room: RoomId, pos: Vec): string {
  if (room !== 'town') return room;
  return zoneAt(ctx.map, 'town', pos) ?? 'town';
}

interface AnchorOption {
  anchor: string;
  room: RoomId;
  pos: Vec;
  zoneKey: string;
}

/** All world anchors an event could manifest at: explicit placement.anchors if
 *  given, else the `evt_{zone}_1/2` anchors of each listed zone. */
function anchorOptionsFor(ctx: Ctx, def: WrongnessEventDef): AnchorOption[] {
  const out: AnchorOption[] = [];
  const seen = new Set<string>();
  const add = (name: string): void => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    const a = anchorPos(ctx.map, name);
    if (!a) {
      warnOnce(`anchor:${name}`, `[director] event anchor '${name}' not found in map`);
      return;
    }
    out.push({ anchor: name, room: a.room, pos: { x: a.pos.x, y: a.pos.y }, zoneKey: zoneKeyOf(ctx, a.room, a.pos) });
  };

  const pl = def.placement ?? {};
  if (pl.anchors && pl.anchors.length > 0) {
    for (const n of pl.anchors) add(n);
  } else {
    for (const z of pl.zones ?? []) {
      add(`evt_${z}_1`);
      add(`evt_${z}_2`);
    }
  }
  return out;
}

/** Anchor options still legal given the diner ban, the day-<7 same-zone rule,
 *  and the zones already spent this day. */
function legalAnchors(opts: AnchorOption[], usedZones: Set<string>, day: number): AnchorOption[] {
  return opts.filter((o) => {
    if (o.room === 'diner') return false; // sanctuary (§7.3)
    if (day < 7 && usedZones.has(o.zoneKey)) return false;
    return true;
  });
}

/** Follow the escalatesTo chain by the number of witnessed rungs in the family;
 *  witnessed families spawn their escalated form next (§7.3). */
function resolveEscalation(ctx: Ctx, def: WrongnessEventDef): WrongnessEventDef {
  const fam = def.family;
  if (!fam) return def;
  const rung = ctx.state.director.escalations[fam] ?? 0;
  if (rung <= 0) return def;
  let cur = def;
  for (let i = 0; i < rung; i++) {
    const nextId = cur.escalatesTo;
    if (!nextId) break;
    const nx = eventDefById(ctx, nextId);
    if (!nx || nx.id === cur.id) break;
    cur = nx;
  }
  return cur;
}

// ---------------------------------------------------------------------------
// Candidate selection
// ---------------------------------------------------------------------------

/** Base candidates eligible today: not an escalation-only target, day window /
 *  cooldown / oneShot / prereqs all satisfied. Order follows content order so
 *  `rng.pick` stays deterministic. */
function candidatePool(ctx: Ctx): WrongnessEventDef[] {
  const s = ctx.state;
  const day = s.day;
  const all = ctx.content.events?.events ?? [];

  // Events reachable only through escalation are never picked directly.
  const escalationTargets = new Set<string>();
  for (const def of all) {
    if (def && typeof def.escalatesTo === 'string') escalationTargets.add(def.escalatesTo);
  }

  const dir = s.director;
  return all.filter((def) => {
    if (!def || typeof def.id !== 'string') return false;
    if (escalationTargets.has(def.id)) return false;

    const pl = def.placement ?? {};
    if (typeof pl.minDay === 'number' && day < pl.minDay) return false;
    if (typeof pl.maxDay === 'number' && day > pl.maxDay) return false;

    if (def.oneShot && dir.oneShotsUsed.includes(def.id)) return false;

    const cd = def.cooldownDays ?? 0;
    if (cd > 0) {
      const last = dir.placedDays[def.id];
      if (typeof last === 'number' && day - last < cd) return false;
    }

    if (def.prereqs && def.prereqs.length > 0) {
      for (const pr of def.prereqs) if (!evalCond(s, pr)) return false;
    }
    return true;
  });
}

interface PlacementPlan {
  candidate: WrongnessEventDef;
  placed: WrongnessEventDef;
  cost: number;
  opts: AnchorOption[];
}

/** Resolve a base candidate into a concrete, affordable, legally-placeable plan
 *  for the current loop state, or null if it can't go down right now. */
function tryPlan(
  ctx: Ctx,
  candidate: WrongnessEventDef,
  remaining: number,
  usedZones: Set<string>,
  day: number,
): PlacementPlan | null {
  const placed = resolveEscalation(ctx, candidate);
  const cost = Math.max(0, placed.cost ?? candidate.cost ?? 0);
  if (cost > remaining) return null;
  const opts = legalAnchors(anchorOptionsFor(ctx, placed), usedZones, day);
  if (opts.length === 0) return null;
  return { candidate, placed, cost, opts };
}

// ---------------------------------------------------------------------------
// planDay — called at dayStart
// ---------------------------------------------------------------------------

export function planDay(ctx: Ctx): void {
  const s = ctx.state;
  const day = s.day;
  const rng = ctx.rng.stream(`director:${day}`);

  // A new day sweeps yesterday's manifestations and schedule drift away.
  s.activeEvents = [];
  for (const npc of Object.values(s.npcs)) {
    if (npc) npc.deviation = null;
  }

  const W = budgetFor(s);
  const maxEvents = maxEventsFor(day);

  let avail = candidatePool(ctx);
  const usedZones = new Set<string>();
  let spent = 0;

  while (s.activeEvents.length < maxEvents && spent < W && avail.length > 0) {
    const remaining = W - spent;
    const plans: PlacementPlan[] = [];
    for (const c of avail) {
      const p = tryPlan(ctx, c, remaining, usedZones, day);
      if (p) plans.push(p);
    }
    if (plans.length === 0) break;

    const plan = rng.pick(plans);
    const chosen = rng.pick(plan.opts);
    const activatesAtClock =
      ACTIVATION_START + rng.int(ACTIVATION_END - ACTIVATION_START + 1);
    const catTellAt = plan.placed.catTell
      ? CAT_TELL_MIN + rng.int(CAT_TELL_MAX - CAT_TELL_MIN + 1)
      : undefined;

    const ev: ActiveEvent = {
      id: plan.placed.id,
      day,
      room: chosen.room,
      anchor: chosen.anchor,
      pos: { x: chosen.pos.x, y: chosen.pos.y },
      witnessed: false,
      lingerSec: 0,
      activatesAtClock,
      active: false,
    };
    if (catTellAt !== undefined) ev.catTellAt = catTellAt;
    s.activeEvents.push(ev);

    usedZones.add(chosen.zoneKey);
    spent += plan.cost;

    // Bookkeeping: cooldowns key on the base id (the recurring candidate) and
    // on the placed id; oneShots record whichever forms are single-use.
    s.director.placedDays[plan.candidate.id] = day;
    if (plan.placed.id !== plan.candidate.id) s.director.placedDays[plan.placed.id] = day;
    if (plan.candidate.oneShot && !s.director.oneShotsUsed.includes(plan.candidate.id)) {
      s.director.oneShotsUsed.push(plan.candidate.id);
    }
    if (plan.placed.oneShot && !s.director.oneShotsUsed.includes(plan.placed.id)) {
      s.director.oneShotsUsed.push(plan.placed.id);
    }

    // Schedule drift: hand the def id to the NPC; systems/schedule.ts reads the
    // manifest for the deviation activity + anchor.
    if (plan.placed.manifest?.kind === 'npc_deviation' && plan.placed.manifest.npc) {
      const npc = s.npcs[plan.placed.manifest.npc];
      if (npc) npc.deviation = plan.placed.id;
    }

    avail = avail.filter((c) => c.id !== plan.candidate.id);
  }

  s.director.spent[String(day)] = spent;
}

// ---------------------------------------------------------------------------
// updateDirector — per frame: activation, cat tell, witnessing
// ---------------------------------------------------------------------------

function faceToward(npc: NpcState, tx: number, ty: number): void {
  const dx = tx - npc.pos.x;
  const dy = ty - npc.pos.y;
  if (Math.abs(dx) >= Math.abs(dy)) npc.facing = dx < 0 ? 'left' : 'right';
  else npc.facing = dy < 0 ? 'up' : 'down';
}

/** Approximate the camera the way game.ts frames the world: centred on the
 *  player, clamped to room bounds. Used only for witnessing (real-time, not
 *  seeded), so a small mismatch at map edges is harmless. */
function viewportContains(ctx: Ctx, pos: Vec): boolean {
  const s = ctx.state;
  const room = ctx.map.rooms[s.player.room];
  const roomW = room ? room.width * TILE : SCREEN_W;
  const roomH = room ? room.height * TILE : SCREEN_H;
  const p = s.player.pos;
  let camX = p.x - SCREEN_W / 2;
  let camY = p.y - SCREEN_H / 2;
  camX = Math.max(0, Math.min(camX, Math.max(0, roomW - SCREEN_W)));
  camY = Math.max(0, Math.min(camY, Math.max(0, roomH - SCREEN_H)));
  return pos.x >= camX && pos.x < camX + SCREEN_W && pos.y >= camY && pos.y < camY + SCREEN_H;
}

function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function bookarkAnchor(ctx: Ctx): { room: RoomId; pos: Vec } | null {
  return anchorPos(ctx.map, 'bookark_door');
}

/** Is the event near the Book Ark (interior, or within radius of its door)? */
function eventNearBookark(ctx: Ctx, ev: ActiveEvent, bookark: { room: RoomId; pos: Vec } | null): boolean {
  if (ev.room === 'bookark') return true;
  if (!bookark || bookark.room !== ev.room) return false;
  return dist(ev.pos, bookark.pos) <= BOOKARK_RADIUS;
}

function updateCatTells(ctx: Ctx): void {
  const s = ctx.state;
  const bookark = bookarkAnchor(ctx);
  const player = s.player;
  const playerZone = typeof s.flags.cur_zone === 'string' ? s.flags.cur_zone : player.room;

  for (const ev of s.activeEvents) {
    if (ev.catTellAt === undefined || ev.active) continue;
    const tell = ev.catTellAt ?? 0;
    const remaining = ev.activatesAtClock - s.clockMin;
    if (remaining <= 0 || remaining > tell) continue; // outside the tell window

    const inBookark = eventNearBookark(ctx, ev, bookark);
    const evZone = zoneKeyOf(ctx, ev.room, ev.pos);
    const nearPlayer =
      ev.room === player.room && (evZone === playerZone || dist(ev.pos, player.pos) <= NEAR_PLAYER_RADIUS);
    if (!inBookark && !nearPlayer) continue;

    for (const catId of CAT_NPCS) {
      const cat = s.npcs[catId];
      if (!cat) continue;
      const catWithPlayer = !!cat.following || cat.room === player.room;
      const catAtBookark = !!bookark && cat.room === bookark.room && dist(cat.pos, bookark.pos) <= BOOKARK_RADIUS;
      const delivers = (nearPlayer && catWithPlayer) || (inBookark && (catAtBookark || catWithPlayer));
      if (!delivers) continue;
      cat.activity = `stare_at:${Math.round(ev.pos.x)},${Math.round(ev.pos.y)}`;
      faceToward(cat, ev.pos.x, ev.pos.y);
    }
  }
}

export function updateDirector(ctx: Ctx, dt: number): void {
  const s = ctx.state;

  // Activation: an event becomes visible once the clock reaches its slot.
  for (const ev of s.activeEvents) {
    if (!ev.active && s.clockMin >= ev.activatesAtClock) ev.active = true;
  }

  // Cat tell: the town's early-warning system stares just before the wrongness.
  updateCatTells(ctx);

  // Witnessing: a modal freezes the world, so only the walkable frame counts.
  if (!ctx.paused && dt > 0) {
    const playerRoom = s.player.room;
    for (const ev of s.activeEvents) {
      if (!ev.active || ev.witnessed) continue;
      if (ev.room !== playerRoom) continue;
      if (!viewportContains(ctx, ev.pos)) continue;

      ev.lingerSec += dt;
      if (ev.lingerSec >= WITNESS_LINGER_SEC) {
        ev.witnessed = true;
        if (!s.director.witnessed.includes(ev.id)) s.director.witnessed.push(ev.id);
        const def = eventDefById(ctx, ev.id);
        const fam = def?.family;
        if (fam) s.director.escalations[fam] = (s.director.escalations[fam] ?? 0) + 1;
        ctx.bus.emit({ type: 'eventWitnessed', eventId: ev.id });
      }
    }
  }
}
