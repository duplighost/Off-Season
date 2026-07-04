/**
 * Seeded PRNG (mulberry32), stream-split by consumer name.
 *
 * Every piece of game-logic randomness flows through here (design bible §0
 * invariant 2). A factory is created once per run from the save seed; named
 * streams ('director:3', 'ambient', 'misc') are derived and cached so that
 * repeated `stream(name)` calls continue the same sequence.
 */

import type { Rng, RngFactory } from '../types';

/** FNV-1a 32-bit with a murmur-style finalizer, so short similar names
 *  ('director:1' vs 'director:2') still land far apart. Deterministic. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seed: number): Rng {
  const next = mulberry32(seed);
  return {
    next,
    int(maxExclusive: number): number {
      if (maxExclusive <= 0) return 0;
      return Math.floor(next() * maxExclusive);
    },
    pick<T>(arr: readonly T[]): T {
      // Empty arrays yield undefined; callers own guarding empty content.
      return arr[Math.floor(next() * arr.length)] as T;
    },
    shuffle<T>(arr: T[]): T[] {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = arr[i] as T;
        arr[i] = arr[j] as T;
        arr[j] = tmp;
      }
      return arr;
    },
  };
}

export function makeRngFactory(seed: number): RngFactory {
  const root = seed >>> 0;
  const streams = new Map<string, Rng>();
  return {
    stream(name: string): Rng {
      let rng = streams.get(name);
      if (!rng) {
        rng = makeRng((root ^ hashString(name)) >>> 0);
        streams.set(name, rng);
      }
      return rng;
    },
  };
}
