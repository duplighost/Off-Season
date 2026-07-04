/**
 * Save/load (localStorage, key 'offseason.save') and new-game state
 * construction. The save is a single JSON blob of GameState (§9.5), plus an
 * export-to-file path via exportSave().
 *
 * Imports only types.ts so it can be pulled in from anywhere without cycles.
 */

import { DAY_START_MIN, POPULATION_BY_DAY } from '../types';
import type { GameState, NpcId, NpcState } from '../types';

const SAVE_KEY = 'offseason.save';

const STARTING_KEYS: readonly string[] = ['truck', 'bathhouse', 'pool_shed', 'boardwalk_panels'];

const NPC_IDS: readonly NpcId[] = [
  'june',
  'margie',
  'sal',
  'roz',
  'petey',
  'edith',
  'cutter',
  'amaral',
  'gus',
  'alma',
  'second_gus',
  'hutch',
  'gigi',
];

/** localStorage can be absent (tests) or throw (privacy modes). */
function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function saveGame(state: GameState): void {
  const store = storage();
  if (!store) {
    console.warn('[save] localStorage unavailable; save skipped');
    return;
  }
  try {
    store.setItem(SAVE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('[save] failed to write save', err);
  }
}

export function loadGame(): GameState | null {
  const store = storage();
  if (!store) return null;
  const raw = store.getItem(SAVE_KEY);
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn('[save] corrupt save JSON; ignoring', err);
    return null;
  }
  if (!looksLikeSave(parsed)) {
    console.warn('[save] save blob failed shape check; ignoring');
    return null;
  }

  // Backfill anything a schema-older save is missing with fresh defaults;
  // saved nested objects win wholesale over the defaults.
  const p = parsed as Partial<GameState> & { seed: number; version: 1 };
  const base = newGame(p.seed, p.player?.name);
  return { ...base, ...p, version: 1 };
}

function looksLikeSave(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    o.version === 1 &&
    typeof o.seed === 'number' &&
    typeof o.day === 'number' &&
    typeof o.clockMin === 'number' &&
    typeof o.player === 'object' &&
    o.player !== null &&
    typeof o.npcs === 'object' &&
    o.npcs !== null
  );
}

export function hasSave(): boolean {
  const store = storage();
  return !!store && store.getItem(SAVE_KEY) !== null;
}

export function clearSave(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(SAVE_KEY);
  } catch (err) {
    console.warn('[save] failed to clear save', err);
  }
}

export function exportSave(state: GameState): string {
  return JSON.stringify(state, null, 2);
}

/** Fully-initialized Day 1 state. 06:30, the starting keyring, the town at
 *  Labor Day population. NPCs start parked at town origin; the schedule
 *  system snaps them to their first slot anchor on the first update. */
export function newGame(seed: number, name?: string): GameState {
  const npcs: Record<string, NpcState> = {};
  for (const id of NPC_IDS) {
    const npc: NpcState = {
      id,
      room: 'town',
      pos: { x: 0, y: 0 },
      facing: 'down',
      activity: 'idle',
      deviation: null,
    };
    if (id === 'gigi') npc.following = false;
    npcs[id] = npc;
  }

  const playerName = name && name.trim().length > 0 ? name.trim() : 'Wren';

  return {
    version: 1,
    seed: Math.floor(seed) >>> 0,
    day: 1,
    clockMin: DAY_START_MIN,
    phase: 'morning',
    player: {
      name: playerName,
      room: 'wren_house',
      pos: { x: 64, y: 64 },
      facing: 'down',
    },
    flags: {},
    suspicion: 0,
    juneTrust: 0,
    signatoryTrust: { roz: 0, edith: 0, amaral: 0, household: 0 },
    disruptionDebt: 0,
    choresDone: {},
    ledger: { count: 200, forged: false, amended: false },
    keys: [...STARTING_KEYS],
    inventory: {},
    director: {
      spent: {},
      witnessed: [],
      escalations: {},
      placedDays: {},
      oneShotsUsed: [],
    },
    audio: { subtracted: [] },
    npcs,
    activeEvents: [],
    population: POPULATION_BY_DAY[1],
    ending: null,
    seenNodes: [],
    playedBeats: [],
    lightsOut: [],
    radioOn: false,
    stats: { coffees: 0, doubleOrders: 0, nightsOutLate: 0 },
  };
}
