import { describe, expect, it } from 'vitest';
import { eventDefById, planDay, updateDirector } from '../src/systems/director';
import { makeRngFactory } from '../src/engine/prng';
import { newGame } from '../src/engine/save';
import type {
  ActiveEvent,
  AudioEngine,
  Bus,
  BusEvent,
  CompiledMap,
  CompiledRoom,
  ContentBundle,
  Ctx,
  InputState,
  Vec,
  WrongnessEventDef,
  ZoneId,
} from '../src/types';
import { DIRECTOR_BASE } from '../src/types';

// ---------------------------------------------------------------------------
// Synthetic world — a four-quadrant town plus a diner interior, with the
// `evt_{zone}_1/2` anchors the director looks for. No content dependency.
// ---------------------------------------------------------------------------

function room(partial: Partial<CompiledRoom> & { id: string }): CompiledRoom {
  return {
    id: partial.id,
    width: partial.width ?? 10,
    height: partial.height ?? 10,
    tiles: partial.tiles ?? [],
    solid: partial.solid ?? new Uint8Array(0),
    props: partial.props ?? [],
    anchors: partial.anchors ?? {},
    zones: partial.zones ?? [],
    buildings: partial.buildings ?? [],
    doors: partial.doors ?? [],
  };
}

function makeMap(): CompiledMap {
  const zones: { id: ZoneId; rect: { x: number; y: number; w: number; h: number } }[] = [
    { id: 'neck', rect: { x: 0, y: 0, w: 200, h: 200 } },
    { id: 'harbor', rect: { x: 200, y: 0, w: 200, h: 200 } },
    { id: 'marsh', rect: { x: 0, y: 200, w: 200, h: 200 } },
    { id: 'boardwalk', rect: { x: 200, y: 200, w: 200, h: 200 } },
  ];
  const anchors: Record<string, Vec> = {
    evt_neck_1: { x: 40, y: 40 },
    evt_neck_2: { x: 60, y: 60 },
    evt_harbor_1: { x: 240, y: 40 },
    evt_harbor_2: { x: 260, y: 60 },
    evt_marsh_1: { x: 40, y: 240 },
    evt_marsh_2: { x: 60, y: 260 },
    evt_boardwalk_1: { x: 240, y: 240 },
    evt_boardwalk_2: { x: 260, y: 260 },
    bookark_door: { x: 1000, y: 1000 },
  };
  const town = room({ id: 'town', width: 120, height: 90, anchors, zones });
  const diner = room({ id: 'diner', width: 6, height: 6, anchors: { evt_diner: { x: 24, y: 24 } } });
  return { rooms: { town, diner } };
}

// ---------------------------------------------------------------------------
// Synthetic event defs & ctx
// ---------------------------------------------------------------------------

function evt(o: Partial<WrongnessEventDef> & { id: string }): WrongnessEventDef {
  return {
    id: o.id,
    cost: o.cost ?? 1,
    tags: o.tags ?? ['visual'],
    family: o.family,
    escalatesTo: o.escalatesTo ?? null,
    placement: o.placement ?? { zones: ['harbor'] },
    prereqs: o.prereqs,
    cooldownDays: o.cooldownDays,
    oneShot: o.oneShot,
    catTell: o.catTell,
    manifest: o.manifest ?? { kind: 'prop_add', prop: 'porch_chair' },
  };
}

interface CtxOpts {
  day: number;
  debt?: number;
  seed?: number;
  flags?: Record<string, number | boolean | string>;
  escalations?: Record<string, number>;
  placedDays?: Record<string, number>;
  oneShotsUsed?: string[];
  witnessed?: string[];
}

function makeCtx(events: WrongnessEventDef[], opts: CtxOpts): { ctx: Ctx; emitted: BusEvent[] } {
  const seed = opts.seed ?? 12345;
  const state = newGame(seed);
  state.day = opts.day;
  state.disruptionDebt = opts.debt ?? 0;
  if (opts.flags) Object.assign(state.flags, opts.flags);
  if (opts.escalations) state.director.escalations = { ...opts.escalations };
  if (opts.placedDays) state.director.placedDays = { ...opts.placedDays };
  if (opts.oneShotsUsed) state.director.oneShotsUsed = [...opts.oneShotsUsed];
  if (opts.witnessed) state.director.witnessed = [...opts.witnessed];

  const emitted: BusEvent[] = [];
  const bus: Bus = { emit: (e) => void emitted.push(e), on: () => () => {} };
  const content = { events: { events } } as unknown as ContentBundle;
  const audio = { cue: () => {}, setStem: () => {} } as unknown as AudioEngine;

  const ctx = {
    state,
    content,
    map: makeMap(),
    rng: makeRngFactory(seed),
    bus,
    audio,
    input: {} as InputState,
    ui: {
      mode: 'walk',
      push: () => {},
      pop: () => {},
      startDialogue: () => {},
      startScene: () => {},
      toast: () => {},
    },
    paused: false,
    debug: false,
  } as unknown as Ctx;

  return { ctx, emitted };
}

function ids(list: ActiveEvent[]): string[] {
  return list.map((e) => e.id);
}

function costSum(ctx: Ctx): number {
  return ctx.state.activeEvents.reduce((a, ev) => a + (eventDefById(ctx, ev.id)?.cost ?? 0), 0);
}

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('planDay determinism', () => {
  const events = [
    evt({ id: 'a', placement: { zones: ['neck'] } }),
    evt({ id: 'b', placement: { zones: ['harbor'] } }),
    evt({ id: 'c', placement: { zones: ['marsh'] } }),
    evt({ id: 'd', placement: { zones: ['boardwalk'] } }),
  ];

  it('same seed + same state ⇒ byte-identical ActiveEvent plans', () => {
    const A = makeCtx(events, { day: 6, debt: 4, seed: 88291 });
    const B = makeCtx(events, { day: 6, debt: 4, seed: 88291 });
    planDay(A.ctx);
    planDay(B.ctx);
    expect(A.ctx.state.activeEvents).toEqual(B.ctx.state.activeEvents);
    expect(A.ctx.state.director.spent).toEqual(B.ctx.state.director.spent);
    // Sanity: the plan is non-trivial (all four distinct-zone events placed).
    expect(A.ctx.state.activeEvents.length).toBe(4);
  });

  it('a different seed produces a different anchor/clock draw', () => {
    const A = makeCtx(events, { day: 6, debt: 4, seed: 1 });
    const B = makeCtx(events, { day: 6, debt: 4, seed: 2 });
    planDay(A.ctx);
    planDay(B.ctx);
    // Same set of events can place, but the scheduled clocks/anchors differ.
    const clocksA = A.ctx.state.activeEvents.map((e) => `${e.anchor}@${e.activatesAtClock}`).sort();
    const clocksB = B.ctx.state.activeEvents.map((e) => `${e.anchor}@${e.activatesAtClock}`).sort();
    expect(clocksA).not.toEqual(clocksB);
  });
});

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

describe('planDay budget', () => {
  it('never spends more than W = base[day] + debt', () => {
    const events = [
      evt({ id: 'a', cost: 2, placement: { zones: ['neck'] } }),
      evt({ id: 'b', cost: 2, placement: { zones: ['harbor'] } }),
      evt({ id: 'c', cost: 2, placement: { zones: ['marsh'] } }),
      evt({ id: 'd', cost: 2, placement: { zones: ['boardwalk'] } }),
    ];
    const { ctx } = makeCtx(events, { day: 6, debt: 0, seed: 5 }); // W = base[6] = 4
    planDay(ctx);
    const W = DIRECTOR_BASE[6];
    expect(costSum(ctx)).toBeLessThanOrEqual(W);
    expect(ctx.state.director.spent['6']).toBe(costSum(ctx));
    expect(ctx.state.activeEvents.length).toBe(2); // two cost-2 events exhaust W=4
  });

  it('debt raises the budget (more can be afforded)', () => {
    const events = [
      evt({ id: 'a', cost: 2, placement: { zones: ['neck'] } }),
      evt({ id: 'b', cost: 2, placement: { zones: ['harbor'] } }),
      evt({ id: 'c', cost: 2, placement: { zones: ['marsh'] } }),
      evt({ id: 'd', cost: 2, placement: { zones: ['boardwalk'] } }),
    ];
    const { ctx } = makeCtx(events, { day: 6, debt: 4, seed: 5 }); // W = 4 + 4 = 8
    planDay(ctx);
    expect(costSum(ctx)).toBeLessThanOrEqual(8);
    expect(ctx.state.activeEvents.length).toBe(4); // all four now affordable
  });

  it('the calm early days (W = 0) place nothing', () => {
    const events = [evt({ id: 'a', cost: 1, placement: { zones: ['neck'] } })];
    for (const day of [1, 2, 3]) {
      const { ctx } = makeCtx(events, { day, debt: 0, seed: 5 });
      planDay(ctx);
      // base[1..3] = 0,0,1 — days 1 & 2 are silent; day 3 can afford one.
      if (DIRECTOR_BASE[day] === 0) expect(ctx.state.activeEvents.length).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Placement rules
// ---------------------------------------------------------------------------

describe('planDay placement rules', () => {
  it('caps at 2 + floor(day/3) events per day', () => {
    // Six events, all in the harbor. Day 8 (>=7) allows same-zone stacking, so
    // the only limiter is the per-day cap: 2 + floor(8/3) = 4.
    const events = Array.from({ length: 6 }, (_, i) =>
      evt({ id: `h${i}`, placement: { zones: ['harbor'] } }),
    );
    const { ctx } = makeCtx(events, { day: 8, debt: 0, seed: 9 }); // W = base[8] = 8
    planDay(ctx);
    expect(ctx.state.activeEvents.length).toBe(4);
  });

  it('before day 7, never two events in the same zone on the same day', () => {
    const events = [
      evt({ id: 'x', placement: { zones: ['harbor'] } }),
      evt({ id: 'y', placement: { zones: ['harbor'] } }),
    ];
    const { ctx } = makeCtx(events, { day: 5, debt: 5, seed: 3 }); // budget & cap allow 2+
    planDay(ctx);
    expect(ctx.state.activeEvents.length).toBe(1);
  });

  it('from day 7 the same-zone ban lifts', () => {
    const events = [
      evt({ id: 'x', placement: { zones: ['harbor'] } }),
      evt({ id: 'y', placement: { zones: ['harbor'] } }),
    ];
    const { ctx } = makeCtx(events, { day: 8, debt: 5, seed: 3 });
    planDay(ctx);
    expect(ctx.state.activeEvents.length).toBe(2);
  });

  it('never places inside the diner', () => {
    const events = [
      evt({ id: 'diner_evt', placement: { anchors: ['evt_diner'] } }),
      evt({ id: 'legal', placement: { zones: ['neck'] } }),
    ];
    const { ctx } = makeCtx(events, { day: 6, debt: 4, seed: 7 });
    planDay(ctx);
    expect(ids(ctx.state.activeEvents)).not.toContain('diner_evt');
    expect(ids(ctx.state.activeEvents)).toContain('legal');
  });
});

// ---------------------------------------------------------------------------
// Candidate filtering
// ---------------------------------------------------------------------------

describe('planDay candidate filtering', () => {
  it('respects cooldownDays via placedDays', () => {
    const events = [evt({ id: 'cd', cooldownDays: 2, placement: { zones: ['neck'] } })];
    const cold = makeCtx(events, { day: 6, seed: 1, placedDays: { cd: 5 } }); // 6-5=1 < 2
    planDay(cold.ctx);
    expect(cold.ctx.state.activeEvents.length).toBe(0);

    const warm = makeCtx(events, { day: 6, seed: 1, placedDays: { cd: 3 } }); // 6-3=3 >= 2
    planDay(warm.ctx);
    expect(warm.ctx.state.activeEvents.length).toBe(1);
  });

  it('respects oneShot via oneShotsUsed, and records new one-shots', () => {
    const events = [evt({ id: 'os', oneShot: true, placement: { zones: ['neck'] } })];
    const used = makeCtx(events, { day: 6, seed: 1, oneShotsUsed: ['os'] });
    planDay(used.ctx);
    expect(used.ctx.state.activeEvents.length).toBe(0);

    const fresh = makeCtx(events, { day: 6, seed: 1 });
    planDay(fresh.ctx);
    expect(fresh.ctx.state.activeEvents.length).toBe(1);
    expect(fresh.ctx.state.director.oneShotsUsed).toContain('os');
  });

  it('respects prereqs via the flag DSL', () => {
    const events = [evt({ id: 'pr', prereqs: ['gate_open'], placement: { zones: ['neck'] } })];
    const closed = makeCtx(events, { day: 6, seed: 1 });
    planDay(closed.ctx);
    expect(closed.ctx.state.activeEvents.length).toBe(0);

    const open = makeCtx(events, { day: 6, seed: 1, flags: { gate_open: true } });
    planDay(open.ctx);
    expect(open.ctx.state.activeEvents.length).toBe(1);
  });

  it('records the day placed for cooldown accounting', () => {
    const events = [evt({ id: 'p', placement: { zones: ['neck'] } })];
    const { ctx } = makeCtx(events, { day: 6, seed: 1 });
    planDay(ctx);
    expect(ctx.state.director.placedDays['p']).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Family escalation
// ---------------------------------------------------------------------------

describe('planDay family escalation', () => {
  const events = [
    evt({ id: 'evt.A', family: 'F', escalatesTo: 'evt.B', placement: { zones: ['neck'] } }),
    evt({ id: 'evt.B', family: 'F', escalatesTo: null, placement: { zones: ['neck'] } }),
  ];

  it('un-witnessed families spawn the base form (escalation targets are not picked directly)', () => {
    const { ctx } = makeCtx(events, { day: 6, seed: 1 });
    planDay(ctx);
    expect(ids(ctx.state.activeEvents)).toEqual(['evt.A']);
  });

  it('a witnessed family spawns its next rung instead', () => {
    const { ctx } = makeCtx(events, { day: 6, seed: 1, escalations: { F: 1 } });
    planDay(ctx);
    expect(ids(ctx.state.activeEvents)).toEqual(['evt.B']);
  });
});

// ---------------------------------------------------------------------------
// Empty content
// ---------------------------------------------------------------------------

describe('planDay robustness', () => {
  it('handles an empty event pool without crashing', () => {
    const { ctx } = makeCtx([], { day: 6, debt: 10, seed: 1 });
    expect(() => planDay(ctx)).not.toThrow();
    expect(ctx.state.activeEvents.length).toBe(0);
    expect(ctx.state.director.spent['6']).toBe(0);
  });

  it('clears the prior day’s events and deviations on replan', () => {
    const events = [
      evt({
        id: 'dev',
        placement: { zones: ['neck'] },
        manifest: { kind: 'npc_deviation', npc: 'roz', deviation: 'wipe_counter' },
      }),
    ];
    const { ctx } = makeCtx(events, { day: 6, seed: 1 });
    ctx.state.activeEvents = [
      { id: 'stale', day: 5, room: 'town', anchor: 'evt_harbor_1', pos: { x: 240, y: 40 }, witnessed: false, lingerSec: 0, activatesAtClock: 600, active: true },
    ];
    ctx.state.npcs.margie.deviation = 'yesterday';
    planDay(ctx);
    expect(ids(ctx.state.activeEvents)).not.toContain('stale');
    expect(ctx.state.npcs.margie.deviation).toBeNull();
    // The npc_deviation event hands the def id to the NPC for schedule.ts.
    expect(ctx.state.npcs.roz.deviation).toBe('dev');
  });
});

// ---------------------------------------------------------------------------
// updateDirector — activation, witnessing, cat tell
// ---------------------------------------------------------------------------

function activeEvent(o: Partial<ActiveEvent> & { id: string }): ActiveEvent {
  return {
    id: o.id,
    day: o.day ?? 6,
    room: o.room ?? 'town',
    anchor: o.anchor ?? 'evt_harbor_1',
    pos: o.pos ?? { x: 240, y: 40 },
    witnessed: o.witnessed ?? false,
    lingerSec: o.lingerSec ?? 0,
    activatesAtClock: o.activatesAtClock ?? 600,
    active: o.active ?? false,
    ...(o.catTellAt !== undefined ? { catTellAt: o.catTellAt } : {}),
  };
}

describe('updateDirector', () => {
  it('activates events once the clock reaches their slot', () => {
    const events = [evt({ id: 'w1', placement: { zones: ['harbor'] } })];
    const { ctx } = makeCtx(events, { day: 6, seed: 1 });
    ctx.state.clockMin = 500;
    ctx.state.player.room = 'town';
    ctx.state.player.pos = { x: 900, y: 700 }; // off-screen so it isn't witnessed yet
    ctx.state.activeEvents = [activeEvent({ id: 'w1', activatesAtClock: 600, active: false })];
    updateDirector(ctx, 0.1);
    expect(ctx.state.activeEvents[0].active).toBe(false); // 500 < 600

    ctx.state.clockMin = 601;
    updateDirector(ctx, 0.1);
    expect(ctx.state.activeEvents[0].active).toBe(true);
  });

  it('witnesses an active on-screen event after 1.5s cumulative and escalates its family', () => {
    const events = [evt({ id: 'w1', family: 'WF', placement: { zones: ['harbor'] } })];
    const { ctx, emitted } = makeCtx(events, { day: 6, seed: 1 });
    ctx.state.clockMin = 800;
    ctx.state.player.room = 'town';
    ctx.state.player.pos = { x: 240, y: 40 }; // event is centred in the viewport
    ctx.state.activeEvents = [activeEvent({ id: 'w1', activatesAtClock: 600, active: false, pos: { x: 240, y: 40 } })];

    updateDirector(ctx, 1.0); // below threshold
    expect(ctx.state.activeEvents[0].witnessed).toBe(false);
    updateDirector(ctx, 1.0); // cumulative 2.0s ≥ 1.5s
    expect(ctx.state.activeEvents[0].witnessed).toBe(true);
    expect(ctx.state.director.witnessed).toContain('w1');
    expect(ctx.state.director.escalations['WF']).toBe(1);
    expect(emitted.some((e) => e.type === 'eventWitnessed' && e.eventId === 'w1')).toBe(true);
  });

  it('does not accrue witnessing while a modal is paused', () => {
    const events = [evt({ id: 'w1', placement: { zones: ['harbor'] } })];
    const { ctx } = makeCtx(events, { day: 6, seed: 1 });
    ctx.paused = true;
    ctx.state.clockMin = 800;
    ctx.state.player.room = 'town';
    ctx.state.player.pos = { x: 240, y: 40 };
    ctx.state.activeEvents = [activeEvent({ id: 'w1', activatesAtClock: 600, active: true, pos: { x: 240, y: 40 } })];
    updateDirector(ctx, 5.0);
    expect(ctx.state.activeEvents[0].witnessed).toBe(false);
    expect(ctx.state.activeEvents[0].lingerSec).toBe(0);
  });

  it('a following cat stares at the spot before the event activates', () => {
    const events = [evt({ id: 'ct', catTell: true, placement: { zones: ['harbor'] } })];
    const { ctx } = makeCtx(events, { day: 6, seed: 1 });
    ctx.state.clockMin = 590; // 10 min before activation, inside a 20-min tell window
    ctx.state.player.room = 'town';
    ctx.state.player.pos = { x: 240, y: 40 };
    ctx.state.npcs.gigi.following = true;
    ctx.state.npcs.gigi.room = 'town';
    ctx.state.npcs.gigi.pos = { x: 240, y: 40 };
    ctx.state.activeEvents = [
      activeEvent({ id: 'ct', activatesAtClock: 600, catTellAt: 20, active: false, pos: { x: 240, y: 40 } }),
    ];
    updateDirector(ctx, 0.1);
    expect(ctx.state.npcs.gigi.activity.startsWith('stare_at:')).toBe(true);
    expect(ctx.state.npcs.gigi.activity).toBe('stare_at:240,40');
  });

  it('holds the tell until the window opens', () => {
    const events = [evt({ id: 'ct', catTell: true, placement: { zones: ['harbor'] } })];
    const { ctx } = makeCtx(events, { day: 6, seed: 1 });
    ctx.state.clockMin = 500; // 100 min out, well before a 20-min window
    ctx.state.player.room = 'town';
    ctx.state.player.pos = { x: 240, y: 40 };
    ctx.state.npcs.gigi.following = true;
    ctx.state.npcs.gigi.room = 'town';
    ctx.state.npcs.gigi.pos = { x: 240, y: 40 };
    ctx.state.npcs.gigi.activity = 'follow';
    ctx.state.activeEvents = [
      activeEvent({ id: 'ct', activatesAtClock: 600, catTellAt: 20, active: false, pos: { x: 240, y: 40 } }),
    ];
    updateDirector(ctx, 0.1);
    expect(ctx.state.npcs.gigi.activity).toBe('follow');
  });
});
