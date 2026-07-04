/**
 * Two tiny bitmap fonts, authored in-code as pixel glyph strings.
 *  - DIN-ish 5×7: municipal UI face (checklist, HUD, dialogue).
 *  - Worn serif 6×8: the Ledger and documents. Caps and a handful of
 *    lowercase are authored with serifs; the rest share the DIN forms
 *    (dropped one row so baselines align), which reads as a worn jobbing
 *    face — exactly right for Town Hall paperwork.
 * Both cover printable ASCII (0x20–0x7E). No canvas font strings anywhere.
 */

interface Glyph {
  w: number;
  /** One bitmask per row; bit i = column i set. */
  rows: number[];
}

interface BitmapFont {
  height: number;
  glyphs: Map<string, Glyph>;
  fallback: Glyph;
}

const DIN_SRC: Record<string, string[]> = {
  ' ': ['...'],
  '!': ['X', 'X', 'X', 'X', 'X', '.', 'X'],
  '"': ['X.X', 'X.X'],
  '#': ['.X.X.', '.X.X.', 'XXXXX', '.X.X.', 'XXXXX', '.X.X.', '.X.X.'],
  $: ['..X..', '.XXXX', 'X....', '.XXX.', '....X', 'XXXX.', '..X..'],
  '%': ['XX..X', 'XX..X', '...X.', '..X..', '.X...', 'X..XX', 'X..XX'],
  '&': ['.XX..', 'X..X.', 'X.X..', '.X...', 'X.X.X', 'X..X.', '.XX.X'],
  "'": ['X', 'X'],
  '(': ['.X', 'X.', 'X.', 'X.', 'X.', 'X.', '.X'],
  ')': ['X.', '.X', '.X', '.X', '.X', '.X', 'X.'],
  '*': ['.....', '.X.X.', '..X..', 'XXXXX', '..X..', '.X.X.'],
  '+': ['.....', '..X..', '..X..', 'XXXXX', '..X..', '..X..'],
  ',': ['..', '..', '..', '..', '..', '.X', 'X.'],
  '-': ['....', '....', '....', 'XXXX'],
  '.': ['.', '.', '.', '.', '.', '.', 'X'],
  '/': ['....X', '....X', '...X.', '..X..', '.X...', 'X....', 'X....'],
  '0': ['.XXX.', 'X...X', 'X..XX', 'X.X.X', 'XX..X', 'X...X', '.XXX.'],
  '1': ['..X..', '.XX..', '..X..', '..X..', '..X..', '..X..', '.XXX.'],
  '2': ['.XXX.', 'X...X', '....X', '...X.', '..X..', '.X...', 'XXXXX'],
  '3': ['.XXX.', 'X...X', '....X', '..XX.', '....X', 'X...X', '.XXX.'],
  '4': ['...X.', '..XX.', '.X.X.', 'X..X.', 'XXXXX', '...X.', '...X.'],
  '5': ['XXXXX', 'X....', 'XXXX.', '....X', '....X', 'X...X', '.XXX.'],
  '6': ['.XXX.', 'X....', 'X....', 'XXXX.', 'X...X', 'X...X', '.XXX.'],
  '7': ['XXXXX', '....X', '...X.', '..X..', '..X..', '.X...', '.X...'],
  '8': ['.XXX.', 'X...X', 'X...X', '.XXX.', 'X...X', 'X...X', '.XXX.'],
  '9': ['.XXX.', 'X...X', 'X...X', '.XXXX', '....X', '....X', '.XXX.'],
  ':': ['.', '.', 'X', '.', '.', 'X'],
  ';': ['..', '..', '.X', '..', '..', '.X', 'X.'],
  '<': ['...X', '..X.', '.X..', 'X...', '.X..', '..X.', '...X'],
  '=': ['....', '....', 'XXXX', '....', 'XXXX'],
  '>': ['X...', '.X..', '..X.', '...X', '..X.', '.X..', 'X...'],
  '?': ['.XXX.', 'X...X', '....X', '...X.', '..X..', '.....', '..X..'],
  '@': ['.XXX.', 'X...X', '....X', '.XX.X', 'X.X.X', 'X.X.X', '.XXX.'],
  A: ['.XXX.', 'X...X', 'X...X', 'XXXXX', 'X...X', 'X...X', 'X...X'],
  B: ['XXXX.', 'X...X', 'X...X', 'XXXX.', 'X...X', 'X...X', 'XXXX.'],
  C: ['.XXX.', 'X...X', 'X....', 'X....', 'X....', 'X...X', '.XXX.'],
  D: ['XXXX.', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', 'XXXX.'],
  E: ['XXXXX', 'X....', 'X....', 'XXXX.', 'X....', 'X....', 'XXXXX'],
  F: ['XXXXX', 'X....', 'X....', 'XXXX.', 'X....', 'X....', 'X....'],
  G: ['.XXX.', 'X...X', 'X....', 'X.XXX', 'X...X', 'X...X', '.XXXX'],
  H: ['X...X', 'X...X', 'X...X', 'XXXXX', 'X...X', 'X...X', 'X...X'],
  I: ['XXX', '.X.', '.X.', '.X.', '.X.', '.X.', 'XXX'],
  J: ['....X', '....X', '....X', '....X', '....X', 'X...X', '.XXX.'],
  K: ['X...X', 'X..X.', 'X.X..', 'XX...', 'X.X..', 'X..X.', 'X...X'],
  L: ['X....', 'X....', 'X....', 'X....', 'X....', 'X....', 'XXXXX'],
  M: ['X...X', 'XX.XX', 'X.X.X', 'X.X.X', 'X...X', 'X...X', 'X...X'],
  N: ['X...X', 'XX..X', 'X.X.X', 'X..XX', 'X...X', 'X...X', 'X...X'],
  O: ['.XXX.', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', '.XXX.'],
  P: ['XXXX.', 'X...X', 'X...X', 'XXXX.', 'X....', 'X....', 'X....'],
  Q: ['.XXX.', 'X...X', 'X...X', 'X...X', 'X.X.X', 'X..X.', '.XX.X'],
  R: ['XXXX.', 'X...X', 'X...X', 'XXXX.', 'X.X..', 'X..X.', 'X...X'],
  S: ['.XXXX', 'X....', 'X....', '.XXX.', '....X', '....X', 'XXXX.'],
  T: ['XXXXX', '..X..', '..X..', '..X..', '..X..', '..X..', '..X..'],
  U: ['X...X', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', '.XXX.'],
  V: ['X...X', 'X...X', 'X...X', 'X...X', 'X...X', '.X.X.', '..X..'],
  W: ['X...X', 'X...X', 'X...X', 'X.X.X', 'X.X.X', 'X.X.X', '.X.X.'],
  X: ['X...X', 'X...X', '.X.X.', '..X..', '.X.X.', 'X...X', 'X...X'],
  Y: ['X...X', 'X...X', '.X.X.', '..X..', '..X..', '..X..', '..X..'],
  Z: ['XXXXX', '....X', '...X.', '..X..', '.X...', 'X....', 'XXXXX'],
  '[': ['XX', 'X.', 'X.', 'X.', 'X.', 'X.', 'XX'],
  '\\': ['X....', 'X....', '.X...', '..X..', '...X.', '....X', '....X'],
  ']': ['XX', '.X', '.X', '.X', '.X', '.X', 'XX'],
  '^': ['..X..', '.X.X.', 'X...X'],
  _: ['.....', '.....', '.....', '.....', '.....', '.....', 'XXXXX'],
  '`': ['X.', '.X'],
  a: ['.....', '.....', '.XXX.', '....X', '.XXXX', 'X...X', '.XXXX'],
  b: ['X....', 'X....', 'XXXX.', 'X...X', 'X...X', 'X...X', 'XXXX.'],
  c: ['.....', '.....', '.XXX.', 'X....', 'X....', 'X....', '.XXX.'],
  d: ['....X', '....X', '.XXXX', 'X...X', 'X...X', 'X...X', '.XXXX'],
  e: ['.....', '.....', '.XXX.', 'X...X', 'XXXXX', 'X....', '.XXX.'],
  f: ['..XX', '.X..', 'XXX.', '.X..', '.X..', '.X..', '.X..'],
  g: ['.....', '.XXXX', 'X...X', 'X...X', '.XXXX', '....X', '.XXX.'],
  h: ['X....', 'X....', 'XXXX.', 'X...X', 'X...X', 'X...X', 'X...X'],
  i: ['X', '.', 'X', 'X', 'X', 'X', 'X'],
  j: ['..X', '...', '..X', '..X', '..X', 'X.X', '.X.'],
  k: ['X....', 'X....', 'X..X.', 'X.X..', 'XXX..', 'X..X.', 'X...X'],
  l: ['X.', 'X.', 'X.', 'X.', 'X.', 'X.', '.X'],
  m: ['.....', '.....', 'XX.X.', 'X.X.X', 'X.X.X', 'X.X.X', 'X.X.X'],
  n: ['.....', '.....', 'XXXX.', 'X...X', 'X...X', 'X...X', 'X...X'],
  o: ['.....', '.....', '.XXX.', 'X...X', 'X...X', 'X...X', '.XXX.'],
  p: ['.....', 'XXXX.', 'X...X', 'X...X', 'XXXX.', 'X....', 'X....'],
  q: ['.....', '.XXXX', 'X...X', 'X...X', '.XXXX', '....X', '....X'],
  r: ['....', '....', 'X.XX', 'XX..', 'X...', 'X...', 'X...'],
  s: ['.....', '.....', '.XXXX', 'X....', '.XXX.', '....X', 'XXXX.'],
  t: ['.X.', '.X.', 'XXX', '.X.', '.X.', '.X.', '..X'],
  u: ['.....', '.....', 'X...X', 'X...X', 'X...X', 'X...X', '.XXXX'],
  v: ['.....', '.....', 'X...X', 'X...X', 'X...X', '.X.X.', '..X..'],
  w: ['.....', '.....', 'X.X.X', 'X.X.X', 'X.X.X', 'X.X.X', '.X.X.'],
  x: ['.....', '.....', 'X...X', '.X.X.', '..X..', '.X.X.', 'X...X'],
  y: ['.....', 'X...X', 'X...X', 'X...X', '.XXXX', '....X', '.XXX.'],
  z: ['.....', '.....', 'XXXXX', '...X.', '..X..', '.X...', 'XXXXX'],
  '{': ['..X', '.X.', '.X.', 'X..', '.X.', '.X.', '..X'],
  '|': ['X', 'X', 'X', 'X', 'X', 'X', 'X'],
  '}': ['X..', '.X.', '.X.', '..X', '.X.', '.X.', 'X..'],
  '~': ['.....', '.....', '.X..X', 'X.X.X', 'X..X.'],
};

/** Serif-styled overrides; anything absent falls back to the DIN form. */
const SERIF_SRC: Record<string, string[]> = {
  A: ['..XX..', '.X..X.', '.X..X.', 'X....X', 'XXXXXX', 'X....X', 'X....X', 'XX..XX'],
  B: ['XXXXX.', '.X...X', '.X...X', '.XXXX.', '.X...X', '.X...X', '.X...X', 'XXXXX.'],
  C: ['.XXXX.', 'X....X', 'X.....', 'X.....', 'X.....', 'X.....', 'X....X', '.XXXX.'],
  D: ['XXXXX.', '.X...X', '.X...X', '.X...X', '.X...X', '.X...X', '.X...X', 'XXXXX.'],
  E: ['XXXXXX', '.X...X', '.X....', '.XXXX.', '.X....', '.X....', '.X...X', 'XXXXXX'],
  F: ['XXXXXX', '.X...X', '.X....', '.XXXX.', '.X....', '.X....', '.X....', 'XXX...'],
  G: ['.XXXX.', 'X....X', 'X.....', 'X.....', 'X..XXX', 'X....X', 'X....X', '.XXXX.'],
  H: ['XX..XX', '.X..X.', '.X..X.', '.XXXX.', '.X..X.', '.X..X.', '.X..X.', 'XX..XX'],
  I: ['XXXX', '.XX.', '.XX.', '.XX.', '.XX.', '.XX.', '.XX.', 'XXXX'],
  J: ['..XXXX', '....X.', '....X.', '....X.', '....X.', '....X.', 'X...X.', '.XXX..'],
  K: ['XX..XX', '.X..X.', '.X.X..', '.XX...', '.X.X..', '.X..X.', '.X..X.', 'XX..XX'],
  L: ['XXX...', '.X....', '.X....', '.X....', '.X....', '.X....', '.X...X', 'XXXXXX'],
  M: ['X....X', 'XX..XX', 'X.XX.X', 'X.XX.X', 'X....X', 'X....X', 'X....X', 'XX..XX'],
  N: ['XX...X', '.XX..X', '.XX..X', '.X.X.X', '.X.X.X', '.X..XX', '.X..XX', 'XX...X'],
  O: ['.XXXX.', 'X....X', 'X....X', 'X....X', 'X....X', 'X....X', 'X....X', '.XXXX.'],
  P: ['XXXXX.', '.X...X', '.X...X', '.XXXX.', '.X....', '.X....', '.X....', 'XXX...'],
  Q: ['.XXXX.', 'X....X', 'X....X', 'X....X', 'X....X', 'X..X.X', 'X...X.', '.XXX.X'],
  R: ['XXXXX.', '.X...X', '.X...X', '.XXXX.', '.X.X..', '.X..X.', '.X..X.', 'XXX..X'],
  S: ['.XXXX.', 'X....X', 'X.....', '.XXX..', '....X.', '.....X', 'X....X', '.XXXX.'],
  T: ['XXXXXX', 'X.XX.X', '..XX..', '..XX..', '..XX..', '..XX..', '..XX..', '.XXXX.'],
  U: ['XX..XX', '.X..X.', '.X..X.', '.X..X.', '.X..X.', '.X..X.', '.X..X.', '..XX..'],
  V: ['XX..XX', 'X....X', 'X....X', '.X..X.', '.X..X.', '.X..X.', '..XX..', '..XX..'],
  W: ['XX..XX', 'X....X', 'X....X', 'X.XX.X', 'X.XX.X', 'X.XX.X', '.X..X.', '.X..X.'],
  X: ['XX..XX', '.X..X.', '..XX..', '..XX..', '..XX..', '..XX..', '.X..X.', 'XX..XX'],
  Y: ['XX..XX', '.X..X.', '.X..X.', '..XX..', '..XX..', '..XX..', '..XX..', '.XXXX.'],
  Z: ['XXXXXX', 'X...X.', '...X..', '..XX..', '..X...', '.X....', 'X....X', 'XXXXXX'],
  b: ['XX...', '.X...', '.X...', '.XXX.', '.X..X', '.X..X', '.X..X', 'XXXX.'],
  d: ['...XX', '....X', '....X', '.XXXX', 'X...X', 'X...X', 'X...X', '.XXXX'],
  f: ['..XX', '.X..', '.X..', 'XXX.', '.X..', '.X..', '.X..', 'XXX.'],
  h: ['XX...', '.X...', '.X...', '.XXX.', '.X..X', '.X..X', '.X..X', 'XX.XX'],
  i: ['.X.', '...', 'XX.', '.X.', '.X.', '.X.', '.X.', 'XXX'],
  j: ['..X.', '....', '.XX.', '..X.', '..X.', '..X.', '..X.', 'XX..'],
  k: ['XX...', '.X...', '.X..X', '.X.X.', '.XX..', '.X.X.', '.X..X', 'XX..X'],
  l: ['XX.', '.X.', '.X.', '.X.', '.X.', '.X.', '.X.', 'XXX'],
  n: ['.....', '.....', '.....', 'XX.X.', '.X..X', '.X..X', '.X..X', 'XX.XX'],
  r: ['.....', '.....', '.....', 'XX.XX', '.XX..', '.X...', '.X...', 'XXX..'],
  t: ['....', '.X..', '.X..', 'XXXX', '.X..', '.X..', '.X.X', '..X.'],
  u: ['.....', '.....', '.....', 'XX.XX', '.X..X', '.X..X', '.X..X', '..XXX'],
};

function parseGlyph(rows: string[]): Glyph {
  let w = 1;
  for (const r of rows) w = Math.max(w, r.length);
  const bits = rows.map((r) => {
    let m = 0;
    for (let i = 0; i < r.length; i++) {
      if (r[i] !== '.' && r[i] !== ' ') m |= 1 << i;
    }
    return m;
  });
  return { w, rows: bits };
}

const FALLBACK_SRC = ['XXXXX', 'X...X', 'X.X.X', 'X...X', 'X.X.X', 'X...X', 'XXXXX'];

function buildDin(): BitmapFont {
  const glyphs = new Map<string, Glyph>();
  for (const ch of Object.keys(DIN_SRC)) glyphs.set(ch, parseGlyph(DIN_SRC[ch]));
  for (let c = 0x20; c <= 0x7e; c++) {
    const ch = String.fromCharCode(c);
    if (!glyphs.has(ch)) console.warn(`[font] missing DIN glyph for '${ch}'`);
  }
  return { height: 7, glyphs, fallback: parseGlyph(FALLBACK_SRC) };
}

function buildSerif(din: BitmapFont): BitmapFont {
  const glyphs = new Map<string, Glyph>();
  // Share DIN forms, dropped one row so the 7-row baseline sits on row 7 of 8.
  for (const [ch, g] of din.glyphs) glyphs.set(ch, { w: g.w, rows: [0, ...g.rows] });
  for (const ch of Object.keys(SERIF_SRC)) glyphs.set(ch, parseGlyph(SERIF_SRC[ch]));
  return {
    height: 8,
    glyphs,
    fallback: { w: din.fallback.w, rows: [0, ...din.fallback.rows] },
  };
}

const DIN_FONT = buildDin();
const SERIF_FONT = buildSerif(DIN_FONT);
const SPACING = 1;

function glyphOf(font: BitmapFont, ch: string): Glyph {
  const g = font.glyphs.get(ch);
  if (g) return g;
  if (ch === '\n' || ch === '\t' || ch === '\r') return font.glyphs.get(' ') ?? font.fallback;
  return font.fallback;
}

/**
 * Draw a single line of bitmap text at (x, y) = top-left. Returns the pixel
 * width actually drawn. `maxWidth` stops before the first glyph that would
 * overflow it.
 */
export function drawText(
  ctx2d: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  color: string,
  opts?: { serif?: boolean; maxWidth?: number },
): number {
  const font = opts?.serif ? SERIF_FONT : DIN_FONT;
  const maxWidth = opts?.maxWidth;
  const ox = Math.round(x);
  const oy = Math.round(y);
  ctx2d.fillStyle = color;
  let pen = 0;
  let drawn = 0;
  for (const ch of s) {
    const g = glyphOf(font, ch);
    if (maxWidth !== undefined && pen + g.w > maxWidth) break;
    for (let ry = 0; ry < g.rows.length; ry++) {
      let bits = g.rows[ry];
      let cx = 0;
      while (bits !== 0) {
        if (bits & 1) {
          let run = 1;
          while ((bits >> run) & 1) run++;
          ctx2d.fillRect(ox + pen + cx, oy + ry, run, 1);
          bits >>= run;
          cx += run;
        } else {
          bits >>= 1;
          cx += 1;
        }
      }
    }
    pen += g.w + SPACING;
    drawn++;
  }
  return drawn > 0 ? pen - SPACING : 0;
}

/** Pixel width of `s` in the given face (single line, no wrapping). */
export function measure(s: string, serif = false): number {
  const font = serif ? SERIF_FONT : DIN_FONT;
  let pen = 0;
  let count = 0;
  for (const ch of s) {
    pen += glyphOf(font, ch).w + SPACING;
    count++;
  }
  return count > 0 ? pen - SPACING : 0;
}
