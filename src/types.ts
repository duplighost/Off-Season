/**
 * OFF-SEASON — shared type contracts.
 *
 * Every module imports its cross-module types from this file and ONLY this
 * file. If you need a new cross-module type, it goes here.
 *
 * Invariants (from the design bible §0):
 *  - Engine code never contains a line of dialogue. All narrative content is
 *    JSON under /content, loaded via engine/assets.ts.
 *  - All randomness flows through the seeded PRNG (engine/prng.ts), split by
 *    named stream. Never Math.random().
 *  - The Slack is never shown. Wrongness is subtraction: props, sounds,
 *    people, color get removed or displaced. Nothing screams.
 */

// ---------------------------------------------------------------------------
// Geometry & primitives
// ---------------------------------------------------------------------------

export interface Vec {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Dir = 'up' | 'down' | 'left' | 'right';

/** Internal render resolution (design bible §10). */
export const SCREEN_W = 480;
export const SCREEN_H = 270;
/** Tile size in pixels. World map is 120x90 tiles. */
export const TILE = 16;

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

/**
 * The 16-color September-coastal base palette (§10). Index into this
 * everywhere; the per-day LUT is applied by recoloring these entries, never
 * by touching sprite data.
 */
export const BASE_PALETTE: readonly string[] = [
  '#1b1f24', // 0 darkest slate
  '#3a3f47', // 1 dark slate
  '#6b7280', // 2 mid gray
  '#b9c0c9', // 3 fog gray
  '#0e3a4a', // 4 deep water
  '#2d6e7e', // 5 mid water
  '#7fb6c2', // 6 shallow water
  '#c9a24b', // 7 beach grass
  '#e0c98f', // 8 sand
  '#8a4b2d', // 9 brick
  '#c96f3b', // 10 rust / leaves
  '#4a5d3a', // 11 hedge dark
  '#7a8f5a', // 12 marsh green
  '#efe6d5', // 13 clapboard white
  '#d94f30', // 14 flag red / Lantern beam
  '#f2d16b', // 15 window light (the loaded color)
];

// ---------------------------------------------------------------------------
// IDs
// ---------------------------------------------------------------------------

/** Outdoor zone ids — these are the districts of §4.1 plus travel anchors. */
export type ZoneId =
  | 'mainstreet'
  | 'boardwalk'
  | 'point'
  | 'harbor'
  | 'blackrock'
  | 'neck'
  | 'rockneck'
  | 'marsh';

/**
 * Room ids. 'town' is the single outdoor map; everything else is an
 * interior. Interiors are small rooms connected by doors.
 */
export type RoomId = string; // 'town' | 'townhall' | 'diner' | 'bookark' | 'church' | 'wren_house' | 'june_cottage' | 'shorehaven' | 'harbor_shack' | 'lighthouse' | 'records_room'

export type NpcId =
  | 'june'
  | 'margie'
  | 'sal'
  | 'roz'
  | 'petey'
  | 'edith'
  | 'cutter'
  | 'amaral'
  | 'gus'
  | 'alma'
  | 'second_gus'
  | 'hutch'
  | 'gigi';

export type EndingId =
  | 'by_the_book' // 1
  | 'stowaway' // 2
  | 'long_light' // 3
  | 'two_hundred_one' // 4
  | 'last_train'; // 5 (secret)

// ---------------------------------------------------------------------------
// Content: dialogue (§9.1)
// ---------------------------------------------------------------------------

/**
 * Condition mini-DSL. Keys of the `flags` array are expressions over
 * game state, evaluated by systems/dialogue.ts:
 *   "some_flag"            — flag truthy
 *   "!some_flag"           — flag falsy
 *   "counter>=3"           — numeric compare (>=, <=, >, <, ==, !=)
 * Left-hand names resolve against, in order:
 *   flags, then the named stats: suspicion, juneTrust, disruptionDebt, day,
 *   clockMin, population, and signatory trust as "trust_roz" etc.
 */
export interface DialogueConditions {
  day?: number | number[]; // exact day or any-of
  minDay?: number;
  maxDay?: number;
  phase?: DayPhase | DayPhase[];
  flags?: string[]; // ALL must hold (AND)
  anyFlags?: string[]; // at least one must hold (OR), optional
}

export interface DialogueEffects {
  suspicion?: number; // delta
  juneTrust?: number; // delta
  trust?: { [signatory: string]: number }; // signatory trust deltas
  disruption?: number; // delta to disruptionDebt
  flags?: Record<string, number | boolean | string>; // set flags
  incFlags?: string[]; // increment numeric flags by 1
  giveKey?: string;
  giveItem?: string;
  takeItem?: string;
  startChore?: string;
  startScene?: string; // scene id in content/story/scenes
  save?: boolean; // coffee save
}

export interface DialogueChoice {
  text: string;
  conditions?: DialogueConditions; // choice hidden unless met
  effects?: DialogueEffects;
  goto: string | null; // node id or null to end
}

export interface DialogueNode {
  id: string; // e.g. "roz.d4.doubleorder"
  speaker: NpcId | 'narrator' | 'sign' | 'radio' | 'doc';
  conditions?: DialogueConditions;
  /** Priority when several nodes match; higher wins. Default 0. */
  priority?: number;
  lines: string[];
  choices?: DialogueChoice[];
  effects?: DialogueEffects; // applied when node is shown
  /**
   * Dialogue drift (§7.4): per-day overrides of `lines`. Key is min day.
   * e.g. {"6": ["Morning."], "8": ["(A nod. Eye contact a beat too long.)"]}
   */
  decaySchedule?: Record<string, string[]> | null;
  oneShot?: boolean;
  goto?: string | null; // auto-continue when no choices
}

/** A bark pool: ambient one-liners keyed by pool id. */
export interface BarkPool {
  id: string; // e.g. "club.dusk"
  barks: string[];
  /** drift variants; key = min day, value = replacement bark list. Empty list = silence (a nod). */
  decaySchedule?: Record<string, string[]>;
}

export interface DialogueFile {
  nodes: DialogueNode[];
  barkPools?: BarkPool[];
}

// ---------------------------------------------------------------------------
// Content: NPC schedules (§9.2)
// ---------------------------------------------------------------------------

export interface ScheduleSlot {
  start: string; // "17:40"
  end: string; // "18:20"
  room: RoomId; // 'town' or interior id
  anchor: string; // named anchor in map spawns
  activity: string; // freeform, drives idle animation/pose
  barkPool?: string;
  waveAtPlayer?: boolean;
  /** If set, interacting starts dialogue at this node id instead of pool. */
  talkNode?: string;
}

export interface NpcSchedule {
  npc: NpcId;
  /** Days this schedule file entry covers. */
  day: number[];
  slots: ScheduleSlot[];
  driftEligible?: boolean;
}

export interface ScheduleFile {
  schedules: NpcSchedule[];
}

// ---------------------------------------------------------------------------
// Content: chores (§9.3)
// ---------------------------------------------------------------------------

export type ChoreStepType =
  | 'goto' // walk to anchor
  | 'interact' // interact with a prop/anchor
  | 'interact_sequence' // interact with targets, order may matter
  | 'hold_timing' // hold/release timing bar (winch)
  | 'carry' // pick up N items at source, deposit at sink
  | 'boat_task' // rowboat loop: board boat, visit water targets
  | 'meter_read' // meter reading UI at a structure
  | 'switch'; // a single heavy switch (breaker thunk / the Lantern)

export interface ChoreStep {
  id: string;
  type: ChoreStepType;
  /** Anchor or prop id(s) this step happens at. */
  target?: string;
  targets?: string[];
  count?: number; // for carry
  difficulty?: number; // for hold_timing
  prompt?: string; // short UI prompt text (content, not engine!)
  /** For interact_sequence: the ritually correct order (prop ids). */
  correctOrder?: string[];
}

export interface CorrectnessCheck {
  id: string;
  /**
   * Check kinds, evaluated by systems/chores.ts:
   *  'order_matches'   — sequence done in correctOrder
   *  'before_clock'    — step/chore finished before value ("18:00" or "sundown")
   *  'flag'            — a flag was set during the chore (e.g. by a choice)
   *  'all_targets'     — every target visited
   */
  check: 'order_matches' | 'before_clock' | 'flag' | 'all_targets';
  value?: string;
  step?: string; // step id this applies to
  hint: 'none' | string;
  disruptionOnMiss: number;
}

export interface ChoreDef {
  id: string; // "chore.d1.swimlines"
  day: number;
  title: string; // checklist card text
  room: RoomId;
  zone?: ZoneId;
  steps: ChoreStep[];
  correctness: CorrectnessCheck[];
  deadline: 'sundown' | 'midnight' | string; // "18:00" style also allowed
  disruptionOnSkip: number;
  /** Checklist item number 1..9. */
  item: number;
}

export interface ChoreFile {
  chores: ChoreDef[];
}

// ---------------------------------------------------------------------------
// Content: wrongness events (§9.4)
// ---------------------------------------------------------------------------

export type EventTag = 'visual' | 'audio' | 'npc' | 'spatial' | 'animal';

export interface EventPlacement {
  zones?: ZoneId[];
  rooms?: RoomId[];
  minDay?: number;
  maxDay?: number;
  /** Named anchor(s) the manifestation attaches to, chosen by PRNG. */
  anchors?: string[];
  surface?: string;
}

/**
 * How an event manifests in the world. The director picks and schedules;
 * game/manifest.ts renders/sounds it. Keep manifestations subtractive.
 */
export interface EventManifestation {
  kind:
    | 'prop_add' // e.g. extra porch chair
    | 'prop_remove'
    | 'prop_swap' // e.g. flag refolded wrong
    | 'light_toggle' // a window lit that shouldn't be / dark that should
    | 'audio_cue' // a positional or global sound behavior
    | 'npc_deviation' // schedule deviation (director injects)
    | 'ambient_mute'; // local subtraction: a stem dies in this zone
  prop?: string; // prop sprite id for prop_* kinds
  sound?: string; // audio cue id for audio_cue
  npc?: NpcId; // for npc_deviation
  deviation?: string; // activity id for the deviation
  anchor?: string; // where, if fixed
  text?: string; // examine text shown if player inspects (content!)
}

export interface WrongnessEventDef {
  id: string; // "evt.wet_footprints_wrong_way"
  cost: number;
  tags: EventTag[];
  family?: string;
  escalatesTo?: string | null;
  placement: EventPlacement;
  prereqs?: string[]; // flag expressions, same DSL as dialogue
  cooldownDays?: number;
  oneShot?: boolean;
  catTell?: boolean;
  manifest: EventManifestation;
}

export interface EventFile {
  events: WrongnessEventDef[];
}

// ---------------------------------------------------------------------------
// Content: radio (§7.8)
// ---------------------------------------------------------------------------

/** A chiptune song as note data for engine/music.ts. */
export interface SongTrack {
  wave: 'square' | 'triangle' | 'sawtooth' | 'sine' | 'noise';
  volume: number; // 0..1
  /** Notes: [startBeat, midiPitch, durationBeats]. midiPitch -1 = rest/noise hit. */
  notes: [number, number, number][];
}

export interface SongDef {
  id: string;
  title: string; // shown on radio ticker
  artist: string; // fictional
  bpm: number;
  lengthBeats: number;
  tracks: SongTrack[];
}

export interface RadioDay {
  day: number;
  /** Song ids in rotation this day. */
  playlist: string[];
  /** Playback rate (1.0 normal; Day 8 the survivor slows). */
  rate?: number;
  /** Lowpass cutoff Hz applied to radio bus (rolloff as days decay). */
  lowpass?: number;
  /** DJ patter lines shown on the ticker between songs. */
  patter: string[];
  /** If true, radio is static that keeps the last song's rhythm. */
  rhythmicStatic?: boolean;
}

export interface RadioFile {
  station: string; // "WLNK 1290"
  songs: SongDef[];
  days: RadioDay[];
}

// ---------------------------------------------------------------------------
// Content: map
// ---------------------------------------------------------------------------

/**
 * Declarative town description compiled to tiles by engine/map.ts.
 * The map is hand-designed data, not procgen (§0.5).
 */
export interface MapContent {
  width: number; // tiles (120)
  height: number; // tiles (90)
  /** Base terrain paint commands, applied in order. */
  terrain: TerrainCmd[];
  buildings: BuildingDef[];
  props: PropDef[];
  zones: { id: ZoneId; rect: Rect }[]; // tile-space rects
  /** Named points, tile-space. Schedules/chores/events reference these. */
  anchors: Record<string, { room: RoomId; x: number; y: number }>;
  rooms: RoomDef[];
}

export interface TerrainCmd {
  tile: string; // tile type id, e.g. 'water','sand','grass','road','boardwalk','marsh','rock','rail'
  rect?: Rect;
  /** Polyline paint (roads, rails, shoreline), tile-space, width in tiles. */
  path?: [number, number][];
  pathWidth?: number;
}

export interface BuildingDef {
  id: string;
  rect: Rect; // tile-space footprint on town map
  style: 'clapboard' | 'brick' | 'shingle' | 'municipal' | 'shack' | 'lighthouse' | 'church';
  door?: { x: number; y: number; to?: RoomId; toAnchor?: string; locked?: string /* key id */ };
  /** Windows that can light at night. lightFlag: flag controlling it. */
  windows?: { x: number; y: number; lightFlag?: string }[];
  label?: string; // examine text
}

export interface PropDef {
  id: string;
  sprite: string;
  room: RoomId;
  x: number; // tile-space
  y: number;
  solid?: boolean;
  /** Interact behavior: dialogue node, scene, or chore target. */
  interact?: { node?: string; scene?: string; examine?: string };
}

export interface RoomDef {
  id: RoomId;
  width: number;
  height: number;
  floor: string; // tile type id
  walls?: boolean; // auto-wall the border
  exit: { x: number; y: number; toAnchor: string }; // door back
  props?: PropDef[];
  anchors?: Record<string, { x: number; y: number }>;
}

/** Compiled map (output of engine/map.ts compile step). */
export interface CompiledRoom {
  id: RoomId;
  width: number;
  height: number;
  /** tile type id per cell. */
  tiles: string[];
  solid: Uint8Array;
  props: PropDef[];
  anchors: Record<string, Vec>; // pixel-space
  zones: { id: ZoneId; rect: Rect }[]; // pixel-space (town only)
  buildings: BuildingDef[];
  doors: { rect: Rect; to: RoomId; toAnchor: string; locked?: string }[];
}

export interface CompiledMap {
  rooms: Record<RoomId, CompiledRoom>;
}

// ---------------------------------------------------------------------------
// Content: story scenes & beats
// ---------------------------------------------------------------------------

/**
 * Scene script ops. Scenes are the cutscene/beat/ending vehicle. Executed by
 * systems/story.ts; all text lives in content.
 */
export type SceneOp =
  | { op: 'text'; speaker?: string; lines: string[] } // dialogue-box text
  | { op: 'slide'; text: string; hold?: number } // full-screen slide (dreams, endings)
  | { op: 'choice'; prompt?: string; options: { text: string; effects?: DialogueEffects; goto?: string }[] }
  | { op: 'effects'; effects: DialogueEffects }
  | { op: 'sound'; cue: string }
  | { op: 'music'; song: string | null }
  | { op: 'wait'; seconds: number }
  | { op: 'fade'; to: 'black' | 'in'; seconds?: number }
  | { op: 'teleport'; room: RoomId; anchor: string }
  | { op: 'clock'; set: string } // "18:10"
  | { op: 'label'; id: string }
  | { op: 'goto'; id: string } // jump to label
  | { op: 'branch'; if: string[]; then: string; else?: string } // flag DSL -> labels
  | { op: 'ending'; id: EndingId }
  | { op: 'endScene' };

export interface SceneDef {
  id: string;
  ops: SceneOp[];
}

export interface BeatTrigger {
  day: number;
  /** Clock window "HH:MM-HH:MM", or phase. */
  clock?: string;
  phase?: DayPhase;
  room?: RoomId;
  zone?: ZoneId;
  flags?: string[]; // condition DSL, ANDed
  /** Fire when player enters zone/room during window; else fire at window start. */
  onEnter?: boolean;
}

export interface StoryBeat {
  id: string;
  trigger: BeatTrigger;
  scene: string; // scene id
  oneShot?: boolean; // default true
}

export interface StoryFile {
  beats: StoryBeat[];
  scenes: SceneDef[];
}

// ---------------------------------------------------------------------------
// Game state (save schema §9.5)
// ---------------------------------------------------------------------------

export type DayPhase = 'morning' | 'day' | 'dusk' | 'night';

export interface NpcState {
  id: NpcId;
  room: RoomId;
  pos: Vec;
  facing: Dir;
  activity: string;
  /** Current deviation event id, if the director has displaced them. */
  deviation?: string | null;
  /** Gigi only: following Wren. */
  following?: boolean;
}

export interface ActiveEvent {
  id: string; // def id
  day: number; // day placed
  room: RoomId;
  anchor: string;
  pos: Vec;
  witnessed: boolean;
  /** Seconds the viewport has lingered on it (for witnessing). */
  lingerSec: number;
  /** Cat tell scheduled this many sec before activation. */
  catTellAt?: number;
  activatesAtClock: number; // clockMin when it becomes visible
  active: boolean;
}

export interface DirectorState {
  /** budget spent per day. */
  spent: Record<string, number>;
  witnessed: string[]; // event def ids witnessed (drives escalation)
  escalations: Record<string, number>; // family -> rung
  placedDays: Record<string, number>; // def id -> last day placed (cooldowns)
  oneShotsUsed: string[];
}

export interface ChoreRecord {
  done: boolean;
  correct: boolean;
  missedChecks: string[];
  finishedAtClock?: number;
  skipped?: boolean;
}

export interface LedgerState {
  count: number;
  forged: boolean;
  amended: boolean; // Form 12-C filed
}

export interface GameFlags {
  [key: string]: number | boolean | string;
}

export interface GameState {
  version: 1;
  seed: number;
  day: number; // 1..9
  clockMin: number; // minutes since midnight, e.g. 390 = 06:30
  phase: DayPhase;
  player: {
    name: string; // renameable; default "Wren"
    room: RoomId;
    pos: Vec;
    facing: Dir;
  };
  flags: GameFlags;
  suspicion: number; // 0..100
  juneTrust: number; // 0..100
  signatoryTrust: Record<string, number>; // roz, edith, amaral, household
  disruptionDebt: number;
  choresDone: Record<string, ChoreRecord>;
  ledger: LedgerState;
  keys: string[];
  inventory: Record<string, number>;
  director: DirectorState;
  audio: { subtracted: string[] };
  npcs: Record<string, NpcState>;
  activeEvents: ActiveEvent[];
  population: number;
  ending: EndingId | null;
  /** Dialogue oneShot node ids seen. */
  seenNodes: string[];
  /** Scene oneShot ids played. */
  playedBeats: string[];
  /** Boardwalk sections shut (1..9). */
  lightsOut: number[];
  /** Radio on/off in the truck & house. */
  radioOn: boolean;
  stats: { coffees: number; doubleOrders: number; nightsOutLate: number };
}

// ---------------------------------------------------------------------------
// Content bundle (everything assets.ts loads)
// ---------------------------------------------------------------------------

export interface ContentBundle {
  dialogue: DialogueFile[]; // all dialogue files merged at load
  schedules: ScheduleFile;
  chores: ChoreFile;
  events: EventFile;
  radio: RadioFile;
  map: MapContent;
  story: StoryFile;
  strings: Record<string, string>; // UI strings (checklist header, prompts)
}

// ---------------------------------------------------------------------------
// Engine service interfaces (implemented in /src/engine, consumed everywhere)
// ---------------------------------------------------------------------------

/** Seeded PRNG stream (mulberry32). */
export interface Rng {
  /** [0,1) */
  next(): number;
  int(maxExclusive: number): number;
  pick<T>(arr: readonly T[]): T;
  shuffle<T>(arr: T[]): T[];
}

/** PRNG factory: same seed + same stream name => same sequence. */
export interface RngFactory {
  stream(name: string): Rng;
}

export type BusEvent =
  | { type: 'choreStepDone'; chore: string; step: string }
  | { type: 'choreCompleted'; chore: string; correct: boolean }
  | { type: 'choreMissed'; chore: string }
  | { type: 'dayStart'; day: number }
  | { type: 'dayEnd'; day: number }
  | { type: 'phaseChange'; phase: DayPhase }
  | { type: 'eventWitnessed'; eventId: string }
  | { type: 'dialogueEnded'; node: string }
  | { type: 'sceneEnded'; scene: string }
  | { type: 'lightSectionOut'; section: number }
  | { type: 'saved' }
  | { type: 'suspicionChanged'; value: number; delta: number }
  | { type: 'trustChanged'; value: number; delta: number }
  | { type: 'endingReached'; ending: EndingId };

export interface Bus {
  emit(e: BusEvent): void;
  on(type: BusEvent['type'], fn: (e: BusEvent) => void): () => void;
}

/** Audio engine surface (engine/audio.ts). All synthesis, no assets. */
export interface AudioEngine {
  /** Must be called from a user gesture. */
  unlock(): Promise<void>;
  /** Set ambient stem target volume 0..1 (smoothed). Stem ids in §7.7. */
  setStem(stem: string, level: number): void;
  /** Which stems exist. */
  stems(): string[];
  /** Play a one-shot foley cue: 'thunk','padlock','coffee','bell','winch','chain','footstep_wood','footstep_sand','footstep_grass','footstep_road','door','page','pen','switch_heavy','train_horn','crossing_bell','static_burst' */
  cue(name: string, opts?: { volume?: number; pan?: number }): void;
  /** Reverb tail scale 0..1 (1 = normal; Day 9 shrinks it). */
  setReverbTail(scale: number): void;
  /** Radio control. */
  radioPlay(song: SongDef, opts?: { rate?: number; lowpass?: number }): void;
  radioStatic(rhythmic?: boolean): void;
  radioStop(): void;
  /** Global bus for scene stingers. Keep unused until ending 4. */
  playEpilogueCue(): void;
  /** Bell toll count times. */
  bell(times: number): void;
  update(dt: number): void;
}

export interface InputState {
  /** movement vector, -1..1 each axis */
  moveX: number;
  moveY: number;
  /** true on the frame the key went down */
  interactPressed: boolean;
  cancelPressed: boolean;
  /** hold state for hold_timing steps */
  interactHeld: boolean;
  /** UI navigation */
  upPressed: boolean;
  downPressed: boolean;
  leftPressed: boolean;
  rightPressed: boolean;
  confirmPressed: boolean;
  /** toggles */
  checklistPressed: boolean; // C or Tab
  radioPressed: boolean; // R
  debugPressed: boolean; // F1 / backtick
  /** raw pointer, canvas-space (for debug pane & menus) */
  mouseX: number;
  mouseY: number;
  mouseDown: boolean;
  mouseClicked: boolean;
}

// ---------------------------------------------------------------------------
// Renderer surface (engine/renderer.ts)
// ---------------------------------------------------------------------------

export interface Camera {
  x: number; // world px, top-left
  y: number;
}

/**
 * Renderer draws palette-indexed pixel art. Sprites are registered as index
 * grids (engine/sprites.ts); the renderer resolves indices through the
 * current day LUT palette each frame.
 */
export interface Renderer {
  /** Set the active 16-color palette (post-LUT hex strings). */
  setPalette(pal: readonly string[]): void;
  begin(cam: Camera): void;
  drawTile(tileType: string, wx: number, wy: number, variant?: number): void;
  drawSprite(spriteId: string, wx: number, wy: number, opts?: { flipX?: boolean; frame?: number }): void;
  /** Screen-space (UI) drawing helpers. */
  rect(x: number, y: number, w: number, h: number, colorIdx: number, alpha?: number): void;
  frame(x: number, y: number, w: number, h: number, colorIdx: number): void;
  text(s: string, x: number, y: number, colorIdx: number, opts?: { maxWidth?: number; serif?: boolean }): void;
  textWidth(s: string, serif?: boolean): number;
  /** Fog dither overlay, density 0..1. */
  fog(density: number): void;
  /** Full-screen darkness with window-light holes at night. */
  nightOverlay(darkness: number, lights: { x: number; y: number; r: number }[], cam: Camera): void;
  /** letterbox for scenes */
  letterbox(amount01: number): void;
  end(): void;
  readonly ctx: CanvasRenderingContext2D;
}

// ---------------------------------------------------------------------------
// The composition context passed to systems each frame
// ---------------------------------------------------------------------------

/** UI modes the game can be in; game/game.ts owns the stack. */
export type UiMode =
  | 'title'
  | 'walk'
  | 'dialogue'
  | 'scene'
  | 'checklist'
  | 'minigame'
  | 'meter'
  | 'ledger'
  | 'travel'
  | 'debug'
  | 'ending';

export interface Ctx {
  state: GameState;
  content: ContentBundle;
  map: CompiledMap;
  rng: RngFactory;
  bus: Bus;
  audio: AudioEngine;
  input: InputState;
  /** Push/query UI mode (game/game.ts implements). */
  ui: {
    mode: UiMode;
    push(mode: UiMode): void;
    pop(): void;
    /** Start dialogue at node id (or best node for npc). */
    startDialogue(opts: { node?: string; npc?: NpcId }): void;
    startScene(sceneId: string): void;
    toast(msg: string): void; // small HUD notice, e.g. "Saved."
  };
  /** True while a modal (dialogue/scene/minigame) freezes the clock. */
  paused: boolean;
  debug: boolean;
}

// ---------------------------------------------------------------------------
// Time helpers (systems/time.ts implements; constants shared here)
// ---------------------------------------------------------------------------

/** Game-minutes advanced per real second in walk mode. */
export const CLOCK_RATE = 1.0;
export const DAY_START_MIN = 390; // 06:30
export const DAY_END_MIN = 24 * 60; // forced sleep at midnight

/** Sunset (dusk start) per day, minutes since midnight (§7.6 curve). */
export const SUNSET_MIN: readonly number[] = [
  0, // unused index 0
  19 * 60 + 15, // D1 19:15
  19 * 60 + 8,
  19 * 60 + 1,
  18 * 60 + 54,
  18 * 60 + 49,
  18 * 60 + 44,
  18 * 60 + 40,
  18 * 60 + 37,
  18 * 60 + 35, // D9 18:35
];

/** Perceived dusk (fog rolls in) arrives even earlier each day. */
export const FOG_LEAD_MIN: readonly number[] = [0, 0, 5, 12, 20, 30, 42, 55, 70, 85];

/** Director base unease budget per day (§7.3). */
export const DIRECTOR_BASE: readonly number[] = [0, 0, 0, 1, 2, 3, 4, 6, 8, 10];
export const DEBT_MULT = 1;

/** Population by day (HUD sign §7.9): value shown at day start. */
export const POPULATION_BY_DAY: readonly number[] = [
  0, 4100, 2900, 1750, 900, 480, 260, 200, 200, 200,
];
