/**
 * OFF-SEASON — sprite bank.
 *
 * Every sprite is authored here as a string grid. Characters map to palette
 * indices: '0'-'9' -> 0..9, 'a'-'f' -> 10..15, '.' -> transparent (255).
 * The renderer resolves those indices through the active per-day LUT palette,
 * so nothing in here hardcodes a colour — only indices into BASE_PALETTE.
 *
 * Grids are parsed lazily into a frame-major Uint8Array on first getSprite()
 * and cached. Rows shorter than the sprite width are padded with transparent
 * pixels; longer rows are truncated. That padding lets most art omit trailing
 * '.' runs, and keeps a miscounted row from ever crashing the game.
 *
 * Humanoids are composed from a handful of shared silhouette templates
 * (person / robe / hood / hat / cap / apron) recoloured per character via a
 * symbol->index map, so each NPC reads as a distinct chunky silhouette true
 * to the bible while staying cheap to maintain. Props and vehicles are
 * authored directly in index chars.
 *
 * Palette index cheat-sheet (see BASE_PALETTE in types.ts):
 *   0 outline/black  1 dark slate  2 mid gray   3 fog gray
 *   4 deep water     5 mid water   6 shallow    7 beach grass (mustard)
 *   8 sand (skin)    9 brick/brown 10 rust      11 hedge dark green
 *   12 marsh green   13 clapboard white         14 flag red  15 window light
 */

export interface Sprite {
  w: number;
  h: number;
  frames: number;
  /** palette idx per pixel, 255 = transparent, frame-major (frame 0 first). */
  data: Uint8Array;
}

interface GridDef {
  w: number;
  h: number;
  /** frames × rows of index-char strings ('0'-'f','.'). */
  frames: string[][];
}

const registry = new Map<string, GridDef>();
const cache = new Map<string, Sprite>();
const warned = new Set<string>();

function warnOnce(key: string, msg: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  if (typeof console !== 'undefined') console.warn(msg);
}

/** One grid char -> palette index (255 transparent). */
function idxChar(c: string): number {
  if (c === '.' || c === ' ') return 255;
  const code = c.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48; // '0'-'9'
  if (code >= 97 && code <= 102) return 10 + (code - 97); // 'a'-'f'
  return 255;
}

// ---------------------------------------------------------------------------
// Symbol recolouring for humanoid templates.
// ---------------------------------------------------------------------------

type ColorMap = Record<string, string>;

/** Structural symbols shared by every humanoid template. */
const STRUCT: ColorMap = { o: '0', E: '0' };

function mapChar(ch: string, map: ColorMap): string {
  if (ch === '.' || ch === ' ') return '.';
  const m = map[ch];
  if (m !== undefined) return m;
  // Allow literal palette chars to pass through (props reuse this path).
  if ((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f')) return ch;
  return '.';
}

function applyFrames(frames: string[][], map: ColorMap): string[][] {
  return frames.map((rows) =>
    rows.map((row) => {
      let out = '';
      for (const ch of row) out += mapChar(ch, map);
      return out;
    }),
  );
}

function padRow(s: string, w: number): string {
  if (s.length >= w) return s.slice(0, w);
  return s + '.'.repeat(w - s.length);
}

function mirrorFrames(frames: string[][], w: number): string[][] {
  return frames.map((rows) =>
    rows.map((row) => padRow(row, w).split('').reverse().join('')),
  );
}

function registerRaw(id: string, w: number, h: number, frames: string[][]): void {
  registry.set(id, { w, h, frames });
}

/** Recolour a symbolic template and register it. */
function registerSym(
  id: string,
  w: number,
  h: number,
  frames: string[][],
  colors: ColorMap,
): void {
  const map: ColorMap = { ...STRUCT, ...colors };
  registry.set(id, { w, h, frames: applyFrames(frames, map) });
}

// ---------------------------------------------------------------------------
// Humanoid templates (16×24). Symbols:
//   o outline  E eye  H hair  F face/skin  C coat  D coat-shadow
//   L legs/pants  B boots  A accent (collar/scarf/apron/hat)
// Frame differs only in the feet (rows 22-23) to read as a step.
// ---------------------------------------------------------------------------

const LEGS: string[] = [
  '....oLLLLLLo....',
  '....oLLLLLLo....',
  '....oLLooLLo....',
  '....oLLooLLo....',
  '....oLLooLLo....',
  '....oLLooLLo....',
];
const FEET_A: string[] = ['....oBBooLLo....', '....oBBoo..o....'];
const FEET_B: string[] = ['....oLLooBBo....', '....o..ooBBo....'];

const PERSON_TOP: string[] = [
  '................',
  '.....oooooo.....',
  '....oHHHHHHo....',
  '....oHFFFFHo....',
  '....oFFFFFFo....',
  '....oFEFFEFo....',
  '....oFFFFFFo....',
  '.....oFFFFo.....',
  '.....oAAAAo.....',
  '...ooCCCCCCoo...',
  '...oFCCCCCCFo...',
  '...oCCCCCCCCo...',
  '...oCCCCCCCCo...',
  '...oCCCCCCCCo...',
  '...oFCCCCCCFo...',
  '...oCCCCCCCCo...',
];

const APRON_TOP: string[] = [
  ...PERSON_TOP.slice(0, 11),
  '...oCAAAAAACo...',
  '...oCAAAAAACo...',
  '...oCAAAAAACo...',
  '...oFAAAAAAFo...',
  '...oCAAAAAACo...',
];

const HOOD_TOP: string[] = [
  '................',
  '....oCCCCCCo....',
  '...oCCCCCCCCo...',
  '...oCCFFFFCCo...',
  '...oCFFFFFFCo...',
  '...oCFEFFEFCo...',
  '...oCFFFFFFCo...',
  '...oCCFFFFCCo...',
  '.....oCCCCo.....',
  '...ooCCCCCCoo...',
  '...oFCCCCCCFo...',
  '...oCAACCAACo...',
  '...oCCCCCCCCo...',
  '...oCCCCCCCCo...',
  '...oFCCCCCCFo...',
  '...oCCCCCCCCo...',
];

const HAT_TOP: string[] = [
  '................',
  '....oAAAAAAo....',
  '...oAAAAAAAAo...',
  '..oAAAAAAAAAAo..',
  '...oHFFFFFFHo...',
  '....oFEFFEFo....',
  '....oFFFFFFo....',
  '.....oFFFFo.....',
  '.....oCCCCo.....',
  '...ooCCCCCCoo...',
  '...oFCCCCCCFo...',
  '...oCCCCCCCCo...',
  '...oCCCCCCCCo...',
  '...oCCCCCCCCo...',
  '...oFCCCCCCFo...',
  '...oCCCCCCCCo...',
];

const CAP_TOP: string[] = [
  '................',
  '....oAAAAAAo....',
  '...oAAAAAAAAo...',
  '...oHAAAAAAHo...',
  '....oHFFFFHo....',
  '....oFEFFEFo....',
  '....oFFFFFFo....',
  '.....oFFFFo.....',
  '.....oCCCCo.....',
  '...ooCCCCCCoo...',
  '...oFCCCCCCFo...',
  '...oCCCCCCCCo...',
  '...oCCCCCCCCo...',
  '...oCCCCCCCCo...',
  '...oFCCCCCCFo...',
  '...oCCCCCCCCo...',
];

const BACK_TOP: string[] = [
  '................',
  '.....oooooo.....',
  '....oHHHHHHo....',
  '....oHHHHHHo....',
  '....oHHHHHHo....',
  '....oHHHHHHo....',
  '....oHHHHHHo....',
  '.....oHHHHo.....',
  '.....oCCCCo.....',
  '...ooCCCCCCoo...',
  '...oFCCCCCCFo...',
  '...oCCCCCCCCo...',
  '...oCCCCCCCCo...',
  '...oCCCCCCCCo...',
  '...oFCCCCCCFo...',
  '...oCCCCCCCCo...',
];

/** Long-garment figure (cassock / bathrobe / long dress). */
const ROBE_F0: string[] = [
  '................',
  '.....oooooo.....',
  '....oHHHHHHo....',
  '....oHFFFFHo....',
  '....oFFFFFFo....',
  '....oFEFFEFo....',
  '....oFFFFFFo....',
  '.....oFFFFo.....',
  '.....oAAAAo.....',
  '...ooCCCCCCoo...',
  '...oFCCCCCCFo...',
  '...oCCCCCCCCo...',
  '...oCCCCCCCCo...',
  '...oCCCCCCCCo...',
  '...oFCCCCCCFo...',
  '...oCCCCCCCCo...',
  '...oCCCCCCCCo...',
  '...oCCCCCCCCo...',
  '..oCCCCCCCCCCo..',
  '..oCCCCCCCCCCo..',
  '..oCCCCCCCCCCo..',
  '..oCADDDDDDACo..',
  '..oooooooooooo..',
  '................',
];
const ROBE_F1: string[] = [
  ...ROBE_F0.slice(0, 20),
  '..oCCCCCCCCCCo..',
  '..oCDADADADACo..',
  '..oooooooooooo..',
  '................',
];

function twoFrame(top: string[]): string[][] {
  return [
    [...top, ...LEGS, ...FEET_A],
    [...top, ...LEGS, ...FEET_B],
  ];
}

// ---------------------------------------------------------------------------
// Character colour maps (indices as chars). Keys: H F C D L B A.
// ---------------------------------------------------------------------------

const C_JUNE: ColorMap = { H: '9', F: '8', C: '2', D: '1', L: '1', B: '0', A: '3' };
const C_MARGIE: ColorMap = { H: '3', F: '8', C: 'a', D: '9', L: '2', B: '0', A: 'd' };
const C_SAL: ColorMap = { H: '3', F: '8', C: '6', D: '5', L: '1', B: '0', A: 'd' };
const C_ROZ: ColorMap = { H: 'a', F: '8', C: 'e', D: '9', L: '1', B: '0', A: 'd' };
const C_PETEY: ColorMap = { H: '1', F: '8', C: '5', D: '4', L: '1', B: '0', A: '6' };
const C_EDITH: ColorMap = { H: '2', F: '8', C: '9', D: '1', L: '1', B: '0', A: 'b' };
const C_CUTTER: ColorMap = { H: '2', F: '8', C: '7', D: 'a', L: '1', B: '0', A: '7' };
const C_AMARAL: ColorMap = { H: '1', F: 'a', C: '1', D: '0', L: '0', B: '0', A: 'd' };
const C_GUS: ColorMap = { H: '3', F: '8', C: 'e', D: '9', L: '2', B: '0', A: '3' };
const C_ALMA: ColorMap = { H: 'd', F: '8', C: '5', D: '4', L: '2', B: '0', A: '3' };
const C_SECOND_GUS: ColorMap = { H: '3', F: '8', C: 'b', D: '1', L: '2', B: '0', A: '3' };
const C_HUTCH: ColorMap = { H: '2', F: '8', C: '9', D: '1', L: '1', B: '0', A: 'b' };
const C_WREN: ColorMap = { H: '1', F: '8', C: 'a', D: '9', L: '1', B: '0', A: 'd' };

// NPCs (16×24, 2 frames).
registerSym('npc_june', 16, 24, twoFrame(PERSON_TOP), C_JUNE);
registerSym('npc_margie', 16, 24, twoFrame(PERSON_TOP), C_MARGIE);
registerSym('npc_sal', 16, 24, [ROBE_F0, ROBE_F1], C_SAL);
registerSym('npc_roz', 16, 24, twoFrame(APRON_TOP), C_ROZ);
registerSym('npc_petey', 16, 24, twoFrame(HOOD_TOP), C_PETEY);
registerSym('npc_edith', 16, 24, [ROBE_F0, ROBE_F1], C_EDITH);
registerSym('npc_cutter', 16, 24, twoFrame(HAT_TOP), C_CUTTER);
registerSym('npc_amaral', 16, 24, [ROBE_F0, ROBE_F1], C_AMARAL);
registerSym('npc_gus', 16, 24, twoFrame(PERSON_TOP), C_GUS);
registerSym('npc_alma', 16, 24, twoFrame(PERSON_TOP), C_ALMA);
registerSym('npc_second_gus', 16, 24, twoFrame(PERSON_TOP), C_SECOND_GUS);
registerSym('npc_hutch', 16, 24, twoFrame(CAP_TOP), C_HUTCH);

// ---------------------------------------------------------------------------
// Player (16×24, 8 frames: d0 d1 u0 u1 l0 l1 r0 r1).
// ---------------------------------------------------------------------------

const SIDE_F0: string[] = [
  '................',
  '.....oooo',
  '....oHHHHo',
  '...oFFHHHo',
  '..oFFFHHHo',
  '..oFEFHHHo',
  '..oFFFHHHo',
  '...oFFHHo',
  '....oCCCo',
  '...oCCCCo',
  '..FoCCCCo',
  '..FoCCCCo',
  '...oCCCCo',
  '...oCCCCoF',
  '...oCCCCoF',
  '...oCCCCo',
  '...oLLLLo',
  '...oLLLLo',
  '...oLLLLo',
  '...oLLLLo',
  '..oLLoLLo',
  '..oLLoLLo',
  '..oBBoLLo',
  '..oBBooBBo',
];
const SIDE_F1: string[] = [
  '................',
  '.....oooo',
  '....oHHHHo',
  '...oFFHHHo',
  '..oFFFHHHo',
  '..oFEFHHHo',
  '..oFFFHHHo',
  '...oFFHHo',
  '....oCCCo',
  '...oCCCCo',
  '...oCCCCoF',
  '...oCCCCoF',
  '...oCCCCo',
  '..FoCCCCo',
  '..FoCCCCo',
  '...oCCCCo',
  '...oLLLLo',
  '...oLLLLo',
  '...oLLLLo',
  '...oLLLLo',
  '..oLLoLLo',
  '..oLLoLLo',
  '..oLLoBBo',
  '..oBBooBBo',
];

(function registerPlayer(): void {
  const front = applyFrames(twoFrame(PERSON_TOP), { ...STRUCT, ...C_WREN });
  const back = applyFrames(
    [
      [...BACK_TOP, ...LEGS, ...FEET_A],
      [...BACK_TOP, ...LEGS, ...FEET_B],
    ],
    { ...STRUCT, ...C_WREN },
  );
  const left = applyFrames([SIDE_F0, SIDE_F1], { ...STRUCT, ...C_WREN });
  const right = mirrorFrames(left, 16);
  registerRaw('player', 16, 24, [
    front[0],
    front[1],
    back[0],
    back[1],
    left[0],
    left[1],
    right[0],
    right[1],
  ]);
})();

// ---------------------------------------------------------------------------
// Cats (12×10, 2 frames). Symbols: C body, E eye, w muzzle/chest, P paws,
// T tail, o outline. Frame flicks the tail up.
// ---------------------------------------------------------------------------

const CAT_F0: string[] = [
  '............',
  '..o......o..',
  '.ooo....ooo.',
  '.oCCCCCCCCo.',
  '.oCECCCCECo.',
  '.oCCCwwCCCo.',
  '.oCCCCCCCCo.',
  '.oCCCCCCCCoT',
  '.oPPPPPPPPo.',
  '............',
];
const CAT_F1: string[] = [
  '............',
  '..o......o..',
  '.ooo....ooo.',
  '.oCCCCCCCCoT',
  '.oCECCCCECo.',
  '.oCCCwwCCCo.',
  '.oCCCCCCCCo.',
  '.oCCCCCCCCo.',
  '.oPPPPPPPPo.',
  '............',
];

registerSym('cat', 12, 10, [CAT_F0, CAT_F1], {
  o: '0',
  E: '0',
  C: 'a',
  w: '8',
  P: '8',
  T: 'a',
});
registerSym('cat_tuxedo', 12, 10, [CAT_F0, CAT_F1], {
  o: '0',
  E: 'f',
  C: '1',
  w: 'd',
  P: 'd',
  T: '1',
});

// ---------------------------------------------------------------------------
// Vehicles (authored directly in index chars).
// ---------------------------------------------------------------------------

registerRaw('truck', 32, 20, [
  [
    '................................',
    '................................',
    '................................',
    '................................',
    '....oooooooo',
    '...oaaaaaaaao',
    '...oa66666aao',
    '...oa66666aaooooooooooooooooo',
    '..oaaaaaaaaaaaaaaaaaaaaaaaaaao',
    '..oaaaaaaaaaaaaaaaaaaaaaaaaaao',
    '..oaaaaaaaaaaaaaaaaaaaaaaaaaao',
    '..oaaaaaaaaaaaaaaaaaaaaaaaaaao',
    '..o3aaaaaaaaaaaaaaaaaaaaaaaa3o',
    '..oooooooooooooooooooooooooooo',
    '.....o00000o......o00000o',
    '.....o02220o......o02220o',
    '.....o02220o......o02220o',
    '.....o00000o......o00000o',
    '......ooooo........ooooo',
    '................................',
  ],
]);

registerRaw('boat', 24, 14, [
  [
    '........................',
    '........................',
    '........................',
    '...oaaaaaaaaaaaaaaaao',
    '...o88888888888888o',
    '...o89999999999998o',
    '..o99999999999999999o',
    '..o99999999999999999o',
    '..o09999999999999990o',
    '...oo999999999999oo',
    '.....ooooooooooo',
    '........................',
    '........................',
    '........................',
  ],
]);

registerRaw('train', 48, 24, [
  [
    '................................................',
    '................................................',
    '................................................',
    '.oooooooooooooooooooooooooooooooooooooooooooooo',
    '.o22222222222222222222222222222222222222222222o',
    '.o33333333333333333333333333333333333333333333o',
    '.o33o6666o33o6666o33o6666o33o6666o33o6666o333o',
    '.o33o6666o33o6666o33o6666o33o6666o33o6666o333o',
    '.o33333333333333333333333333333333333333333333o',
    '.o55555555555555555555555555555555555555555555o',
    '.o33333333333333333333333333333333333333333333o',
    '.oooooooooooooooooooooooooooooooooooooooooooooo',
    '.....o00o..............o00o..............o00o',
    '....o0000o............o0000o............o0000o',
    '....o0000o............o0000o............o0000o',
    '.....o00o..............o00o..............o00o',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
  ],
]);

registerRaw('plow_truck', 32, 20, [
  [
    '................................',
    '................................',
    '................................',
    '.......oooooooo',
    '......o99999999o',
    '......o966669aao',
    '......o96666999oooooooooooo',
    '.....o99999999999999999999o',
    '..3..o99999999999999999999o',
    '.33.o999999999999999999999o',
    '333o9999999999999999999999o',
    '333o9999999999999999999999o',
    '.33.oooooooooooooooooooooooo',
    '..3..o00000o......o00000o',
    '.....o02220o......o02220o',
    '.....o02220o......o02220o',
    '.....o00000o......o00000o',
    '......ooooo........ooooo',
    '................................',
    '................................',
  ],
]);

// ---------------------------------------------------------------------------
// Props (16×16 unless noted). Authored in index chars.
// ---------------------------------------------------------------------------

function prop(id: string, rows: string[], w = 16, h = 16): void {
  registerRaw(id, w, h, [rows]);
}

prop('porch_chair', [
  '................',
  '................',
  '.....oooo.......',
  '.....o99o.......',
  '.....o99o.......',
  '.....o99o.......',
  '.....o99o.......',
  '.ooooo99o.......',
  '.o9999999o......',
  '.ooooooooo......',
  '.o9o...o9o......',
  '.o9o...o9o......',
  '.o9o...o9o......',
  '.ooo...ooo......',
  '................',
  '................',
]);

prop('flag_pole', [
  '..oo............',
  '..o2eeeeeo......',
  '..o2eeeeeeo.....',
  '..o2eeeeeo......',
  '..o2eeeo........',
  '..o2o...........',
  '..o2............',
  '..o2............',
  '..o2............',
  '..o2............',
  '..o2............',
  '..o2............',
  '..o2............',
  '.oo2oo..........',
  '.o222o..........',
  '.ooooo..........',
]);

prop('flag_folded', [
  '................',
  '................',
  '................',
  '................',
  '......o.........',
  '.....oeo........',
  '....oeeeo.......',
  '...oeedeo.......',
  '..oeeddeeo......',
  '.oeeddddeeo.....',
  'oeeddddddeeo....',
  'ooooooooooooo...',
  '................',
  '................',
  '................',
  '................',
]);

prop('buoy', [
  '................',
  '................',
  '.....oooo.......',
  '....oeeeeo......',
  '...oedddeo......',
  '...oeddddo......',
  '...oeeeeeo......',
  '...oedddeo......',
  '....oeeeo.......',
  '.....oo.........',
  '.....o1.........',
  '.....o1.........',
  '....oo1oo.......',
  '................',
  '................',
  '................',
]);

prop('dinghy', [
  '................',
  '................',
  '................',
  '................',
  '.....oooooo.....',
  '....o888888o....',
  '...o89999998o...',
  '...o89999998o...',
  '...o89999998o...',
  '....o888888o....',
  '.....oooooo.....',
  '................',
  '................',
  '................',
  '................',
  '................',
]);

prop('shutter', [
  '................',
  '................',
  '..oooooooo......',
  '..obbbbbbo......',
  '..obbbbbbo......',
  '..oooooooo......',
  '..obbbbbbo......',
  '..obbbbbbo......',
  '..oooooooo......',
  '..obbbbbbo......',
  '..obbbbbbo......',
  '..oooooooo......',
  '..obbbbbbo......',
  '..oooooooo......',
  '................',
  '................',
]);

prop('valve', [
  '................',
  '................',
  '................',
  '.....oo.........',
  '....o22o........',
  '...o2oo2o.......',
  '..o2o..o2o......',
  '..o2o..o2o......',
  '..o2o..o2o......',
  '...o2oo2o.......',
  '....o22o........',
  '.....99.........',
  '....o99o........',
  '...o9999o.......',
  '...o9999o.......',
  '...oooooo.......',
]);

prop('meter', [
  '................',
  '................',
  '..oooooooo......',
  '..o333333o......',
  '..o366663o......',
  '..o360063o......',
  '..o360063o......',
  '..o366663o......',
  '..o333333o......',
  '..o300003o......',
  '..o333333o......',
  '..oooooooo......',
  '....o..o........',
  '....o..o........',
  '....oooo........',
  '................',
]);

prop('door_boarded', [
  '................',
  '..ooooooooo.....',
  '..o9999999o.....',
  '..oaaaaaaao.....',
  '..o9999999o.....',
  '..o9999999o.....',
  '..oaaaaaaao.....',
  '..o9999999o.....',
  '..o9999999o.....',
  '..oaaaaaaao.....',
  '..o9999999o.....',
  '..o9999999o.....',
  '..o9999999o.....',
  '..ooooooooo.....',
  '................',
  '................',
]);

prop('lantern_small', [
  '................',
  '................',
  '.....o2o........',
  '.....o2o........',
  '....ooooo.......',
  '....o000o.......',
  '...o0fff0o......',
  '...offffffo.....',
  '...offffffo.....',
  '...offffffo.....',
  '...o0fff0o......',
  '....o000o.......',
  '....ooooo.......',
  '................',
  '................',
  '................',
]);

prop('mailbox', [
  '................',
  '................',
  '................',
  '...ooooooo......',
  '..o5555555o.....',
  '..o5555555o.....',
  '..o5555555e.....',
  '..o5555555o.....',
  '..ooooooooo.....',
  '.....o9o........',
  '.....o9o........',
  '.....o9o........',
  '.....o9o........',
  '....ooooo.......',
  '................',
  '................',
]);

prop('hydrangea', [
  '................',
  '................',
  '................',
  '....6666........',
  '...666666.......',
  '..66b66b66......',
  '..66666666......',
  '..bb6666bb......',
  '...bbbbbb.......',
  '....bbbb........',
  '.....bb.........',
  '.....11.........',
  '.....11.........',
  '................',
  '................',
  '................',
]);

prop('hydrangea_brown', [
  '................',
  '................',
  '................',
  '....9999........',
  '...999999.......',
  '..99199199......',
  '..99999999......',
  '..11999911......',
  '...111111.......',
  '....1111........',
  '.....11.........',
  '.....11.........',
  '.....11.........',
  '................',
  '................',
  '................',
]);

prop('gull', [
  '................',
  '................',
  '................',
  '................',
  '............oo..',
  '...........od7..',
  '..oddddddddddo..',
  '.o22dddddddd2o..',
  '.o2dddddddddd2o.',
  '..o2222dddddo...',
  '...oddddddo.....',
  '.....o..o.......',
  '................',
  '................',
  '................',
  '................',
]);

prop('phone_booth', [
  '................',
  '..oooooooo......',
  '..o555555o......',
  '..o566665o......',
  '..o566665o......',
  '..o566665o......',
  '..o5o66o5o......',
  '..o566665o......',
  '..o566665o......',
  '..o566665o......',
  '..o555555o......',
  '..o511115o......',
  '..oooooooo......',
  '................',
  '................',
  '................',
]);

prop('bench', [
  '................',
  '................',
  '................',
  '................',
  '................',
  '.oooooooooooo...',
  '.o9999999999o...',
  '.oooooooooooo...',
  '................',
  '.oooooooooooo...',
  '.o9999999999o...',
  '.o1o......o1o...',
  '.o1o......o1o...',
  '.ooo......ooo...',
  '................',
  '................',
]);

prop('telescope', [
  '................',
  '................',
  '.........o6.....',
  '........o22.....',
  '.......o22o.....',
  '......o22o......',
  '.....o22o.......',
  '....o22o........',
  '...o22o.........',
  '..o22o..........',
  '...1.1..........',
  '..1...1.........',
  '.1.....1........',
  'o.......o.......',
  '................',
  '................',
]);

prop('coffee_cup', [
  '................',
  '................',
  '....3.3.........',
  '...3.3..........',
  '....3...........',
  '..oooooo........',
  '..o2222o........',
  '..oddddo........',
  '..oaaaao........',
  '..oaaaao........',
  '..oddddo........',
  '...oddo.........',
  '...ooo..........',
  '................',
  '................',
  '................',
]);

prop('ledger_book', [
  '................',
  '................',
  '................',
  '..ooooooooooo...',
  '..o999999999o...',
  '..o9ddddddd9o...',
  '..o9ddddddd9o...',
  '..o9d22222d9o...',
  '..o9ddddddd9o...',
  '..o9d22222d9o...',
  '..o9ddddddd9o...',
  '..o999999999o...',
  '..ooooooooooo...',
  '................',
  '................',
  '................',
]);

prop('lighthouse_lamp', [
  '................',
  '.....oooo.......',
  '....o2222o......',
  '....oooooo......',
  '...offfffo......',
  'eeofffffffoee...',
  'eeoffffffffoee..',
  'eeofffffffoee...',
  '...offfffo......',
  '....oooooo......',
  '....o2222o......',
  '....o2222o......',
  '...oooooooo.....',
  '................',
  '................',
  '................',
]);

prop(
  'sign_town',
  [
    '........................',
    '..oooooooooooooooo......',
    '..obbbbbbbbbbbbbbo......',
    '..obddddddddddddbo......',
    '..obbbbbbbbbbbbbbo......',
    '..obdddddddddddbbo......',
    '..obbbbbbbbbbbbbbo......',
    '..obddddddbbbbbbbo......',
    '..obbbbbbbbbbbbbbo......',
    '..oooooooooooooooo......',
    '.....o22o..o22o.........',
    '.....o22o..o22o.........',
    '.....o22o..o22o.........',
    '.....o22o..o22o.........',
    '.....o22o..o22o.........',
    '....oooooooooooo........',
  ],
  24,
  16,
);

prop('casserole', [
  '................',
  '................',
  '................',
  '................',
  '.....o13o.......',
  '..ooooooooo.....',
  '..oddddddddo....',
  '..oooooooooo....',
  '..o33aaaa33o....',
  '..o3aaaaaa3o....',
  '..o33333333o....',
  '..oooooooooo....',
  '................',
  '................',
  '................',
  '................',
]);

prop('key', [
  '................',
  '................',
  '................',
  '...ooo..........',
  '..o7o7o.........',
  '..o7.7o.........',
  '..o7o7o.........',
  '...o7o..........',
  '...o7o..........',
  '...o7o..........',
  '...o77o.........',
  '...o7o..........',
  '...o77o.........',
  '...ooo..........',
  '................',
  '................',
]);

prop('papers', [
  '................',
  '................',
  '................',
  '...ooooooooo....',
  '...odddddddo....',
  '...od22222do....',
  '...odddddddo....',
  '...od2222edo....',
  '...od22222do....',
  '...odddddddo....',
  '...od22222do....',
  '...odddddddo....',
  '...ooooooooo....',
  '................',
  '................',
  '................',
]);

prop('radio_set', [
  '................',
  '................',
  '.........2......',
  '........2.......',
  '.......2........',
  '..ooooooooo.....',
  '..o1111111o.....',
  '..o1662221o.....',
  '..o1662221o.....',
  '..o1112221o.....',
  '..o1111111o.....',
  '..ooooooooo.....',
  '................',
  '................',
  '................',
  '................',
]);

prop('stove', [
  '................',
  '................',
  '..oooooooo......',
  '..o233332o......',
  '..o222222o......',
  '..o2o00o2o......',
  '..o2o00o2o......',
  '..o222222o......',
  '..o299992o......',
  '..o299992o......',
  '..o233332o......',
  '..o222222o......',
  '..oo....oo......',
  '................',
  '................',
  '................',
]);

prop('bed', [
  '................',
  '................',
  '..ooooooooo.....',
  '..o9ddddd9o.....',
  '..o9ddddd9o.....',
  '..o9555559o.....',
  '..o9555559o.....',
  '..o9555559o.....',
  '..o9555559o.....',
  '..o9555559o.....',
  '..o9555559o.....',
  '..ooooooooo.....',
  '................',
  '................',
  '................',
  '................',
]);

prop('table', [
  '................',
  '................',
  '................',
  '..ooooooooooo...',
  '..oaaaaaaaaao...',
  '..oa9999999ao...',
  '..oa9099909ao...',
  '..oa9999999ao...',
  '..oa9099909ao...',
  '..oa9999999ao...',
  '..oaaaaaaaaao...',
  '..ooooooooooo...',
  '................',
  '................',
  '................',
  '................',
]);

prop('counter', [
  '................',
  '................',
  '................',
  '................',
  '.oooooooooooooo.',
  '.o999999999999o.',
  '.o333333333333o.',
  '.o222222222222o.',
  '.o222222222222o.',
  '.o222222222222o.',
  '.o222222222222o.',
  '.oooooooooooooo.',
  '................',
  '................',
  '................',
  '................',
]);

prop('shelf', [
  '................',
  '..oooooooooo....',
  '..o99999999o....',
  '..oe5577e59o....',
  '..oe5577e59o....',
  '..o99999999o....',
  '..o755ee579o....',
  '..o755ee579o....',
  '..o99999999o....',
  '..o5e77e559o....',
  '..o5e77e559o....',
  '..oooooooooo....',
  '................',
  '................',
  '................',
  '................',
]);

prop('pew', [
  '................',
  '................',
  '................',
  '................',
  '................',
  '.oooooooooooo...',
  '.o9999999999o...',
  '.oooooooooooo...',
  '................',
  '.oooooooooooo...',
  '.o9999999999o...',
  '.o9o......o9o...',
  '.o9o......o9o...',
  '.ooo......ooo...',
  '................',
  '................',
]);

prop('altar', [
  '................',
  '......o0o.......',
  '......o0o.......',
  '....o00000o.....',
  '......o0o.......',
  '......o0o.......',
  '..ooooooooooo...',
  '..oddddddddddo..',
  '..od77777777do..',
  '..oddddddddddo..',
  '..oddddddddddo..',
  '..oddddddddddo..',
  '..ooooooooooo...',
  '................',
  '................',
  '................',
]);

prop('plaque', [
  '................',
  '................',
  '................',
  '..oooooooooo....',
  '..o99999999o....',
  '..o9aaaaaa9o....',
  '..o9a0000a9o....',
  '..o9aaaaaa9o....',
  '..o9a0000a9o....',
  '..o9aaaaaa9o....',
  '..o99999999o....',
  '..oooooooooo....',
  '................',
  '................',
  '................',
  '................',
]);

prop('winch', [
  '................',
  '................',
  '................',
  '..o......o......',
  '..o.o11o.o......',
  '..ooo22ooo......',
  '..o222222o......',
  '..o288882o......',
  '..o288882o......',
  '..o222222o......',
  '..ooo22ooo......',
  '....o11o........',
  '.....11.........',
  '................',
  '................',
  '................',
]);

prop('chain', [
  '................',
  '................',
  '................',
  '................',
  '................',
  '.o2o..o2o..o2o..',
  'o2o2oo2o2oo2o2o.',
  'o2o2oo2o2oo2o2o.',
  '.o2o..o2o..o2o..',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
]);

prop('gate', [
  '................',
  '................',
  '.oooooooooooooo.',
  '.o1o2o2o2o2o1o..',
  '.o1o2o2o2o2o1o..',
  '.o1o2o2o2o2o1o..',
  '.o1o2o2o2o2o1o..',
  '.o1o2o2o2o2o1o..',
  '.o1o2o2o2o2o1o..',
  '.o1o2o2o2o2o1o..',
  '.o1o2o2o2o2o1o..',
  '.oooooooooooooo.',
  '................',
  '................',
  '................',
  '................',
]);

prop('padlock', [
  '................',
  '................',
  '................',
  '....oooo........',
  '...o2oo2o.......',
  '...o2oo2o.......',
  '..oooooooo......',
  '..o777777o......',
  '..o770077o......',
  '..o770077o......',
  '..o777777o......',
  '..o777777o......',
  '..oooooooo......',
  '................',
  '................',
  '................',
]);

prop('pool_valve', [
  '................',
  '................',
  '................',
  '.....oo.........',
  '....oeeo........',
  '...oeooeo.......',
  '..oeo..oeo......',
  '..oeo..oeo......',
  '..oeo..oeo......',
  '...oeooeo.......',
  '....oeeo........',
  '.....22.........',
  '....o22o........',
  '...o2222o.......',
  '...o2222o.......',
  '...oooooo.......',
]);

prop('tape_note', [
  '................',
  '................',
  '................',
  '................',
  '................',
  '.oooooooooooo...',
  '.o8888888888o...',
  '.o82.2.2.288o...',
  '.o8888888888o...',
  '.o82.2.2.288o...',
  '.o8888888888o...',
  '.oooooooooooo...',
  '................',
  '................',
  '................',
  '................',
]);

prop('lamp_post', [
  '................',
  '....ooo.........',
  '...o2f2o........',
  '...offfo........',
  '...o2f2o........',
  '....o1o.........',
  '....o1o.........',
  '....o1o.........',
  '....o1o.........',
  '....o1o.........',
  '....o1o.........',
  '....o1o.........',
  '....o1o.........',
  '...ooooo........',
  '..o11111o.......',
  '..ooooooo.......',
]);

prop('lamp_post_off', [
  '................',
  '....ooo.........',
  '...o212o........',
  '...o222o........',
  '...o212o........',
  '....o1o.........',
  '....o1o.........',
  '....o1o.........',
  '....o1o.........',
  '....o1o.........',
  '....o1o.........',
  '....o1o.........',
  '....o1o.........',
  '...ooooo........',
  '..o11111o.......',
  '..ooooooo.......',
]);

prop('cottage_light', [
  '................',
  '................',
  '..oooooooo......',
  '..o999999o......',
  '..offffffo......',
  '..offffffo......',
  '..o999999o......',
  '..offffffo......',
  '..offffffo......',
  '..o999999o......',
  '..offffffo......',
  '..offffffo......',
  '..oddddddo......',
  '..oooooooo......',
  '................',
  '................',
]);

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

/** Parse a registered grid def into a frame-major Uint8Array Sprite. */
function build(def: GridDef): Sprite {
  const { w, h, frames } = def;
  const nFrames = Math.max(1, frames.length);
  const per = w * h;
  const data = new Uint8Array(per * nFrames);
  data.fill(255);
  for (let f = 0; f < nFrames; f++) {
    const rows = frames[f] ?? [];
    const base = f * per;
    for (let y = 0; y < h; y++) {
      const row = rows[y] ?? '';
      for (let x = 0; x < w; x++) {
        data[base + y * w + x] = idxChar(row[x] ?? '.');
      }
    }
  }
  return { w, h, frames: nFrames, data };
}

/** Lazily parse (and cache) the sprite for `id`, or null if unknown. */
export function getSprite(id: string): Sprite | null {
  const hit = cache.get(id);
  if (hit) return hit;
  const def = registry.get(id);
  if (!def) {
    warnOnce(`missing:${id}`, `[sprites] unknown sprite id '${id}'`);
    return null;
  }
  const spr = build(def);
  cache.set(id, spr);
  return spr;
}

/** Every registered sprite id (stable insertion order). */
export function spriteIds(): string[] {
  return Array.from(registry.keys());
}
