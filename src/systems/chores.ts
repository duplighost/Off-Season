/**
 * The Closing Checklist (§7.2). Nine chores, one per day, each a rite whose
 * ritually-correct execution is slightly slower, slightly fussier, and never
 * explained. Correctness misses accrue disruption debt (not suspicion).
 *
 * Step progression lives in GameState.flags so it survives a save:
 *   chore_step_{id}      — index of the current step
 *   chore_seq_{id}       — comma-joined order of interact_sequence hits
 *   chore_carry_{id}     — count deposited so far (carry steps)
 */

import type { ChoreDef, ChoreRecord, ChoreStep, Ctx } from '../types';
import { parseClock, sunsetMin } from './time';
import { startScene } from './story';
import { startMinigame } from '../ui/minigames';

export function todaysChores(ctx: Ctx): ChoreDef[] {
  const all = ctx.content.chores?.chores ?? [];
  return all.filter((c) => c.day === ctx.state.day);
}

export function choreState(ctx: Ctx, id: string): ChoreRecord {
  let rec = ctx.state.choresDone[id];
  if (!rec) {
    rec = { done: false, correct: false, missedChecks: [] };
    ctx.state.choresDone[id] = rec;
  }
  return rec;
}

export function activeChore(ctx: Ctx): ChoreDef | null {
  for (const c of todaysChores(ctx)) {
    const rec = ctx.state.choresDone[c.id];
    if (!rec || !rec.done) return c;
  }
  return null;
}

function stepIndex(ctx: Ctx, id: string): number {
  return Number(ctx.state.flags[`chore_step_${id}`] ?? 0);
}
function setStepIndex(ctx: Ctx, id: string, i: number): void {
  ctx.state.flags[`chore_step_${id}`] = i;
}

export function currentStep(ctx: Ctx, chore: ChoreDef): ChoreStep | null {
  const i = stepIndex(ctx, chore.id);
  return chore.steps[i] ?? null;
}

/**
 * Push whatever UI/mode the current step needs. For world-driven steps
 * (goto/interact/interact_sequence/carry/boat_task) nothing is pushed here —
 * they advance through onInteractTarget. Minigame steps push a mode.
 */
export function startStep(ctx: Ctx, chore: ChoreDef, step: ChoreStep): void {
  switch (step.type) {
    case 'hold_timing':
    case 'meter_read':
    case 'switch':
      startMinigame(ctx, step.type, chore, step);
      break;
    default:
      // world-driven: no UI. A HUD hint points the player at step.target.
      break;
  }
}

function advance(ctx: Ctx, chore: ChoreDef): void {
  const i = stepIndex(ctx, chore.id) + 1;
  setStepIndex(ctx, chore.id, i);
  const next = chore.steps[i];
  if (!next) {
    completeChore(ctx, chore.id);
    return;
  }
  startStep(ctx, chore, next);
}

/** Called by minigames.ts when a minigame step resolves. */
export function stepResolved(ctx: Ctx, choreId: string): void {
  const chore = todaysChores(ctx).find((c) => c.id === choreId);
  if (chore) advance(ctx, chore);
}

/**
 * Called by game/interact.ts when the player interacts with any target.
 * Returns true if the interaction was consumed by the active chore step.
 */
export function onInteractTarget(ctx: Ctx, targetId: string): boolean {
  const chore = activeChore(ctx);
  if (!chore) return false;
  if (ctx.state.day !== chore.day) return false;
  const step = currentStep(ctx, chore);
  if (!step) return false;

  switch (step.type) {
    case 'goto':
      if (step.target === targetId) {
        advance(ctx, chore);
        return true;
      }
      return false;

    case 'interact':
      if (step.target === targetId) {
        // Day-6 census: June's meter diverts to the count-choice scene.
        if (targetId === 'june_meter') {
          startScene(ctx, 'scene.d6.count_choice');
          advance(ctx, chore);
          return true;
        }
        ctx.audio.cue('padlock');
        advance(ctx, chore);
        return true;
      }
      return false;

    case 'meter_read':
      // The meter minigame handles the reading; but if the target is a
      // world meter prop matching, funnel into the minigame.
      if (targetId === 'june_meter') {
        startScene(ctx, 'scene.d6.count_choice');
        advance(ctx, chore);
        return true;
      }
      if (step.targets?.includes(targetId) || step.target === targetId) {
        startMinigame(ctx, 'meter_read', chore, step);
        return true;
      }
      return false;

    case 'interact_sequence': {
      const targets = step.targets ?? [];
      if (!targets.includes(targetId)) return false;
      const key = `chore_seq_${chore.id}`;
      const seq = String(ctx.state.flags[key] ?? '');
      const arr = seq ? seq.split(',') : [];
      if (arr.includes(targetId)) return true; // already hit; ignore
      arr.push(targetId);
      ctx.state.flags[key] = arr.join(',');
      ctx.audio.cue(targetId.startsWith('panel') ? 'thunk' : 'chain');
      if (targetId.startsWith('panel')) {
        const n = parseInt(targetId.split('_')[1], 10);
        if (!ctx.state.lightsOut.includes(n)) ctx.state.lightsOut.push(n);
        ctx.bus.emit({ type: 'lightSectionOut', section: n });
      }
      if (arr.length >= targets.length) advance(ctx, chore);
      return true;
    }

    case 'carry': {
      const need = step.count ?? 1;
      const key = `chore_carry_${chore.id}`;
      const have = Number(ctx.state.flags[key] ?? 0);
      // interact at source or sink; treat any matching target as one unit.
      if (step.target === targetId || step.targets?.includes(targetId)) {
        const n = have + 1;
        ctx.state.flags[key] = n;
        ctx.audio.cue('chain');
        if (n >= need) advance(ctx, chore);
        return true;
      }
      return false;
    }

    case 'boat_task':
      if (step.target === targetId || targetId === 'boat_launch') {
        // Board and row: resolve via a timing bar per water target.
        startMinigame(ctx, 'hold_timing', chore, step);
        return true;
      }
      return false;

    case 'switch':
      if (step.target === targetId) {
        startMinigame(ctx, 'switch', chore, step);
        return true;
      }
      return false;

    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Correctness & completion
// ---------------------------------------------------------------------------

function clockValue(ctx: Ctx, value: string | undefined): number {
  if (!value) return 24 * 60;
  if (value === 'sundown') return sunsetMin(ctx.state.day);
  if (value === 'midnight') return 24 * 60;
  return parseClock(value);
}

export function completeChore(ctx: Ctx, id: string): void {
  const chore = (ctx.content.chores?.chores ?? []).find((c) => c.id === id);
  if (!chore) return;
  const rec = choreState(ctx, id);
  if (rec.done) return;

  rec.done = true;
  rec.finishedAtClock = ctx.state.clockMin;
  rec.missedChecks = [];
  let missDebt = 0;

  for (const chk of chore.correctness) {
    let passed = true;
    switch (chk.check) {
      case 'order_matches': {
        const seq = String(ctx.state.flags[`chore_seq_${id}`] ?? '');
        const arr = seq ? seq.split(',') : [];
        const want =
          chore.steps.find((s) => s.type === 'interact_sequence')?.correctOrder ??
          chore.steps.find((s) => s.type === 'interact_sequence')?.targets ??
          [];
        passed = want.length > 0 && arr.length === want.length && want.every((t, i) => arr[i] === t);
        break;
      }
      case 'before_clock':
        passed = ctx.state.clockMin <= clockValue(ctx, chk.value);
        break;
      case 'flag':
        passed = !!ctx.state.flags[chk.value ?? ''];
        break;
      case 'all_targets': {
        // every target across steps was visited (sequence/carry satisfied)
        passed = true;
        break;
      }
    }
    if (!passed) {
      rec.missedChecks.push(chk.id);
      missDebt += chk.disruptionOnMiss;
    }
  }

  rec.correct = rec.missedChecks.length === 0;
  if (missDebt > 0) ctx.state.disruptionDebt += missDebt;
  ctx.bus.emit({ type: 'choreCompleted', chore: id, correct: rec.correct });
}

/** End-of-day: any of today's chores left undone accrues skip debt. */
export function applyEndOfDay(ctx: Ctx): void {
  for (const c of todaysChores(ctx)) {
    const rec = ctx.state.choresDone[c.id];
    if (!rec || !rec.done) {
      const r = choreState(ctx, c.id);
      r.skipped = true;
      ctx.state.disruptionDebt += c.disruptionOnSkip;
      ctx.bus.emit({ type: 'choreMissed', chore: c.id });
    }
  }
}

export function updateChores(ctx: Ctx, _dt: number): void {
  // Ensure the first step of the active chore has been kicked off once the
  // player is in walk mode (minigame steps auto-push only on advance).
  const chore = activeChore(ctx);
  if (!chore) return;
  const flagKey = `chore_kicked_${chore.id}`;
  if (!ctx.state.flags[flagKey]) {
    ctx.state.flags[flagKey] = true;
    const step = currentStep(ctx, chore);
    // Only auto-start non-world steps if they're first and require UI —
    // world steps wait for the player. Do nothing here to avoid surprise UI.
    void step;
  }
}
