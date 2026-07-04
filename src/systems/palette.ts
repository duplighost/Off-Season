/**
 * Palette decay (§7.6) and fog density (§10).
 *
 * Day 1 is postcard September; Day 9 is a photograph of a photograph.
 * Per day elapsed: saturation ×0.96 compounding, hue eased toward cold
 * slate-blue ~1.5°/day, and the lightness floor lifts ~0.6%/day (fog floor —
 * blacks are never quite black again). Disruption debt drags the palette a
 * day ahead per 3 points, same rule the audio mix uses.
 *
 * Pure, deterministic functions — no state, no rng.
 */

import { BASE_PALETTE, FOG_LEAD_MIN, SUNSET_MIN } from '../types';
import type { GameState } from '../types';

/** Target hue the town cools toward (cold slate-blue). */
const COLD_HUE = 215;
const SAT_DECAY = 0.96;
const HUE_PER_DAY = 1.5;
const LIFT_PER_DAY = 0.006;
/** Fog never fully whites out the screen. */
const MAX_FOG = 0.85;
/** Minutes the fog front takes to roll in ahead of (perceived) dusk. */
const FOG_RAMP_MIN = 45;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  if (Number.isNaN(n)) return [0, 0, 0];
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** h in degrees [0,360), s/l in [0,1]. */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h * 60, s, l];
}

function hue2rgb(p: number, q: number, t: number): number {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s <= 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hn = (((h % 360) + 360) % 360) / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, hn + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, hn) * 255),
    Math.round(hue2rgb(p, q, hn - 1 / 3) * 255),
  ];
}

/**
 * The 16-color palette for a given day (1-based) and disruption debt.
 * Day 1 with no debt returns the base palette verbatim.
 */
export function paletteForDay(day: number, disruptionDebt: number): string[] {
  const d = clamp(day, 1, 12);
  const debtSteps = Math.min(3, Math.max(0, disruptionDebt) / 3);
  const steps = clamp(d - 1 + debtSteps, 0, 11);
  if (steps === 0) return [...BASE_PALETTE];

  const satMul = Math.pow(SAT_DECAY, steps);
  const hueShiftMax = HUE_PER_DAY * steps;
  const floorLift = Math.min(0.08, LIFT_PER_DAY * steps);

  return BASE_PALETTE.map((hex) => {
    const [r, g, b] = hexToRgb(hex);
    let [h, s, l] = rgbToHsl(r, g, b);
    s = clamp(s * satMul, 0, 1);
    // Ease toward the cold hue along the shortest arc, never overshooting.
    const delta = ((COLD_HUE - h + 540) % 360) - 180;
    h += Math.sign(delta) * Math.min(Math.abs(delta), hueShiftMax);
    // Lift the floor: blacks rise by the fog floor, whites stay put.
    l = clamp(floorLift + l * (1 - floorLift), 0, 1);
    const [nr, ng, nb] = hslToRgb(h, s, l);
    return rgbToHex(nr, ng, nb);
  });
}

/**
 * Fog density 0..1 for the current state. Ambient haze grows with the day;
 * a fog front rolls in FOG_LEAD_MIN[day] minutes ahead of sunset (perceived
 * dusk arrives earlier each day) and holds through the night. Disruption
 * debt — global plus the optional zone-local share — thickens everything.
 * Reads only day, clockMin and disruptionDebt from state.
 */
export function fogDensity(state: GameState, zoneDebt = 0): number {
  const day = clamp(Math.round(state.day), 1, 9);
  const sunset = SUNSET_MIN[day];
  const lead = FOG_LEAD_MIN[day];

  const ambient = 0.02 * (day - 1);

  const rampStart = sunset - lead - FOG_RAMP_MIN;
  const t = clamp((state.clockMin - rampStart) / (sunset - rampStart), 0, 1);
  const duskMax = 0.22 + 0.04 * (day - 1);

  const debt = Math.max(0, state.disruptionDebt) + Math.max(0, zoneDebt);
  const debtTerm = Math.min(0.25, 0.025 * debt);

  return clamp(ambient + t * duskMax + debtTerm, 0, MAX_FOG);
}
