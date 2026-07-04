/**
 * Content validator (§9). Zero dependencies. Loads every JSON under /content
 * and cross-checks references so a dangling goto / missing anchor / unknown
 * tag is caught before it ships. Tolerates placeholder empty content.
 *
 * Usage:  node tools/validate-content.mjs        (CLI, exits 1 on problems)
 *         import { validateContent } from '...'   (returns string[])
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KNOWN_TAGS = new Set(['visual', 'audio', 'npc', 'spatial', 'animal']);
const KNOWN_MANIFEST_KINDS = new Set([
  'prop_add', 'prop_remove', 'prop_swap', 'light_toggle', 'audio_cue', 'npc_deviation', 'ambient_mute',
]);

function readJson(path, problems) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    problems.push(`${path}: invalid JSON — ${e.message}`);
    return null;
  }
}

export function validateContent(rootDir) {
  const problems = [];
  const C = join(rootDir, 'content');
  if (!existsSync(C)) {
    problems.push(`content/ directory not found at ${C}`);
    return problems;
  }

  // --- map: gather anchors, rooms, doors -----------------------------------
  const anchors = new Set();
  const rooms = new Set(['town']);
  const mapPath = join(C, 'map', 'town.json');
  let map = null;
  if (existsSync(mapPath)) {
    map = readJson(mapPath, problems);
    if (map) {
      for (const name of Object.keys(map.anchors ?? {})) anchors.add(name);
      for (const rd of map.rooms ?? []) {
        if (rd?.id) {
          rooms.add(rd.id);
          for (const a of Object.keys(rd.anchors ?? {})) anchors.add(a);
        }
      }
      // building doors imply reachable rooms
      for (const b of map.buildings ?? []) {
        if (b.door?.to) rooms.add(b.door.to);
      }
    }
  } else {
    problems.push('content/map/town.json not found');
  }

  // --- dialogue ------------------------------------------------------------
  const nodeIds = new Set();
  const barkPools = new Set();
  const dialogueFiles = [];
  const dlgDir = join(C, 'dialogue');
  if (existsSync(dlgDir)) {
    for (const f of readdirSync(dlgDir).filter((n) => n.endsWith('.json'))) {
      const data = readJson(join(dlgDir, f), problems);
      if (!data) continue;
      dialogueFiles.push({ f, data });
      for (const n of data.nodes ?? []) {
        if (!n.id) problems.push(`dialogue/${f}: a node is missing 'id'`);
        else if (nodeIds.has(n.id)) problems.push(`dialogue/${f}: duplicate node id '${n.id}'`);
        else nodeIds.add(n.id);
      }
      for (const p of data.barkPools ?? []) if (p.id) barkPools.add(p.id);
    }
  }

  // --- radio ---------------------------------------------------------------
  const songIds = new Set();
  const radioPath = join(C, 'radio', 'radio.json');
  let radio = null;
  if (existsSync(radioPath)) {
    radio = readJson(radioPath, problems);
    if (radio) {
      for (const s of radio.songs ?? []) if (s.id) songIds.add(s.id);
    }
  }

  // --- story: scenes + beats ----------------------------------------------
  const sceneIds = new Set();
  const storyPath = join(C, 'story', 'story.json');
  let story = null;
  if (existsSync(storyPath)) {
    story = readJson(storyPath, problems);
    if (story) for (const sc of story.scenes ?? []) if (sc.id) sceneIds.add(sc.id);
  }

  // --- chores --------------------------------------------------------------
  const chorePath = join(C, 'chores', 'chores.json');
  let chores = null;
  if (existsSync(chorePath)) chores = readJson(chorePath, problems);

  // --- schedules -----------------------------------------------------------
  const schedPath = join(C, 'schedules', 'schedules.json');
  let sched = null;
  if (existsSync(schedPath)) sched = readJson(schedPath, problems);

  // --- events --------------------------------------------------------------
  const evPath = join(C, 'events', 'events.json');
  let events = null;
  if (existsSync(evPath)) events = readJson(evPath, problems);

  // Helper: does a scene id exist? (allow ending.* by convention)
  const sceneExists = (id) => sceneIds.has(id);

  // === cross-reference dialogue ===
  for (const { f, data } of dialogueFiles) {
    for (const n of data.nodes ?? []) {
      const at = `dialogue/${f} node '${n.id}'`;
      if (n.goto && n.goto !== null && !nodeIds.has(n.goto)) {
        problems.push(`${at}: goto '${n.goto}' does not resolve`);
      }
      for (const ch of n.choices ?? []) {
        if (ch.goto && !nodeIds.has(ch.goto)) {
          problems.push(`${at}: choice goto '${ch.goto}' does not resolve`);
        }
        checkEffects(ch.effects, `${at} choice`, sceneExists, chores, problems);
      }
      checkEffects(n.effects, at, sceneExists, chores, problems);
    }
  }

  // === schedules: anchors + rooms + barkpools ===
  for (const s of sched?.schedules ?? []) {
    const at = `schedules: npc '${s.npc}'`;
    for (const slot of s.slots ?? []) {
      if (slot.room && !rooms.has(slot.room)) problems.push(`${at}: unknown room '${slot.room}'`);
      if (slot.anchor && anchors.size && !anchors.has(slot.anchor)) {
        problems.push(`${at}: unknown anchor '${slot.anchor}'`);
      }
      if (slot.barkPool && barkPools.size && !barkPools.has(slot.barkPool)) {
        problems.push(`${at}: unknown barkPool '${slot.barkPool}'`);
      }
      if (slot.talkNode && !nodeIds.has(slot.talkNode)) {
        problems.push(`${at}: unknown talkNode '${slot.talkNode}'`);
      }
    }
  }

  // === chores: anchors, day coverage, targets ===
  const daysCovered = new Set();
  for (const c of chores?.chores ?? []) {
    const at = `chores: '${c.id}'`;
    if (typeof c.day === 'number') daysCovered.add(c.day);
    if (c.room && !rooms.has(c.room)) problems.push(`${at}: unknown room '${c.room}'`);
    for (const step of c.steps ?? []) {
      const targets = [step.target, ...(step.targets ?? []), ...(step.correctOrder ?? [])].filter(Boolean);
      for (const t of targets) {
        if (anchors.size && !anchors.has(t) && !isPropId(map, t)) {
          problems.push(`${at} step '${step.id}': unknown target '${t}'`);
        }
      }
    }
  }
  if ((chores?.chores ?? []).length) {
    for (let d = 1; d <= 9; d++) if (!daysCovered.has(d)) problems.push(`chores: no chore for day ${d}`);
  }

  // === events: tags, kinds, anchors, escalation ===
  const evIds = new Set((events?.events ?? []).map((e) => e.id));
  for (const e of events?.events ?? []) {
    const at = `events: '${e.id}'`;
    for (const tag of e.tags ?? []) if (!KNOWN_TAGS.has(tag)) problems.push(`${at}: unknown tag '${tag}'`);
    if (e.manifest?.kind && !KNOWN_MANIFEST_KINDS.has(e.manifest.kind)) {
      problems.push(`${at}: unknown manifest kind '${e.manifest.kind}'`);
    }
    if (e.escalatesTo && !evIds.has(e.escalatesTo)) {
      problems.push(`${at}: escalatesTo '${e.escalatesTo}' does not resolve`);
    }
    for (const a of e.placement?.anchors ?? []) {
      if (anchors.size && !anchors.has(a) && !isPropId(map, a)) {
        problems.push(`${at}: placement anchor '${a}' unknown`);
      }
    }
    const mAnchor = e.manifest?.anchor;
    if (mAnchor && anchors.size && !anchors.has(mAnchor) && !isPropId(map, mAnchor)) {
      problems.push(`${at}: manifest anchor '${mAnchor}' unknown`);
    }
  }

  // === radio: playlists reference songs ===
  for (const d of radio?.days ?? []) {
    for (const id of d.playlist ?? []) {
      if (!songIds.has(id)) problems.push(`radio day ${d.day}: song '${id}' not found`);
    }
  }

  // === story: beats reference scenes ===
  for (const b of story?.beats ?? []) {
    if (b.scene && !sceneExists(b.scene)) problems.push(`story beat '${b.id}': scene '${b.scene}' not found`);
  }
  // scene ops: goto/label integrity, ending ids, startScene inside effects
  for (const sc of story?.scenes ?? []) {
    const labels = new Set((sc.ops ?? []).filter((o) => o.op === 'label').map((o) => o.id));
    for (const op of sc.ops ?? []) {
      if ((op.op === 'goto' || (op.op === 'branch')) ) {
        const targets = op.op === 'goto' ? [op.id] : [op.then, op.else].filter(Boolean);
        for (const t of targets) if (!labels.has(t)) problems.push(`story scene '${sc.id}': label '${t}' not found`);
      }
    }
  }

  return problems;
}

function isPropId(map, id) {
  if (!map) return false;
  for (const p of map.props ?? []) if (p.id === id) return true;
  for (const rd of map.rooms ?? []) for (const p of rd.props ?? []) if (p.id === id) return true;
  return false;
}

function checkEffects(effects, at, sceneExists, chores, problems) {
  if (!effects) return;
  if (effects.startScene && !sceneExists(effects.startScene)) {
    problems.push(`${at}: startScene '${effects.startScene}' not found`);
  }
  if (effects.startChore && chores) {
    const ok = (chores.chores ?? []).some((c) => c.id === effects.startChore);
    if (!ok) problems.push(`${at}: startChore '${effects.startChore}' not found`);
  }
}

// --- CLI -------------------------------------------------------------------
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const problems = validateContent(root);
  if (problems.length) {
    console.error(`✗ ${problems.length} content problem(s):`);
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  } else {
    console.log('✓ content valid');
    process.exit(0);
  }
}
