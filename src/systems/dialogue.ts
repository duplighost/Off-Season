/**
 * Dialogue system: the flag-DSL evaluator, condition matching, effect
 * application, and node/bark lookup (§7.4, §9.1). This module holds no
 * narrative text — every string it returns comes from content JSON. It is the
 * bridge between the content graph and the running game state; the modal UI
 * that renders it lives in ui/dialoguebox.ts.
 *
 * The flag DSL (see DialogueConditions in types.ts):
 *   "some_flag"        — flag / stat is truthy
 *   "!some_flag"       — flag / stat is falsy
 *   "counter>=3"       — numeric compare (>= <= > < == !=), numeric RHS
 * Left-hand names resolve, in order: flags, then the named stats
 *   suspicion, juneTrust, disruptionDebt, day, clockMin, population, and
 *   signatory trust as "trust_roz" / "trust_edith" / ...
 */

import type {
  BarkPool,
  ContentBundle,
  Ctx,
  DialogueConditions,
  DialogueEffects,
  DialogueNode,
  GameState,
  NpcId,
} from '../types';
import { addSignatoryTrust, addSuspicion, addTrust } from './suspicion';
import { startScene } from './story';
import { saveGame } from '../engine/save';

// ---------------------------------------------------------------------------
// Name resolution + the DSL
// ---------------------------------------------------------------------------

function has(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** Raw value of a DSL name: a flag wins over a stat of the same name. */
function resolveRaw(state: GameState, name: string): number | boolean | string | undefined {
  if (has(state.flags, name)) return state.flags[name];
  switch (name) {
    case 'suspicion':
      return state.suspicion;
    case 'juneTrust':
      return state.juneTrust;
    case 'disruptionDebt':
      return state.disruptionDebt;
    case 'day':
      return state.day;
    case 'clockMin':
      return state.clockMin;
    case 'population':
      return state.population;
  }
  if (name.startsWith('trust_')) {
    return state.signatoryTrust[name.slice(6)];
  }
  return undefined;
}

function toNumber(v: number | boolean | string | undefined): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

function isTruthy(v: number | boolean | string | undefined): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    return s !== '' && s !== '0' && s !== 'false';
  }
  return true;
}

const CMP = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(>=|<=|==|!=|>|<)\s*(-?\d+(?:\.\d+)?)\s*$/;
/** String equality: `name == value` / `name != value` with a bareword RHS. */
const CMP_STR = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(==|!=)\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/;

/** Evaluate a single DSL expression against the game state. */
export function evalCond(state: GameState, expr: string): boolean {
  if (typeof expr !== 'string') return false;
  const e = expr.trim();
  if (e === '') return true;

  const m = CMP.exec(e);
  if (m) {
    const lhs = toNumber(resolveRaw(state, m[1]));
    const rhs = parseFloat(m[3]);
    switch (m[2]) {
      case '>=':
        return lhs >= rhs;
      case '<=':
        return lhs <= rhs;
      case '>':
        return lhs > rhs;
      case '<':
        return lhs < rhs;
      case '==':
        return lhs === rhs;
      case '!=':
        return lhs !== rhs;
    }
  }

  // String equality (e.g. june_hiding_place==church, signatory_who==roz).
  // Tried only after the numeric form so `x==3` stays numeric.
  const ms = CMP_STR.exec(e);
  if (ms) {
    const raw = resolveRaw(state, ms[1]);
    const lhs = raw === undefined ? '' : String(raw);
    const rhs = ms[3];
    return ms[2] === '==' ? lhs === rhs : lhs !== rhs;
  }

  let name = e;
  let negate = false;
  while (name.startsWith('!')) {
    negate = !negate;
    name = name.slice(1).trim();
  }
  const truthy = isTruthy(resolveRaw(state, name));
  return negate ? !truthy : truthy;
}

/** Full condition block: day / minDay / maxDay / phase / flags(AND) / anyFlags(OR). */
export function condsMet(state: GameState, c?: DialogueConditions): boolean {
  if (!c) return true;

  if (c.day !== undefined) {
    const days = Array.isArray(c.day) ? c.day : [c.day];
    if (!days.includes(state.day)) return false;
  }
  if (c.minDay !== undefined && state.day < c.minDay) return false;
  if (c.maxDay !== undefined && state.day > c.maxDay) return false;

  if (c.phase !== undefined) {
    const phases = Array.isArray(c.phase) ? c.phase : [c.phase];
    if (!phases.includes(state.phase)) return false;
  }

  if (c.flags) {
    for (const f of c.flags) if (!evalCond(state, f)) return false;
  }
  if (c.anyFlags && c.anyFlags.length > 0) {
    let any = false;
    for (const f of c.anyFlags) {
      if (evalCond(state, f)) {
        any = true;
        break;
      }
    }
    if (!any) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

function numFlag(state: GameState, name: string): number {
  return toNumber(state.flags[name]);
}

function strings(ctx: Ctx): Record<string, string> {
  return ctx.content.strings ?? {};
}

/**
 * Apply a dialogue/scene effect block: suspicion/trust deltas route through
 * systems/suspicion; giveKey/startChore/startScene/save perform their side
 * effects. Missing content degrades quietly.
 */
export function applyEffects(ctx: Ctx, e?: DialogueEffects): void {
  if (!e) return;
  const s = ctx.state;

  // Flag mutations first, so any trailing scene/choice conditions see them.
  if (e.flags) {
    for (const [k, v] of Object.entries(e.flags)) s.flags[k] = v;
  }
  if (e.incFlags) {
    for (const name of e.incFlags) s.flags[name] = numFlag(s, name) + 1;
  }

  if (typeof e.suspicion === 'number' && e.suspicion !== 0) {
    addSuspicion(ctx, e.suspicion, 'dialogue');
  }
  if (typeof e.juneTrust === 'number' && e.juneTrust !== 0) {
    addTrust(ctx, e.juneTrust);
  }
  if (e.trust) {
    for (const [who, delta] of Object.entries(e.trust)) {
      if (typeof delta === 'number' && delta !== 0) addSignatoryTrust(ctx, who, delta);
    }
  }
  if (typeof e.disruption === 'number' && e.disruption !== 0) {
    s.disruptionDebt = Math.max(0, s.disruptionDebt + e.disruption);
  }

  if (e.giveKey) {
    if (!s.keys.includes(e.giveKey)) {
      s.keys.push(e.giveKey);
      const t = strings(ctx)['toast.key_added'];
      if (t) ctx.ui.toast(t);
    }
  }
  if (e.giveItem) {
    s.inventory[e.giveItem] = (s.inventory[e.giveItem] ?? 0) + 1;
  }
  if (e.takeItem) {
    const left = (s.inventory[e.takeItem] ?? 0) - 1;
    if (left > 0) s.inventory[e.takeItem] = left;
    else delete s.inventory[e.takeItem];
  }

  if (e.startChore) {
    s.flags[`chore_started_${e.startChore}`] = true;
  }

  if (e.save) {
    saveGame(s);
    s.stats.coffees += 1;
    ctx.audio.cue('coffee');
    const t = strings(ctx)['toast.saved'];
    if (t) ctx.ui.toast(t);
    ctx.bus.emit({ type: 'saved' });
  }

  // Scene last: it may push a UI mode / branch on the flags set above.
  if (e.startScene) {
    startScene(ctx, e.startScene);
  }
}

// ---------------------------------------------------------------------------
// Content indexing (cached per content bundle)
// ---------------------------------------------------------------------------

interface DialogueIndex {
  byId: Map<string, DialogueNode>;
  byNpc: Map<string, DialogueNode[]>;
  barks: Map<string, BarkPool>;
}

const indexCache = new WeakMap<ContentBundle, DialogueIndex>();

function indexOf(content: ContentBundle): DialogueIndex {
  const cached = indexCache.get(content);
  if (cached) return cached;

  const byId = new Map<string, DialogueNode>();
  const byNpc = new Map<string, DialogueNode[]>();
  const barks = new Map<string, BarkPool>();

  for (const file of content.dialogue ?? []) {
    for (const node of file.nodes ?? []) {
      if (!node || typeof node.id !== 'string') continue;
      if (byId.has(node.id)) {
        console.warn(`[dialogue] duplicate node id '${node.id}'; keeping first`);
      } else {
        byId.set(node.id, node);
      }
      const list = byNpc.get(node.speaker);
      if (list) list.push(node);
      else byNpc.set(node.speaker, [node]);
    }
    for (const pool of file.barkPools ?? []) {
      if (!pool || typeof pool.id !== 'string') continue;
      if (!barks.has(pool.id)) barks.set(pool.id, pool);
    }
  }

  const idx: DialogueIndex = { byId, byNpc, barks };
  indexCache.set(content, idx);
  return idx;
}

// ---------------------------------------------------------------------------
// Node selection
// ---------------------------------------------------------------------------

/** How day-specific a node is; higher = more specific / later. Generic = -1. */
function dayScore(node: DialogueNode): number {
  const c = node.conditions;
  if (!c) return -1;
  if (typeof c.day === 'number') return c.day;
  if (Array.isArray(c.day) && c.day.length > 0) return Math.max(...c.day);
  if (typeof c.minDay === 'number') return c.minDay;
  return -1;
}

/**
 * Best matching node for an NPC: highest priority, then the latest
 * day-specific match, skipping oneShot nodes already seen.
 */
export function bestNodeFor(ctx: Ctx, npc: NpcId): DialogueNode | null {
  const list = indexOf(ctx.content).byNpc.get(npc);
  if (!list || list.length === 0) return null;
  const s = ctx.state;

  let best: DialogueNode | null = null;
  let bestPr = -Infinity;
  let bestDs = -Infinity;
  for (const node of list) {
    if (node.oneShot && s.seenNodes.includes(node.id)) continue;
    if (!condsMet(s, node.conditions)) continue;
    const pr = node.priority ?? 0;
    const ds = dayScore(node);
    if (pr > bestPr || (pr === bestPr && ds > bestDs)) {
      best = node;
      bestPr = pr;
      bestDs = ds;
    }
  }
  return best;
}

export function nodeById(ctx: Ctx, id: string): DialogueNode | null {
  return indexOf(ctx.content).byId.get(id) ?? null;
}

// ---------------------------------------------------------------------------
// Dialogue drift (decaySchedule)
// ---------------------------------------------------------------------------

/** Highest schedule key <= day; null when none applies. Empty list = silence. */
function decayPick(sched: Record<string, string[]> | null | undefined, day: number): string[] | null {
  if (!sched) return null;
  let bestKey = -Infinity;
  let best: string[] | null = null;
  for (const k of Object.keys(sched)) {
    const kd = parseInt(k, 10);
    if (Number.isNaN(kd) || kd > day || kd <= bestKey) continue;
    bestKey = kd;
    best = Array.isArray(sched[k]) ? sched[k] : [];
  }
  return best;
}

/** Node lines with the day's decay override applied (§7.4). */
export function linesFor(node: DialogueNode, day: number): string[] {
  const base = Array.isArray(node.lines) ? node.lines : [];
  const decayed = decayPick(node.decaySchedule, day);
  return decayed !== null ? decayed : base;
}

/**
 * One ambient bark from a pool, with the day's decay applied. Uses the
 * 'ambient' PRNG stream so flavor stays deterministic. Returns null when the
 * pool is missing or has decayed to silence.
 */
export function barkFor(ctx: Ctx, poolId: string): string | null {
  const pool = indexOf(ctx.content).barks.get(poolId);
  if (!pool) return null;

  const decayed = decayPick(pool.decaySchedule, ctx.state.day);
  const list = decayed !== null ? decayed : Array.isArray(pool.barks) ? pool.barks : [];
  if (list.length === 0) return null;

  return ctx.rng.stream('ambient').pick(list) ?? null;
}
