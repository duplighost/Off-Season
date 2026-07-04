/**
 * Story: scripted beats, the scene VM, and the ending matrix (§8).
 *
 * Scenes are the cutscene / beat / ending vehicle. A scene is a list of
 * SceneOps executed by a tiny VM with a single op pointer and a few waiting
 * states. All narrative text lives in content/story/story.json; this file
 * only interprets it.
 */

import type {
  Ctx,
  EndingId,
  SceneDef,
  SceneOp,
  StoryBeat,
} from '../types';
import { condsMet as _unused } from './dialogue'; // keep import graph explicit
import { evalCond } from './dialogue';
import { applyEffects } from './dialogue';
import { parseClock } from './time';

void _unused;

// ---------------------------------------------------------------------------
// Scene VM state (module-local; also mirrored into GameState for saves via
// flags we don't need — scenes are transient and never mid-save in practice).
// ---------------------------------------------------------------------------

interface SceneRuntime {
  def: SceneDef;
  ip: number; // instruction pointer
  // Current renderable
  slide: { text: string; hold: number; elapsed: number } | null;
  textbox: {
    speaker?: string;
    lines: string[];
    choices?: { text: string; effects?: any; goto?: string }[];
    selected: number;
  } | null;
  // Timers / fades
  wait: number;
  fade: { to: 'black' | 'in'; t: number; dur: number } | null;
  fadeLevel: number; // 0 = clear, 1 = black
  done: boolean;
}

let rt: SceneRuntime | null = null;
/** True while runUntilBlock is stepping ops; guards re-entrant startScene. */
let executing = false;
/** A scene requested from inside an executing scene (chain-to). */
let pendingScene: string | null = null;

export function sceneActive(_ctx: Ctx): boolean {
  return rt !== null && !rt.done;
}

export function currentSlide(_ctx: Ctx): { text: string } | null {
  if (rt && rt.slide) return { text: rt.slide.text };
  return null;
}

export function currentSceneText(_ctx: Ctx):
  | {
      speaker?: string;
      lines: string[];
      choices?: { text: string }[];
      selected: number;
    }
  | null {
  if (rt && rt.textbox) {
    return {
      speaker: rt.textbox.speaker,
      lines: rt.textbox.lines,
      choices: rt.textbox.choices?.map((c) => ({ text: c.text })),
      selected: rt.textbox.selected,
    };
  }
  return null;
}

export function fadeLevel(): number {
  return rt ? rt.fadeLevel : 0;
}

// ---------------------------------------------------------------------------
// Starting scenes
// ---------------------------------------------------------------------------

function sceneById(ctx: Ctx, id: string): SceneDef | null {
  const scenes = ctx.content.story?.scenes ?? [];
  return scenes.find((s) => s.id === id) ?? null;
}

function makeRuntime(def: SceneDef): SceneRuntime {
  return {
    def,
    ip: 0,
    slide: null,
    textbox: null,
    wait: 0,
    fade: null,
    fadeLevel: 0,
    done: false,
  };
}

export function startScene(ctx: Ctx, sceneId: string): void {
  const def = sceneById(ctx, sceneId);
  if (!def) {
    console.warn(`[story] scene '${sceneId}' not found; skipping`);
    return;
  }
  // Chaining: a scene op (effects.startScene) fired while we're mid-step.
  // Defer the swap so runUntilBlock finishes the current op cleanly, then
  // picks the new scene up as its next runtime.
  if (executing) {
    pendingScene = sceneId;
    return;
  }
  rt = makeRuntime(def);
  // Push the scene ui mode directly. ctx.ui.startScene routes back here, so we
  // must NOT call it (that would recurse); ctx.ui.push just flips the mode.
  if (ctx.ui.mode !== 'scene') ctx.ui.push('scene');
  runUntilBlock(ctx);
}

function findLabel(def: SceneDef, id: string): number {
  for (let i = 0; i < def.ops.length; i++) {
    const op = def.ops[i];
    if (op.op === 'label' && op.id === id) return i;
  }
  console.warn(`[story] label '${id}' not found in scene '${def.id}'`);
  return def.ops.length; // jump to end
}

/**
 * Execute ops until we hit something that blocks (text, slide with hold,
 * choice, wait, fade in progress) or the scene ends.
 */
function runUntilBlock(ctx: Ctx): void {
  if (!rt) return;
  executing = true;
  let guard = 0;
  try {
    while (rt && rt.ip < rt.def.ops.length && !rt.done) {
      if (guard++ > 10000) {
        console.warn('[story] scene op guard tripped (loop?)');
        break;
      }
      // Blocking states: don't advance the ip until resolved.
      if (rt.slide) return; // timed or manual slide showing
      if (rt.textbox) return; // wait for advance / choose
      if (rt.wait > 0) return;
      if (rt.fade) return;

      const op = rt.def.ops[rt.ip];
      rt.ip++;
      execOp(ctx, op);

      // A chain requested from inside execOp (effects.startScene): swap the
      // runtime to the new scene and continue from its first op.
      if (pendingScene) {
        const next = sceneById(ctx, pendingScene);
        pendingScene = null;
        if (next) rt = makeRuntime(next);
      }
    }
    if (rt && rt.ip >= rt.def.ops.length && !rt.textbox && !rt.slide && !rt.wait && !rt.fade) {
      endScene(ctx);
    }
  } finally {
    executing = false;
  }
}

/** Returns true if op executed non-blocking; false if it set a wait state. */
function execOp(ctx: Ctx, op: SceneOp): boolean {
  if (!rt) return true;
  switch (op.op) {
    case 'text':
      rt.textbox = { speaker: op.speaker, lines: op.lines, selected: 0 };
      return false;
    case 'slide':
      rt.slide = { text: op.text, hold: op.hold ?? 0, elapsed: 0 };
      return false;
    case 'choice':
      rt.textbox = {
        speaker: undefined,
        lines: op.prompt ? [op.prompt] : [],
        choices: op.options.map((o) => ({ text: o.text, effects: o.effects, goto: o.goto })),
        selected: 0,
      };
      return false;
    case 'effects':
      applyEffects(ctx, op.effects);
      return true;
    case 'sound':
      ctx.audio.cue(op.cue);
      return true;
    case 'music':
      if (op.song === null) ctx.audio.radioStop();
      else if (op.song === 'Seaglass' || op.song.startsWith('epilogue')) ctx.audio.playEpilogueCue();
      else {
        const song = ctx.content.radio?.songs.find((s) => s.id === op.song);
        if (song) ctx.audio.radioPlay(song);
      }
      return true;
    case 'wait':
      rt.wait = op.seconds;
      return false;
    case 'fade':
      rt.fade = { to: op.to, t: 0, dur: op.seconds ?? 0.8 };
      return false;
    case 'teleport': {
      const s = ctx.state;
      s.player.room = op.room;
      // anchor resolution handled by game.ts on next frame via a flag
      s.flags._scene_teleport = `${op.room}:${op.anchor}`;
      return true;
    }
    case 'clock':
      ctx.state.clockMin = parseClock(op.set);
      return true;
    case 'label':
      return true; // no-op marker
    case 'goto':
      rt.ip = findLabel(rt.def, op.id);
      return true;
    case 'branch': {
      const ok = (op.if ?? []).every((e) => evalCond(ctx.state, e));
      const target = ok ? op.then : op.else;
      if (target) rt.ip = findLabel(rt.def, target);
      return true;
    }
    case 'ending':
      resolveEnding(ctx, op.id);
      return true;
    case 'endScene':
      endScene(ctx);
      return true;
    default:
      return true;
  }
}

function resolveEnding(ctx: Ctx, id: EndingId): void {
  ctx.state.ending = id;
  ctx.bus.emit({ type: 'endingReached', ending: id });
  // Remaining ops (epilogue slides) keep running inside this same scene.
}

function endScene(ctx: Ctx): void {
  if (!rt) return;
  const id = rt.def.id;
  const wasEnding = ctx.state.ending !== null && (id.startsWith('scene.ending.') || id.startsWith('ending.'));
  rt = null;
  ctx.bus.emit({ type: 'sceneEnded', scene: id });
  if (wasEnding) {
    // Ending scene finished: hand control to the title screen.
    ctx.ui.push('title');
  } else {
    ctx.ui.pop();
  }
}

// ---------------------------------------------------------------------------
// Per-frame update: timed slides, waits, fades, then run.
// ---------------------------------------------------------------------------

export function updateScene(ctx: Ctx, dt: number): void {
  if (!rt || rt.done) return;

  if (rt.fade) {
    rt.fade.t += dt;
    const p = Math.min(1, rt.fade.t / rt.fade.dur);
    rt.fadeLevel = rt.fade.to === 'black' ? p : 1 - p;
    if (p >= 1) {
      rt.fadeLevel = rt.fade.to === 'black' ? 1 : 0;
      rt.fade = null;
      runUntilBlock(ctx);
    }
    return;
  }

  if (rt.wait > 0) {
    rt.wait -= dt;
    if (rt.wait <= 0) {
      rt.wait = 0;
      runUntilBlock(ctx);
    }
    return;
  }

  if (rt.slide && rt.slide.hold > 0) {
    rt.slide.elapsed += dt;
    if (rt.slide.elapsed >= rt.slide.hold) {
      rt.slide = null;
      runUntilBlock(ctx);
    }
    return;
  }
}

/** Confirm pressed during a scene. */
export function advanceScene(ctx: Ctx): void {
  if (!rt) return;
  if (rt.textbox) {
    if (rt.textbox.choices && rt.textbox.choices.length) {
      chooseSceneOption(ctx, rt.textbox.selected);
      return;
    }
    rt.textbox = null;
    runUntilBlock(ctx);
    return;
  }
  if (rt.slide) {
    // manual-advance slide (hold 0) or skip a timed one
    rt.slide = null;
    runUntilBlock(ctx);
    return;
  }
}

export function moveSceneCursor(dir: number): void {
  if (rt && rt.textbox && rt.textbox.choices && rt.textbox.choices.length) {
    const n = rt.textbox.choices.length;
    rt.textbox.selected = (rt.textbox.selected + dir + n) % n;
  }
}

export function chooseSceneOption(ctx: Ctx, idx: number): void {
  if (!rt || !rt.textbox || !rt.textbox.choices) return;
  const opt = rt.textbox.choices[idx];
  rt.textbox = null;
  if (opt.effects) applyEffects(ctx, opt.effects);
  if (opt.goto) rt.ip = findLabel(rt.def, opt.goto);
  runUntilBlock(ctx);
}

// ---------------------------------------------------------------------------
// Beat triggers (§8.3)
// ---------------------------------------------------------------------------

function beatFires(ctx: Ctx, beat: StoryBeat): boolean {
  const s = ctx.state;
  const t = beat.trigger;
  if (t.day !== s.day) return false;
  if (t.phase && t.phase !== s.phase) return false;
  if (t.clock) {
    const [a, b] = t.clock.split('-');
    const lo = parseClock(a);
    const hi = b ? parseClock(b) : lo + 1;
    if (s.clockMin < lo || s.clockMin > hi) return false;
  }
  if (t.room && s.player.room !== t.room) return false;
  if (t.zone && s.flags.cur_zone !== t.zone) return false;
  if (t.flags && !t.flags.every((e) => evalCond(s, e))) return false;
  return true;
}

export function updateStory(ctx: Ctx, _dt: number): void {
  // Don't evaluate beats while a scene, dialogue, or other modal is up.
  if (sceneActive(ctx)) return;
  if (ctx.ui.mode !== 'walk') return;

  const beats = ctx.content.story?.beats ?? [];
  for (const beat of beats) {
    const oneShot = beat.oneShot !== false;
    if (oneShot && ctx.state.playedBeats.includes(beat.id)) continue;
    if (beatFires(ctx, beat)) {
      ctx.state.playedBeats.push(beat.id);
      startScene(ctx, beat.scene);
      return; // one beat per frame
    }
  }
}

// ---------------------------------------------------------------------------
// Ending matrix (§8.2). Priority order documented in ARCHITECTURE.md.
// ---------------------------------------------------------------------------

function flag(ctx: Ctx, name: string): boolean {
  return !!ctx.state.flags[name];
}

/** Were the day-8 and day-9 chores all abandoned? */
function choresAbandoned(ctx: Ctx): boolean {
  const chores = ctx.content.chores?.chores ?? [];
  const late = chores.filter((c) => c.day === 8 || c.day === 9);
  if (!late.length) return false;
  return late.every((c) => {
    const rec = ctx.state.choresDone[c.id];
    return !rec || !rec.done;
  });
}

export function checkEnding(ctx: Ctx): EndingId | null {
  const s = ctx.state;

  // 5 — The Last Train (secret): suspicion maxed, late chores abandoned,
  // standing on the depot platform on night 9.
  if (
    s.suspicion >= 90 &&
    choresAbandoned(ctx) &&
    flag(ctx, 'on_depot_platform_night9')
  ) {
    return 'last_train';
  }

  // 1 — By the Book: June reported on/before day 6.
  if (flag(ctx, 'june_reported')) return 'by_the_book';

  // 4 — Two Hundred and One: claimed, clean, in time.
  if (flag(ctx, 'form12c_filed') && s.juneTrust >= 70 && flag(ctx, 'count_clean')) {
    return 'two_hundred_one';
  }

  // 3 — The Long Light: the Lantern refused.
  if (flag(ctx, 'lantern_refused')) return 'long_light';

  // 2 — Stowaway: doused with June still aboard and hidden.
  if (flag(ctx, 'lantern_doused') && (flag(ctx, 'june_hidden') || !!s.flags.june_hiding_place)) {
    return 'stowaway';
  }

  // Doused with no June present at all (she left / was never hidden) also
  // resolves as By the Book's quiet cousin — but if she was reported we
  // already returned. Default: if the lantern was doused, the town closes
  // correctly and the winter is uneventful → treat as by_the_book epilogue.
  if (flag(ctx, 'lantern_doused')) return 'by_the_book';

  // Reaching the end of Day 9 without ever dousing means the Lantern was left
  // burning — the town stays open. That is the Long Light. (checkEnding is
  // only called at the Day-9 midnight resolution.)
  if (ctx.state.day >= 9) return 'long_light';

  return null;
}
