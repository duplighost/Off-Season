/**
 * Canvas 2D renderer. 480×270 internal resolution, integer-scaled to the
 * window via CSS transform. All drawing is palette-indexed; this is the one
 * module allowed to resolve indices to hex (through the active per-day LUT
 * palette set by setPalette).
 *
 * Tiles are painted procedurally per tile type id with dither texture and
 * cached as offscreen canvases per (type, variant, shimmerFrame). Sprites
 * from engine/sprites.ts are baked to offscreen canvases per (sprite, frame).
 * setPalette bumps a palette version and invalidates every cache.
 */

import { BASE_PALETTE, SCREEN_H, SCREEN_W, TILE } from '../types';
import type { Camera, Renderer } from '../types';
import { getSprite } from './sprites';
import type { Sprite } from './sprites';
import { drawText, measure } from '../ui/font';

/** Classic 4×4 Bayer matrix, values 0..15. */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** How many baked variants exist per tile type (position-hashed). */
const TILE_VARIANTS = 4;
/** Water/pool shimmer flips every 32 frames (~0.5s at 60fps). */
const SHIMMER_SHIFT = 5;
/** Max letterbox bar height in px (full amount). */
const LETTERBOX_MAX = 36;

const ANIMATED_TILES = new Set(['water', 'pool']);

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  if (Number.isNaN(n)) return [255, 0, 255];
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Deterministic 2D integer hash — visual variation only, never game logic. */
function hash2(x: number, y: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Tiny deterministic LCG for tile speckle placement (visual only). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function bayer(x: number, y: number): number {
  return BAYER4[((y & 3) << 2) | (x & 3)];
}

// ---------------------------------------------------------------------------
// Procedural tile painters. Each fills a 16×16 buffer of palette indices.
// ---------------------------------------------------------------------------

type TileBuf = Uint8Array;

function put(buf: TileBuf, x: number, y: number, c: number): void {
  if (x >= 0 && x < TILE && y >= 0 && y < TILE) buf[(y << 4) | x] = c;
}

function crackWalk(buf: TileBuf, rnd: () => number, color: number): void {
  let x = 2 + ((rnd() * 12) | 0);
  for (let y = 0; y < TILE; y++) {
    if (rnd() < 0.35) x += rnd() < 0.5 ? -1 : 1;
    if (x < 0) x = 0;
    if (x > 15) x = 15;
    put(buf, x, y, color);
  }
}

function paintWater(buf: TileBuf, v: number, f: number, deep: boolean): void {
  const base = deep ? 4 : 6;
  const wave = 5;
  const glint = deep ? 6 : 13;
  buf.fill(base);
  for (let y = 0; y < TILE; y++) {
    const band = (y + v * 5) & 7;
    if (band >= 3) continue;
    for (let x = 0; x < TILE; x++) {
      if (bayer(x + f * 2, y) < 6) put(buf, x, y, wave);
    }
  }
  const rnd = lcg(0x5eed + v * 97);
  for (let i = 0; i < 3; i++) {
    const x = (rnd() * TILE) | 0;
    const y = (rnd() * TILE) | 0;
    put(buf, (x + f) & 15, y, glint);
  }
}

function paintSand(buf: TileBuf, v: number): void {
  buf.fill(8);
  const rnd = lcg(0xa11d + v * 31);
  for (let i = 0; i < 12; i++) put(buf, (rnd() * TILE) | 0, (rnd() * TILE) | 0, 7);
  for (let i = 0; i < 2; i++) put(buf, (rnd() * TILE) | 0, (rnd() * TILE) | 0, 13);
}

function paintGrass(buf: TileBuf, v: number): void {
  buf.fill(12);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      if (bayer(x + v, y + (v >> 1)) < 5) put(buf, x, y, 11);
    }
  }
  const rnd = lcg(0x6ea5 + v * 53);
  for (let i = 0; i < 3; i++) put(buf, (rnd() * TILE) | 0, (rnd() * TILE) | 0, 7);
  for (let i = 0; i < 2; i++) put(buf, (rnd() * TILE) | 0, (rnd() * TILE) | 0, 11);
}

function paintRoad(buf: TileBuf, v: number): void {
  buf.fill(1);
  const rnd = lcg(0x70ad + v * 17);
  for (let i = 0; i < 10; i++) put(buf, (rnd() * TILE) | 0, (rnd() * TILE) | 0, 2);
  if (v === 3) crackWalk(buf, rnd, 0);
}

function paintSidewalk(buf: TileBuf, v: number): void {
  buf.fill(3);
  for (let i = 0; i < TILE; i++) {
    put(buf, 15, i, 2); // slab joints
    put(buf, i, 15, 2);
  }
  const rnd = lcg(0x51de + v * 41);
  for (let i = 0; i < 6; i++) put(buf, (rnd() * TILE) | 0, (rnd() * TILE) | 0, 2);
}

function paintPlanks(buf: TileBuf, v: number, base: number, seam: number, grain: number): void {
  buf.fill(base);
  for (let y = 0; y < TILE; y++) {
    const plank = y >> 2;
    if ((y & 3) === 3) {
      for (let x = 0; x < TILE; x++) put(buf, x, y, seam);
    } else {
      const joint = (plank * 7 + v * 3) & 15;
      put(buf, joint, y, seam);
    }
  }
  const rnd = lcg(0xb0a2 + v * 29);
  for (let i = 0; i < 6; i++) put(buf, (rnd() * TILE) | 0, (rnd() * TILE) | 0, grain);
}

function paintMarsh(buf: TileBuf, v: number): void {
  buf.fill(11);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      if (bayer(x + v * 2, y) < 6) put(buf, x, y, 12);
    }
  }
  const rnd = lcg(0x3a25 + v * 61);
  for (let i = 0; i < 4; i++) put(buf, (rnd() * TILE) | 0, 10 + ((rnd() * 6) | 0), 5);
  for (let i = 0; i < 2; i++) put(buf, (rnd() * TILE) | 0, 12 + ((rnd() * 4) | 0), 4);
}

function paintRock(buf: TileBuf, v: number): void {
  buf.fill(2);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      if (x + y > 16 && bayer(x, y) < 4) put(buf, x, y, 1);
      else if (x + y < 8 && bayer(x, y) < 3) put(buf, x, y, 3);
    }
  }
  const rnd = lcg(0x40c8 + v * 23);
  if (v & 1) crackWalk(buf, rnd, 0);
  for (let i = 0; i < 3; i++) put(buf, (rnd() * TILE) | 0, (rnd() * TILE) | 0, 1);
}

function paintRail(buf: TileBuf, v: number): void {
  buf.fill(1);
  const rnd = lcg(0x8a11 + v * 37);
  for (let i = 0; i < 8; i++) put(buf, (rnd() * TILE) | 0, (rnd() * TILE) | 0, 2);
  for (let i = 0; i < 4; i++) put(buf, (rnd() * TILE) | 0, (rnd() * TILE) | 0, 0);
  // Wooden ties perpendicular to the run of the rails (rails run E–W).
  for (let y = 2; y <= 13; y++) {
    for (let x = 0; x < TILE; x++) {
      if ((x & 3) < 2) put(buf, x, y, 9);
    }
  }
  for (const y of [4, 5, 10, 11]) {
    for (let x = 0; x < TILE; x++) put(buf, x, y, 3);
  }
}

function paintWall(buf: TileBuf, v: number): void {
  buf.fill(1);
  for (let x = 0; x < TILE; x++) put(buf, x, 0, 2);
  for (let y = 12; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      if (bayer(x + v, y) < 4) put(buf, x, y, 0);
    }
  }
}

function paintFloorTile(buf: TileBuf): void {
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      put(buf, x, y, ((x >> 3) ^ (y >> 3)) & 1 ? 8 : 13);
    }
  }
}

function paintDirt(buf: TileBuf, v: number): void {
  buf.fill(9);
  const rnd = lcg(0xd127 + v * 43);
  for (let i = 0; i < 8; i++) put(buf, (rnd() * TILE) | 0, (rnd() * TILE) | 0, 10);
  for (let i = 0; i < 4; i++) put(buf, (rnd() * TILE) | 0, (rnd() * TILE) | 0, 7);
  for (let i = 0; i < 2; i++) put(buf, (rnd() * TILE) | 0, (rnd() * TILE) | 0, 0);
  put(buf, (rnd() * TILE) | 0, (rnd() * TILE) | 0, 2);
}

function paintPoolEmpty(buf: TileBuf, v: number): void {
  buf.fill(3);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      if (bayer(x, y + v) < 3) put(buf, x, y, 2);
      if (y >= 12 && bayer(x, y) < 8) put(buf, x, y, 2); // waterline stain
    }
  }
  const rnd = lcg(0xe321 + v * 19);
  if (v & 1) crackWalk(buf, rnd, 1);
  if (v === 0) {
    put(buf, 7, 7, 1);
    put(buf, 8, 7, 1);
    put(buf, 7, 8, 1);
    put(buf, 8, 8, 1);
  }
}

function paintChecker(buf: TileBuf): void {
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      put(buf, x, y, ((x >> 2) ^ (y >> 2)) & 1 ? 14 : 0);
    }
  }
}

function paintTile(buf: TileBuf, type: string, v: number, f: number): boolean {
  switch (type) {
    case 'water':
      paintWater(buf, v, f, true);
      return true;
    case 'pool':
      paintWater(buf, v, f, false);
      return true;
    case 'sand':
      paintSand(buf, v);
      return true;
    case 'grass':
      paintGrass(buf, v);
      return true;
    case 'road':
      paintRoad(buf, v);
      return true;
    case 'boardwalk':
      paintPlanks(buf, v, 9, 0, 10);
      return true;
    case 'floor_wood':
      paintPlanks(buf, v, 10, 9, 7);
      return true;
    case 'marsh':
      paintMarsh(buf, v);
      return true;
    case 'rock':
      paintRock(buf, v);
      return true;
    case 'rail':
      paintRail(buf, v);
      return true;
    case 'wall':
      paintWall(buf, v);
      return true;
    case 'floor_tile':
      paintFloorTile(buf);
      return true;
    case 'sidewalk':
      paintSidewalk(buf, v);
      return true;
    case 'dirt':
      paintDirt(buf, v);
      return true;
    case 'pool_empty':
      paintPoolEmpty(buf, v);
      return true;
    default:
      paintChecker(buf);
      return false;
  }
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  canvas.width = SCREEN_W;
  canvas.height = SCREEN_H;
  const c2d = canvas.getContext('2d');
  if (!c2d) throw new Error('[renderer] 2d context unavailable');
  c2d.imageSmoothingEnabled = false;

  let palette: string[] = [...BASE_PALETTE];
  let palRgb: [number, number, number][] = palette.map(hexRgb);
  let palJoined = palette.join(',');
  let paletteVersion = 0;
  let frameNo = 0;
  const cam: Camera = { x: 0, y: 0 };

  const tileCache = new Map<string, HTMLCanvasElement>();
  const spriteCache = new Map<string, HTMLCanvasElement>();
  const fogCache = new Map<number, CanvasPattern>();
  const warned = new Set<string>();
  let nightCv: HTMLCanvasElement | null = null;
  let nightCtx: CanvasRenderingContext2D | null = null;

  function warnOnce(key: string, msg: string): void {
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(msg);
  }

  function col(idx: number): string {
    return palette[idx & 15] ?? '#000000';
  }

  function rgbOf(idx: number): [number, number, number] {
    return palRgb[idx & 15] ?? [0, 0, 0];
  }

  // Integer scaling: CSS transform on the canvas, centered in the window.
  function fitCanvas(): void {
    if (typeof window === 'undefined') return;
    const k = Math.max(
      1,
      Math.floor(Math.min(window.innerWidth / SCREEN_W, window.innerHeight / SCREEN_H)),
    );
    const ox = Math.max(0, Math.floor((window.innerWidth - SCREEN_W * k) / 2));
    const oy = Math.max(0, Math.floor((window.innerHeight - SCREEN_H * k) / 2));
    const st = canvas.style;
    st.position = 'absolute';
    st.left = '0';
    st.top = '0';
    st.transformOrigin = '0 0';
    st.transform = `translate(${ox}px, ${oy}px) scale(${k})`;
    st.imageRendering = 'pixelated';
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', fitCanvas);
    fitCanvas();
  }

  function bufToCanvas(buf: Uint8Array, w: number, h: number): HTMLCanvasElement {
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const g = cv.getContext('2d');
    if (!g) return cv;
    const img = g.createImageData(w, h);
    for (let i = 0; i < buf.length; i++) {
      const pi = buf[i];
      if (pi === 255) continue; // transparent
      const [r, gr, b] = rgbOf(pi);
      const o = i * 4;
      img.data[o] = r;
      img.data[o + 1] = gr;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return cv;
  }

  function tileCanvas(type: string, v: number, f: number): HTMLCanvasElement {
    const key = `${type}:${v}:${f}`;
    let cv = tileCache.get(key);
    if (cv) return cv;
    const buf = new Uint8Array(TILE * TILE);
    const known = paintTile(buf, type, v, f);
    if (!known) warnOnce(`tile:${type}`, `[renderer] unknown tile type '${type}' — drawing checker`);
    cv = bufToCanvas(buf, TILE, TILE);
    tileCache.set(key, cv);
    return cv;
  }

  function spriteCanvas(id: string, spr: Sprite, fr: number): HTMLCanvasElement {
    const key = `${id}#${fr}`;
    let cv = spriteCache.get(key);
    if (cv) return cv;
    const n = spr.w * spr.h;
    const buf = new Uint8Array(n);
    const base = fr * n;
    for (let i = 0; i < n; i++) {
      buf[i] = base + i < spr.data.length ? spr.data[base + i] : 255;
    }
    cv = bufToCanvas(buf, spr.w, spr.h);
    spriteCache.set(key, cv);
    return cv;
  }

  const renderer: Renderer = {
    get ctx(): CanvasRenderingContext2D {
      return c2d;
    },

    setPalette(pal: readonly string[]): void {
      const next = pal.slice(0, 16);
      while (next.length < 16) next.push(BASE_PALETTE[next.length]);
      const joined = next.join(',');
      if (joined === palJoined) return;
      palette = next;
      palRgb = next.map(hexRgb);
      palJoined = joined;
      paletteVersion++;
      tileCache.clear();
      spriteCache.clear();
      fogCache.clear();
    },

    begin(camera: Camera): void {
      frameNo++;
      cam.x = camera.x;
      cam.y = camera.y;
      c2d.globalAlpha = 1;
      c2d.fillStyle = col(0);
      c2d.fillRect(0, 0, SCREEN_W, SCREEN_H);
    },

    drawTile(tileType: string, wx: number, wy: number, variant?: number): void {
      const sx = Math.floor(wx - cam.x);
      const sy = Math.floor(wy - cam.y);
      if (sx <= -TILE || sy <= -TILE || sx >= SCREEN_W || sy >= SCREEN_H) return;
      const v =
        variant !== undefined
          ? ((Math.floor(variant) % TILE_VARIANTS) + TILE_VARIANTS) % TILE_VARIANTS
          : hash2(Math.floor(wx / TILE), Math.floor(wy / TILE)) % TILE_VARIANTS;
      const f = ANIMATED_TILES.has(tileType) ? (frameNo >> SHIMMER_SHIFT) & 1 : 0;
      c2d.drawImage(tileCanvas(tileType, v, f), sx, sy);
    },

    drawSprite(spriteId: string, wx: number, wy: number, opts?: { flipX?: boolean; frame?: number }): void {
      const sx = Math.floor(wx - cam.x);
      const sy = Math.floor(wy - cam.y);
      const spr = getSprite(spriteId);
      if (!spr) {
        warnOnce(`sprite:${spriteId}`, `[renderer] missing sprite '${spriteId}'`);
        if (sx > -8 && sy > -8 && sx < SCREEN_W && sy < SCREEN_H) {
          c2d.fillStyle = col(14);
          c2d.fillRect(sx, sy, 4, 4);
        }
        return;
      }
      if (sx <= -spr.w || sy <= -spr.h || sx >= SCREEN_W || sy >= SCREEN_H) return;
      const frames = Math.max(1, spr.frames | 0);
      const fr = ((Math.floor(opts?.frame ?? 0) % frames) + frames) % frames;
      const cv = spriteCanvas(spriteId, spr, fr);
      if (opts?.flipX) {
        c2d.save();
        c2d.translate(sx + spr.w, sy);
        c2d.scale(-1, 1);
        c2d.drawImage(cv, 0, 0);
        c2d.restore();
      } else {
        c2d.drawImage(cv, sx, sy);
      }
    },

    rect(x: number, y: number, w: number, h: number, colorIdx: number, alpha = 1): void {
      if (alpha <= 0 || w <= 0 || h <= 0) return;
      c2d.globalAlpha = Math.min(1, alpha);
      c2d.fillStyle = col(colorIdx);
      c2d.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
      c2d.globalAlpha = 1;
    },

    frame(x: number, y: number, w: number, h: number, colorIdx: number): void {
      const rx = Math.round(x);
      const ry = Math.round(y);
      const rw = Math.round(w);
      const rh = Math.round(h);
      if (rw <= 0 || rh <= 0) return;
      c2d.fillStyle = col(colorIdx);
      c2d.fillRect(rx, ry, rw, 1);
      c2d.fillRect(rx, ry + rh - 1, rw, 1);
      c2d.fillRect(rx, ry, 1, rh);
      c2d.fillRect(rx + rw - 1, ry, 1, rh);
    },

    text(s: string, x: number, y: number, colorIdx: number, opts?: { maxWidth?: number; serif?: boolean }): void {
      drawText(c2d, s, x, y, col(colorIdx), opts);
    },

    textWidth(s: string, serif?: boolean): number {
      return measure(s, serif);
    },

    fog(density: number): void {
      const d = density < 0 ? 0 : density > 1 ? 1 : density;
      const level = Math.round(d * 16);
      if (level <= 0) return;
      let pat = fogCache.get(level);
      if (!pat) {
        const cv = document.createElement('canvas');
        cv.width = 4;
        cv.height = 4;
        const g = cv.getContext('2d');
        if (!g) return;
        const img = g.createImageData(4, 4);
        const [r, gr, b] = rgbOf(3);
        for (let i = 0; i < 16; i++) {
          if (BAYER4[i] >= level) continue;
          const o = i * 4;
          img.data[o] = r;
          img.data[o + 1] = gr;
          img.data[o + 2] = b;
          img.data[o + 3] = 255;
        }
        g.putImageData(img, 0, 0);
        const p = c2d.createPattern(cv, 'repeat');
        if (!p) return;
        pat = p;
        fogCache.set(level, pat);
      }
      // Slow drift so the fog reads as a sheet moving on parallax.
      const ox = (frameNo >> 4) & 3;
      const oy = (frameNo >> 5) & 3;
      c2d.save();
      c2d.translate(-ox, -oy);
      c2d.fillStyle = pat;
      c2d.fillRect(0, 0, SCREEN_W + 4, SCREEN_H + 4);
      c2d.restore();
    },

    nightOverlay(darkness: number, lights: { x: number; y: number; r: number }[], camArg: Camera): void {
      const dk = darkness < 0 ? 0 : darkness > 1 ? 1 : darkness;
      if (dk <= 0.003) return;
      if (!nightCv || !nightCtx) {
        nightCv = document.createElement('canvas');
        nightCv.width = SCREEN_W;
        nightCv.height = SCREEN_H;
        nightCtx = nightCv.getContext('2d');
        if (!nightCtx) return;
      }
      const oc = nightCtx;
      oc.globalCompositeOperation = 'source-over';
      oc.clearRect(0, 0, SCREEN_W, SCREEN_H);
      oc.fillStyle = col(0);
      oc.fillRect(0, 0, SCREEN_W, SCREEN_H);

      // Punch soft radial holes where windows spill light.
      oc.globalCompositeOperation = 'destination-out';
      const vis: { x: number; y: number; r: number }[] = [];
      for (const L of lights) {
        if (!L || L.r <= 0) continue;
        const sx = L.x - camArg.x;
        const sy = L.y - camArg.y;
        if (sx + L.r < 0 || sy + L.r < 0 || sx - L.r > SCREEN_W || sy - L.r > SCREEN_H) continue;
        vis.push({ x: sx, y: sy, r: L.r });
        const g = oc.createRadialGradient(sx, sy, 0, sx, sy, L.r);
        g.addColorStop(0, 'rgba(0,0,0,0.95)');
        g.addColorStop(0.55, 'rgba(0,0,0,0.7)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        oc.fillStyle = g;
        oc.fillRect(sx - L.r, sy - L.r, L.r * 2, L.r * 2);
      }
      oc.globalCompositeOperation = 'source-over';

      c2d.save();
      c2d.globalAlpha = dk;
      c2d.drawImage(nightCv, 0, 0);
      c2d.restore();

      // Warm spill (window light, index 15) inside the holes.
      if (vis.length > 0) {
        const [r, gr, b] = rgbOf(15);
        for (const L of vis) {
          const g = c2d.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.r);
          g.addColorStop(0, `rgba(${r},${gr},${b},${(0.28 * dk).toFixed(3)})`);
          g.addColorStop(1, `rgba(${r},${gr},${b},0)`);
          c2d.fillStyle = g;
          c2d.fillRect(L.x - L.r, L.y - L.r, L.r * 2, L.r * 2);
        }
      }
    },

    letterbox(amount01: number): void {
      const a = amount01 < 0 ? 0 : amount01 > 1 ? 1 : amount01;
      const h = Math.round(a * LETTERBOX_MAX);
      if (h <= 0) return;
      c2d.fillStyle = col(0);
      c2d.fillRect(0, 0, SCREEN_W, h);
      c2d.fillRect(0, SCREEN_H - h, SCREEN_W, h);
    },

    end(): void {
      c2d.globalAlpha = 1;
    },
  };

  return renderer;
}
