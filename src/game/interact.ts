/**
 * Interaction (§7.0). Probe a short reach ahead of Wren's facing and resolve
 * the best target under a fixed priority: an active chore step first, then
 * people, then wrongness, then props, then doors and vehicles.
 */

import type { Ctx, NpcId, PropDef, Vec } from '../types';
import { TILE } from '../types';
import { npcAt } from './npc';
import { eventAt } from './manifest';
import { onInteractTarget, activeChore, currentStep } from '../systems/chores';
import { sleep } from '../systems/time';
import { toggleRadio } from '../systems/radio';
import { startTravel } from '../ui/travel';

export interface Interactable {
  kind: 'npc' | 'prop' | 'door' | 'chore' | 'event' | 'travel' | 'bed' | 'radio' | 'ledger';
  id: string;
  label: string;
  pos: Vec;
  data?: any;
}

const REACH = 14;

function probePoint(ctx: Ctx): Vec {
  const p = ctx.state.player.pos;
  const f = ctx.state.player.facing;
  const dx = f === 'left' ? -REACH : f === 'right' ? REACH : 0;
  const dy = f === 'up' ? -REACH : f === 'down' ? REACH : 0;
  return { x: p.x + dx, y: p.y + dy };
}

function evalLock(ctx: Ctx, locked: string): boolean {
  // returns true if LOCKED (blocked)
  if (locked.startsWith('flag:')) {
    return !ctx.state.flags[locked.slice(5)];
  }
  return !ctx.state.keys.includes(locked);
}

export function findInteractable(ctx: Ctx): Interactable | null {
  const s = ctx.state;
  const room = s.player.room;
  const probe = probePoint(ctx);
  const compiled = ctx.map.rooms[room];
  if (!compiled) return null;

  // 1. Active chore step target within reach.
  const chore = activeChore(ctx);
  if (chore) {
    const step = currentStep(ctx, chore);
    if (step) {
      const targets = [step.target, ...(step.targets ?? [])].filter(Boolean) as string[];
      for (const t of targets) {
        const a = compiled.anchors[t];
        if (a && dist(a, probe) < REACH + 8) {
          return { kind: 'chore', id: t, label: ctx.content.strings?.prompt_chore ?? 'Work', pos: a };
        }
        // also props whose id matches the target
        const prop = compiled.props.find((p) => p.id === t);
        if (prop && dist(propPos(prop), probe) < REACH + 8) {
          return { kind: 'chore', id: t, label: ctx.content.strings?.prompt_chore ?? 'Work', pos: propPos(prop) };
        }
      }
    }
  }

  // 2. NPC.
  const npc = npcAt(ctx, probe, REACH + 6);
  if (npc) {
    return { kind: 'npc', id: npc.id, label: ctx.content.strings?.prompt_talk ?? 'Talk', pos: npc.pos };
  }

  // 3. Wrongness event (examine).
  const ev = eventAt(ctx, probe, REACH + 4);
  if (ev) {
    return { kind: 'event', id: ev.id, label: ctx.content.strings?.prompt_look ?? 'Look', pos: ev.pos, data: ev };
  }

  // 4. Props with interact / special ids.
  let best: { prop: PropDef; d: number } | null = null;
  for (const prop of compiled.props) {
    const d = dist(propPos(prop), probe);
    if (d < REACH + 6 && (!best || d < best.d)) best = { prop, d };
  }
  if (best) {
    const prop = best.prop;
    if (prop.id === 'wren_radio' || prop.sprite === 'radio_set') {
      return { kind: 'radio', id: prop.id, label: ctx.content.strings?.prompt_radio ?? 'Radio', pos: propPos(prop) };
    }
    if (prop.sprite === 'bed' || prop.id === 'wren_bed') {
      return { kind: 'bed', id: prop.id, label: ctx.content.strings?.prompt_sleep ?? 'Sleep', pos: propPos(prop) };
    }
    if (prop.sprite === 'truck' || prop.id === 'truck') {
      return { kind: 'travel', id: prop.id, label: ctx.content.strings?.prompt_drive ?? 'Drive', pos: propPos(prop) };
    }
    if (prop.sprite === 'ledger_book' || prop.id === 'ledger_desk') {
      return { kind: 'ledger', id: prop.id, label: ctx.content.strings?.prompt_read ?? 'Read', pos: propPos(prop) };
    }
    if (prop.interact) {
      return { kind: 'prop', id: prop.id, label: ctx.content.strings?.prompt_look ?? 'Look', pos: propPos(prop), data: prop.interact };
    }
  }

  // 5. Doors.
  for (const door of compiled.doors) {
    if (pointInRect(probe, door.rect) || pointNearRect(s.player.pos, door.rect, TILE)) {
      const label = door.locked && evalLock(ctx, door.locked)
        ? ctx.content.strings?.prompt_locked ?? 'Locked'
        : ctx.content.strings?.prompt_enter ?? 'Enter';
      return { kind: 'door', id: door.to, label, pos: { x: door.rect.x, y: door.rect.y }, data: door };
    }
  }

  // 6. Travel anchors (a truck stop / the parked truck at home).
  return null;
}

export function doInteract(ctx: Ctx, it: Interactable): void {
  switch (it.kind) {
    case 'chore':
      onInteractTarget(ctx, it.id);
      return;
    case 'npc':
      ctx.ui.startDialogue({ npc: it.id as NpcId });
      return;
    case 'event': {
      const text = it.data?.def?.manifest?.text;
      if (text) ctx.ui.toast(text);
      else if (it.data) {
        // look up examine text on the def
        ctx.ui.toast(ctx.content.strings?.nothing_there ?? '…');
      }
      return;
    }
    case 'prop': {
      const inter = it.data as { node?: string; scene?: string; examine?: string };
      if (inter.node) ctx.ui.startDialogue({ node: inter.node });
      else if (inter.scene) ctx.ui.startScene(inter.scene);
      else if (inter.examine) ctx.ui.toast(inter.examine);
      return;
    }
    case 'door': {
      const door = it.data as { to: string; toAnchor: string; locked?: string };
      if (door.locked && evalLock(ctx, door.locked)) {
        ctx.ui.toast(ctx.content.strings?.door_locked ?? 'Locked.');
        return;
      }
      const dest = ctx.map.rooms[door.to as string];
      if (dest) {
        const a = dest.anchors[door.toAnchor];
        ctx.state.player.room = door.to;
        ctx.state.player.pos = a ? { x: a.x, y: a.y } : { x: dest.width * TILE / 2, y: dest.height * TILE / 2 };
        ctx.audio.cue('door');
      }
      return;
    }
    case 'radio':
      toggleRadio(ctx);
      return;
    case 'bed':
      sleep(ctx);
      return;
    case 'travel':
      startTravel(ctx);
      return;
    case 'ledger':
      ctx.ui.push('ledger');
      return;
  }
}

// ---------------------------------------------------------------------------
// geometry helpers
// ---------------------------------------------------------------------------

function propPos(p: PropDef): Vec {
  return { x: p.x * TILE + TILE / 2, y: p.y * TILE + TILE / 2 };
}
function dist(a: Vec, b: Vec): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}
function pointInRect(p: Vec, r: { x: number; y: number; w: number; h: number }): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}
function pointNearRect(p: Vec, r: { x: number; y: number; w: number; h: number }, pad: number): boolean {
  return p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
}
