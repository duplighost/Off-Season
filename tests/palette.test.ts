import { describe, expect, it } from 'vitest';
import { fogDensity, paletteForDay } from '../src/systems/palette';
import { BASE_PALETTE } from '../src/types';
import type { GameState } from '../src/types';

const HEX_RE = /^#[0-9a-f]{6}$/;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function satOf(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  if (max === min) return 0;
  const l = (max + min) / 2;
  const d = max - min;
  return l > 0.5 ? d / (2 - max - min) : d / (max + min);
}

function avgSat(pal: string[]): number {
  return pal.reduce((a, c) => a + satOf(c), 0) / pal.length;
}

function fakeState(day: number, clockMin: number, disruptionDebt = 0): GameState {
  return { day, clockMin, disruptionDebt } as unknown as GameState;
}

describe('paletteForDay', () => {
  it('day 1 with no debt is the base palette, verbatim', () => {
    expect(paletteForDay(1, 0)).toEqual([...BASE_PALETTE]);
  });

  it('always returns 16 well-formed hex colors', () => {
    for (const day of [0, 1, 2, 5, 9, 12, 99]) {
      for (const debt of [0, 3, 9, 50]) {
        const pal = paletteForDay(day, debt);
        expect(pal).toHaveLength(16);
        for (const c of pal) expect(c).toMatch(HEX_RE);
      }
    }
  });

  it('desaturates monotonically across the nine days', () => {
    let prev = avgSat(paletteForDay(1, 0));
    for (let day = 2; day <= 9; day++) {
      const cur = avgSat(paletteForDay(day, 0));
      expect(cur).toBeLessThan(prev);
      prev = cur;
    }
  });

  it('is deterministic', () => {
    expect(paletteForDay(6, 4)).toEqual(paletteForDay(6, 4));
    expect(paletteForDay(9, 0)).toEqual(paletteForDay(9, 0));
  });

  it('disruption debt drags the palette further into decay', () => {
    expect(avgSat(paletteForDay(3, 9))).toBeLessThan(avgSat(paletteForDay(3, 0)));
  });

  it('debt never brightens: day 9 heavy-debt palette is at least as gray as clean day 9', () => {
    expect(avgSat(paletteForDay(9, 12))).toBeLessThanOrEqual(avgSat(paletteForDay(9, 0)));
  });

  it('lifts the blacks as the fog floor rises', () => {
    const [r1, g1, b1] = hexToRgb(paletteForDay(1, 0)[0]);
    const [r9, g9, b9] = hexToRgb(paletteForDay(9, 0)[0]);
    expect(r9 + g9 + b9).toBeGreaterThan(r1 + g1 + b1);
  });

  it('returns a fresh array (mutation-safe)', () => {
    const a = paletteForDay(1, 0);
    a[0] = '#ffffff';
    expect(paletteForDay(1, 0)[0]).toBe(BASE_PALETTE[0]);
  });
});

describe('fogDensity', () => {
  it('stays within [0, 1] across the whole space', () => {
    for (const day of [1, 3, 5, 7, 9]) {
      for (const clock of [390, 720, 1080, 1140, 1439]) {
        for (const debt of [0, 5, 20]) {
          const f = fogDensity(fakeState(day, clock, debt), debt);
          expect(f).toBeGreaterThanOrEqual(0);
          expect(f).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('is denser at dusk than in the morning', () => {
    for (const day of [2, 5, 9]) {
      const morning = fogDensity(fakeState(day, 8 * 60));
      const night = fogDensity(fakeState(day, 21 * 60));
      expect(night).toBeGreaterThan(morning);
    }
  });

  it('later days are at least as foggy at the same clock time', () => {
    let prev = fogDensity(fakeState(1, 18 * 60));
    for (let day = 2; day <= 9; day++) {
      const cur = fogDensity(fakeState(day, 18 * 60));
      expect(cur).toBeGreaterThanOrEqual(prev);
      prev = cur;
    }
    // and the front has clearly moved in by day 9
    expect(fogDensity(fakeState(9, 18 * 60))).toBeGreaterThan(fogDensity(fakeState(1, 18 * 60)));
  });

  it('the fog front arrives before sunset (perceived dusk comes early)', () => {
    // Day 9 sunset is 18:35; lead is 85 min. At 18:00 fog should already be rolling.
    const preSunset = fogDensity(fakeState(9, 18 * 60));
    const noon = fogDensity(fakeState(9, 12 * 60));
    expect(preSunset).toBeGreaterThan(noon);
  });

  it('disruption debt thickens the fog', () => {
    const clean = fogDensity(fakeState(5, 12 * 60, 0));
    const indebted = fogDensity(fakeState(5, 12 * 60, 9));
    expect(indebted).toBeGreaterThan(clean);
  });

  it('zone-local debt adds on top', () => {
    const base = fogDensity(fakeState(5, 12 * 60, 0), 0);
    const zoned = fogDensity(fakeState(5, 12 * 60, 0), 6);
    expect(zoned).toBeGreaterThan(base);
  });

  it('clamps out-of-range days instead of crashing', () => {
    expect(fogDensity(fakeState(0, 720))).toBeGreaterThanOrEqual(0);
    expect(fogDensity(fakeState(42, 720))).toBeLessThanOrEqual(1);
  });
});
