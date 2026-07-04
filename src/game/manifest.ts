/**
 * Wrongness manifestation layer (design bible §7.3). The director
 * (systems/director.ts) decides *what* is wrong and *when*; this module makes
 * the active events felt in the running world — always subtractively, never a
 * monster on screen (bible §0.6). It renders the visual manifestations, exposes
 * the removals/lights game.ts folds into its own passes, and drives the audio
 * side of events.
 *
 * game.ts consults, per event kind:
 *   prop_add / prop_swap → drawEvents draws the sprite at the anchor
 *   prop_remove          → suppressedProps(): prop ids to skip drawing
 *   light_toggle         → eventLights(): extra window-light holes for night
 *   ambient_mute         → mutedStems() / applyAudioEvents(): local stem death
 *   audio_cue            → applyAudioEvents(): a positional cue, once, on
 *                          activation
 *
 * No narrative text lives here: an event's examine string is in its manifest
 * (content); game/interact.ts shows it after eventAt() finds the event.
 */

import { TILE } from '../types';
import type { ActiveEvent, Camera, Ctx, Renderer, Vec, WrongnessEventDef } from '../types';
import { zoneAt } from '../engine/map';
import { getSprite } from '../engine/sprites';
import { eventDefById } from '../systems/director';

/** Radius (px) of the soft light hole a lit-window wrongness punches at night. */
const EVENT_LIGHT_RADIUS = 42;

function defOf(ctx: Ctx, ev: ActiveEvent): WrongnessEventDef | null {
  return eventDefById(ctx, ev.id);
}

function zoneKeyOf(ctx: Ctx, ev: ActiveEvent): string {
  if (ev.room !== 'town') return ev.room;
  return zoneAt(ctx.map, 'town', ev.pos) ?? 'town';
}

function playerZone(ctx: Ctx): string {
  const z = ctx.state.flags.cur_zone;
  return typeof z === 'string' ? z : ctx.state.player.room;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Draw the visual manifestations of active events in the player's room. Only
 *  prop_add / prop_swap draw a sprite; every other kind is felt, not seen. */
export function drawEvents(ctx: Ctx, r: Renderer, _cam: Camera): void {
  const room = ctx.state.player.room;
  for (const ev of ctx.state.activeEvents) {
    if (!ev.active || ev.room !== room) continue;
    const def = defOf(ctx, ev);
    if (!def) continue;
    const kind = def.manifest?.kind;
    if (kind !== 'prop_add' && kind !== 'prop_swap') continue;

    const spriteId = def.manifest.prop;
    if (!spriteId) continue;

    const spr = getSprite(spriteId);
    const w = spr ? spr.w : TILE;
    const h = spr ? spr.h : TILE;
    // Centre horizontally on the anchor, stand the prop on the anchor tile.
    const wx = ev.pos.x - w / 2;
    const wy = ev.pos.y + TILE / 2 - h;
    r.drawSprite(spriteId, wx, wy, { frame: 0 });
  }
}

// ---------------------------------------------------------------------------
// Removals & lights (game.ts folds these into its own passes)
// ---------------------------------------------------------------------------

/** Prop ids that active prop_remove events currently blank out. game.ts skips
 *  drawing any map prop whose id is in this set. */
export function suppressedProps(ctx: Ctx): Set<string> {
  const set = new Set<string>();
  for (const ev of ctx.state.activeEvents) {
    if (!ev.active) continue;
    const def = defOf(ctx, ev);
    if (!def || def.manifest?.kind !== 'prop_remove') continue;
    const id = def.manifest.prop ?? ev.anchor;
    if (id) set.add(id);
  }
  return set;
}

/** Extra window-light holes contributed by active light_toggle events in the
 *  player's room, in world pixels — appended to the renderer's night overlay. */
export function eventLights(ctx: Ctx): { x: number; y: number; r: number }[] {
  const room = ctx.state.player.room;
  const out: { x: number; y: number; r: number }[] = [];
  for (const ev of ctx.state.activeEvents) {
    if (!ev.active || ev.room !== room) continue;
    const def = defOf(ctx, ev);
    if (!def || def.manifest?.kind !== 'light_toggle') continue;
    out.push({ x: ev.pos.x, y: ev.pos.y, r: EVENT_LIGHT_RADIUS });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

/** Stems that active ambient_mute events kill in the player's current zone. */
export function mutedStems(ctx: Ctx): Set<string> {
  const set = new Set<string>();
  const pz = playerZone(ctx);
  for (const ev of ctx.state.activeEvents) {
    if (!ev.active) continue;
    const def = defOf(ctx, ev);
    if (!def || def.manifest?.kind !== 'ambient_mute') continue;
    if (zoneKeyOf(ctx, ev) !== pz) continue;
    const stem = def.manifest.sound;
    if (stem) set.add(stem);
  }
  return set;
}

// Fire each event's audio_cue exactly once, when it activates. Keyed by the
// ActiveEvent object; planDay mints fresh objects each day so cues re-arm.
const firedCues = new WeakSet<ActiveEvent>();

/** Drive the audio side of active events. Call after game.ts's day-mix pass so
 *  local mutes win over the scheduled stem levels. */
export function applyAudioEvents(ctx: Ctx): void {
  const player = ctx.state.player;
  for (const ev of ctx.state.activeEvents) {
    if (!ev.active) continue;
    const def = defOf(ctx, ev);
    if (!def) continue;
    const man = def.manifest;
    if (!man) continue;

    if (man.kind === 'audio_cue') {
      if (firedCues.has(ev)) continue;
      firedCues.add(ev);
      if (man.sound) {
        const sameRoom = ev.room === player.room;
        const pan = sameRoom
          ? Math.max(-1, Math.min(1, (ev.pos.x - player.pos.x) / (TILE * 10)))
          : 0;
        ctx.audio.cue(man.sound, { pan });
      }
    } else if (man.kind === 'ambient_mute') {
      if (zoneKeyOf(ctx, ev) !== playerZone(ctx)) continue;
      if (man.sound) ctx.audio.setStem(man.sound, 0);
    }
  }
}

// ---------------------------------------------------------------------------
// Examine
// ---------------------------------------------------------------------------

/** Nearest active event to `pos` within `radius`, in the player's room — for
 *  game/interact.ts's examine (which reads the manifest's examine text). */
export function eventAt(ctx: Ctx, pos: Vec, radius: number): ActiveEvent | null {
  const room = ctx.state.player.room;
  let best: ActiveEvent | null = null;
  let bestD = radius;
  for (const ev of ctx.state.activeEvents) {
    if (!ev.active || ev.room !== room) continue;
    const d = Math.hypot(ev.pos.x - pos.x, ev.pos.y - pos.y);
    if (d <= bestD) {
      bestD = d;
      best = ev;
    }
  }
  return best;
}
