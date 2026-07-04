import { describe, expect, it } from 'vitest';
import { hashString, makeRngFactory } from '../src/engine/prng';

const draw = (n: number, f: () => number) => Array.from({ length: n }, f);

describe('hashString', () => {
  it('is deterministic', () => {
    expect(hashString('director:3')).toBe(hashString('director:3'));
    expect(hashString('')).toBe(hashString(''));
  });

  it('returns unsigned 32-bit integers', () => {
    for (const s of ['', 'a', 'ambient', 'director:9', 'misc', 'ленточка']) {
      const h = hashString(s);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(2 ** 32);
    }
  });

  it('separates the stream names the game actually uses', () => {
    const names = [
      'ambient',
      'misc',
      ...Array.from({ length: 9 }, (_, i) => `director:${i + 1}`),
    ];
    const hashes = new Set(names.map(hashString));
    expect(hashes.size).toBe(names.length);
  });
});

describe('makeRngFactory', () => {
  it('same seed + same stream name => identical sequence', () => {
    const a = makeRngFactory(88291).stream('director:3');
    const b = makeRngFactory(88291).stream('director:3');
    expect(draw(200, () => a.next())).toEqual(draw(200, () => b.next()));
  });

  it('different seeds diverge', () => {
    const a = makeRngFactory(1).stream('misc');
    const b = makeRngFactory(2).stream('misc');
    expect(draw(20, () => a.next())).not.toEqual(draw(20, () => b.next()));
  });

  it('different stream names diverge', () => {
    const f = makeRngFactory(88291);
    const a = f.stream('director:1');
    const b = f.stream('director:2');
    expect(draw(20, () => a.next())).not.toEqual(draw(20, () => b.next()));
  });

  it('caches streams: repeated stream() calls continue one sequence', () => {
    const fresh = makeRngFactory(7).stream('ambient');
    const expected = draw(4, () => fresh.next());
    const f = makeRngFactory(7);
    const got = draw(4, () => f.stream('ambient').next());
    expect(got).toEqual(expected);
  });

  it('streams are independent: draining one does not perturb another', () => {
    const clean = makeRngFactory(555);
    const expected = draw(50, () => clean.stream('director:2').next());

    const noisy = makeRngFactory(555);
    draw(1000, () => noisy.stream('director:1').next());
    draw(137, () => noisy.stream('ambient').next());
    const got = draw(50, () => noisy.stream('director:2').next());

    expect(got).toEqual(expected);
  });

  it('next() stays in [0, 1)', () => {
    const r = makeRngFactory(42).stream('misc');
    for (const v of draw(5000, () => r.next())) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int(n) yields integers in [0, n) and covers the range', () => {
    const r = makeRngFactory(42).stream('misc');
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const v = r.int(6);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
      seen.add(v);
    }
    expect(seen.size).toBe(6);
  });

  it('int(0) and negative bounds return 0 without consuming issues', () => {
    const r = makeRngFactory(9).stream('misc');
    expect(r.int(0)).toBe(0);
    expect(r.int(-5)).toBe(0);
  });

  it('pick returns members of the array, deterministically', () => {
    const arr = ['a', 'b', 'c', 'd'] as const;
    const a = makeRngFactory(31).stream('misc');
    const b = makeRngFactory(31).stream('misc');
    const seqA = draw(100, () => a.pick(arr));
    const seqB = draw(100, () => b.pick(arr));
    expect(seqA).toEqual(seqB);
    for (const v of seqA) expect(arr).toContain(v);
  });

  it('shuffle is an in-place deterministic permutation', () => {
    const base = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const a = makeRngFactory(77).stream('misc').shuffle([...base]);
    const b = makeRngFactory(77).stream('misc').shuffle([...base]);
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual(base);
    expect(a).not.toEqual(base); // vanishingly unlikely for 10 elements
  });

  it('seed is treated as uint32 (matching save-file round trips)', () => {
    const a = makeRngFactory(0xffffffff + 1).stream('misc'); // wraps to 0
    const b = makeRngFactory(0).stream('misc');
    expect(draw(10, () => a.next())).toEqual(draw(10, () => b.next()));
  });
});
