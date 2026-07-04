import { describe, it, expect } from 'vitest';
import { checkEnding } from '../src/systems/story';
import { newGame } from '../src/engine/save';
import type { Ctx, GameState } from '../src/types';

/** Minimal Ctx for checkEnding: it reads state + content.chores only. */
function makeCtx(mut: (s: GameState) => void): Ctx {
  const state = newGame(1);
  state.day = 9;
  mut(state);
  const content = {
    chores: {
      chores: [
        { id: 'chore.d8.x', day: 8, item: 8, title: '', room: 'town', steps: [], correctness: [], deadline: 'midnight', disruptionOnSkip: 3 },
        { id: 'chore.d9.x', day: 9, item: 9, title: '', room: 'town', steps: [], correctness: [], deadline: 'midnight', disruptionOnSkip: 3 },
      ],
    },
  } as unknown as Ctx['content'];
  return { state, content } as unknown as Ctx;
}

describe('checkEnding — the ending matrix (§8.2)', () => {
  it('By the Book: june_reported resolves regardless of other flags', () => {
    const ctx = makeCtx((s) => {
      s.flags.june_reported = true;
      s.flags.lantern_doused = true;
    });
    expect(checkEnding(ctx)).toBe('by_the_book');
  });

  it('Two Hundred and One: filed + trust>=70 + clean count', () => {
    const ctx = makeCtx((s) => {
      s.flags.form12c_filed = true;
      s.flags.count_clean = true;
      s.flags.lantern_doused = true;
      s.juneTrust = 72;
    });
    expect(checkEnding(ctx)).toBe('two_hundred_one');
  });

  it('Two Hundred and One requires trust>=70 (69 falls through)', () => {
    const ctx = makeCtx((s) => {
      s.flags.form12c_filed = true;
      s.flags.count_clean = true;
      s.flags.lantern_doused = true;
      s.juneTrust = 69;
    });
    // doused + not-201 + no hide -> by_the_book quiet cousin
    expect(checkEnding(ctx)).toBe('by_the_book');
  });

  it('Stowaway: doused with June hidden, not reported, not claimed', () => {
    const ctx = makeCtx((s) => {
      s.flags.lantern_doused = true;
      s.flags.june_hidden = true;
      s.flags.june_hiding_place = 'church';
    });
    expect(checkEnding(ctx)).toBe('stowaway');
  });

  it('Long Light: lantern refused', () => {
    const ctx = makeCtx((s) => {
      s.flags.lantern_refused = true;
      s.flags.june_hidden = true;
    });
    expect(checkEnding(ctx)).toBe('long_light');
  });

  it('Last Train (secret) outranks everything when its conditions hold', () => {
    const ctx = makeCtx((s) => {
      s.suspicion = 92;
      s.flags.on_depot_platform_night9 = true;
      s.flags.june_reported = true; // would otherwise be by_the_book
      // day 8 & 9 chores left undone (choresDone empty) => abandoned
    });
    expect(checkEnding(ctx)).toBe('last_train');
  });

  it('Last Train does NOT fire if chores were done (suspicion high but engaged)', () => {
    const ctx = makeCtx((s) => {
      s.suspicion = 95;
      s.flags.on_depot_platform_night9 = true;
      s.flags.june_reported = true;
      s.choresDone = {
        'chore.d8.x': { done: true, correct: true, missedChecks: [] },
        'chore.d9.x': { done: true, correct: true, missedChecks: [] },
      };
    });
    expect(checkEnding(ctx)).toBe('by_the_book');
  });

  it('By the Book preempts Two Hundred and One (priority)', () => {
    const ctx = makeCtx((s) => {
      s.flags.june_reported = true;
      s.flags.form12c_filed = true;
      s.flags.count_clean = true;
      s.juneTrust = 80;
    });
    expect(checkEnding(ctx)).toBe('by_the_book');
  });

  it('Day 9 reached undoused/unrefused defaults to Long Light', () => {
    const ctx = makeCtx(() => {
      /* no ending flags at all */
    });
    expect(checkEnding(ctx)).toBe('long_light');
  });
});
