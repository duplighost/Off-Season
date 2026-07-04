/**
 * Content loading. All /content JSON is bundled statically (no fetch, no
 * async). Dialogue is globbed so content agents can add files without
 * touching engine code; the map is globbed too so the engine keeps compiling
 * and running (with a loud warning) before content/map/town.json lands.
 *
 * Everything is normalized defensively: placeholder/empty content must never
 * crash the engine — warn and continue.
 */

import type {
  BarkPool,
  BuildingDef,
  ChoreDef,
  ChoreFile,
  ContentBundle,
  DialogueFile,
  DialogueNode,
  EventFile,
  MapContent,
  NpcSchedule,
  PropDef,
  RadioDay,
  RadioFile,
  RoomDef,
  SceneDef,
  ScheduleFile,
  SongDef,
  StoryBeat,
  StoryFile,
  TerrainCmd,
  WrongnessEventDef,
} from '../types';

import stringsJson from '../../content/strings.json';
import schedulesJson from '../../content/schedules/schedules.json';
import choresJson from '../../content/chores/chores.json';
import eventsJson from '../../content/events/events.json';
import radioJson from '../../content/radio/radio.json';
import storyJson from '../../content/story/story.json';

const dialogueModules = import.meta.glob('../../content/dialogue/*.json', {
  eager: true,
}) as Record<string, { default?: unknown }>;

const mapModules = import.meta.glob('../../content/map/town.json', {
  eager: true,
}) as Record<string, { default?: unknown }>;

function field(raw: unknown, key: string): unknown {
  return raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>)[key] : undefined;
}

function asArray<T>(v: unknown, label: string): T[] {
  if (Array.isArray(v)) return v as T[];
  if (v !== undefined) console.warn(`[assets] ${label} is not an array; using []`);
  return [];
}

function normStrings(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw === null || typeof raw !== 'object') {
    console.warn('[assets] content/strings.json malformed; UI strings will be blank');
    return out;
  }
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
    else console.warn(`[assets] strings.json["${k}"] is not a string; skipped`);
  }
  return out;
}

function normDialogue(raw: unknown, path: string): DialogueFile {
  if (raw === null || typeof raw !== 'object') {
    console.warn(`[assets] dialogue file ${path} malformed; using empty file`);
    return { nodes: [], barkPools: [] };
  }
  return {
    nodes: asArray<DialogueNode>(field(raw, 'nodes'), `${path} nodes`),
    barkPools: asArray<BarkPool>(field(raw, 'barkPools'), `${path} barkPools`),
  };
}

function normMap(raw: unknown): MapContent {
  const empty: MapContent = {
    width: 120,
    height: 90,
    terrain: [],
    buildings: [],
    props: [],
    zones: [],
    anchors: {},
    rooms: [],
  };
  if (raw === null || typeof raw !== 'object') return empty;
  const w = field(raw, 'width');
  const h = field(raw, 'height');
  const anchors = field(raw, 'anchors');
  return {
    width: typeof w === 'number' && w > 0 ? w : empty.width,
    height: typeof h === 'number' && h > 0 ? h : empty.height,
    terrain: asArray<TerrainCmd>(field(raw, 'terrain'), 'map.terrain'),
    buildings: asArray<BuildingDef>(field(raw, 'buildings'), 'map.buildings'),
    props: asArray<PropDef>(field(raw, 'props'), 'map.props'),
    zones: asArray<MapContent['zones'][number]>(field(raw, 'zones'), 'map.zones'),
    anchors:
      typeof anchors === 'object' && anchors !== null
        ? (anchors as MapContent['anchors'])
        : {},
    rooms: asArray<RoomDef>(field(raw, 'rooms'), 'map.rooms'),
  };
}

export function loadContent(): ContentBundle {
  const dialogue: DialogueFile[] = [];
  for (const path of Object.keys(dialogueModules).sort()) {
    const mod = dialogueModules[path];
    dialogue.push(normDialogue(mod?.default ?? mod, path));
  }
  if (dialogue.length === 0) {
    console.warn('[assets] no dialogue files under content/dialogue/');
  }

  const schedules: ScheduleFile = {
    schedules: asArray<NpcSchedule>(field(schedulesJson, 'schedules'), 'schedules.schedules'),
  };

  const chores: ChoreFile = {
    chores: asArray<ChoreDef>(field(choresJson, 'chores'), 'chores.chores'),
  };

  const events: EventFile = {
    events: asArray<WrongnessEventDef>(field(eventsJson, 'events'), 'events.events'),
  };

  const station = field(radioJson, 'station');
  const radio: RadioFile = {
    station: typeof station === 'string' ? station : '',
    songs: asArray<SongDef>(field(radioJson, 'songs'), 'radio.songs'),
    days: asArray<RadioDay>(field(radioJson, 'days'), 'radio.days'),
  };

  const story: StoryFile = {
    beats: asArray<StoryBeat>(field(storyJson, 'beats'), 'story.beats'),
    scenes: asArray<SceneDef>(field(storyJson, 'scenes'), 'story.scenes'),
  };

  const mapPaths = Object.keys(mapModules);
  let map: MapContent;
  if (mapPaths.length > 0) {
    const mod = mapModules[mapPaths[0]];
    map = normMap(mod?.default ?? mod);
  } else {
    console.warn('[assets] content/map/town.json not found; using empty map');
    map = normMap(null);
  }

  const strings = normStrings(stringsJson);

  const placeholders: string[] = [];
  const nodeCount = dialogue.reduce((n, f) => n + f.nodes.length, 0);
  if (nodeCount === 0) placeholders.push('dialogue');
  if (schedules.schedules.length === 0) placeholders.push('schedules');
  if (chores.chores.length === 0) placeholders.push('chores');
  if (events.events.length === 0) placeholders.push('events');
  if (radio.songs.length === 0) placeholders.push('radio');
  if (story.scenes.length === 0) placeholders.push('story');
  if (placeholders.length > 0) {
    console.warn(`[assets] placeholder/empty content: ${placeholders.join(', ')}`);
  }

  return { dialogue, schedules, chores, events, radio, map, story, strings };
}
