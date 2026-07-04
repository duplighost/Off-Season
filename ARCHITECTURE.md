# OFF-SEASON — Architecture Contracts

This document + `src/types.ts` are the integration contract. Every module
must export **exactly** the surface specified here (extra private helpers are
fine). All cross-module types come from `src/types.ts`.

## Hard rules

1. **No dialogue/narrative strings in TypeScript.** All player-visible
   narrative text lives in `/content` JSON. UI chrome labels (e.g. "SAVE",
   key prompts) come from `content/strings.json` via `ctx.content.strings`.
2. **No `Math.random()`, no `Date.now()` for game logic.** Randomness comes
   from `ctx.rng.stream(name)`. Wall-time is allowed only for frame delta.
3. **Palette-indexed drawing only.** Never hardcode hex colors in draw calls;
   use palette indices 0–15 (see `BASE_PALETTE` comments in types.ts).
4. **Determinism.** Director uses stream `director:{day}`. Ambient flavor
   uses `ambient`. Misc uses `misc`. Same seed + same inputs = same run.
5. **The Slack is never rendered.** No new "monster" sprites. Wrongness
   events manifest per their JSON `manifest` block only.
6. **No new dependencies.** Runtime deps: none. Dev deps: vite, typescript,
   vitest only.
7. Modules must compile under `strict: true` with the project tsconfig.

## Directory layout

```
/src
  types.ts            — shared contracts (DO NOT EDIT without updating this doc)
  main.ts             — bootstrap: canvas, loop, Game
  /engine   prng.ts  save.ts  assets.ts  input.ts  renderer.ts  sprites.ts
            audio.ts  music.ts  map.ts
  /systems  time.ts  schedule.ts  director.ts  suspicion.ts  chores.ts
            radio.ts  palette.ts  dialogue.ts  story.ts
  /game     game.ts  player.ts  npc.ts  manifest.ts  interact.ts
  /ui       hud.ts  checklist.ts  dialoguebox.ts  scenes.ts  minigames.ts
            ledger.ts  travel.ts  title.ts  debugpane.ts  font.ts
/content
  strings.json
  /dialogue  *.json (DialogueFile)
  /schedules schedules.json (ScheduleFile)
  /chores    chores.json (ChoreFile)
  /events    events.json (EventFile)
  /radio     radio.json (RadioFile)
  /map       town.json (MapContent)
  /story     story.json (StoryFile)
/tools
  validate-content.mjs
/tests     *.test.ts (vitest)
```

Content JSON is imported statically by `engine/assets.ts` with Vite's
`import ... from '../../content/x.json'` — no fetch, no async loading issues.

## Module contracts

### engine/prng.ts
```ts
export function makeRngFactory(seed: number): RngFactory;
export function hashString(s: string): number;
```
mulberry32; `stream(name)` derives a stream seed from `seed ^ hashString(name)`
and caches the stream so repeated calls continue the same sequence.

### engine/save.ts
```ts
export function saveGame(state: GameState): void;          // localStorage 'offseason.save'
export function loadGame(): GameState | null;
export function hasSave(): boolean;
export function clearSave(): void;
export function exportSave(state: GameState): string;      // JSON string for download
export function newGame(seed: number, name?: string): GameState; // fully-initialized state
```
`newGame` builds the complete initial GameState (day 1, 06:30, keys:
['truck','bathhouse','pool_shed','boardwalk_panels'], population 4100, etc).

### engine/assets.ts
```ts
export function loadContent(): ContentBundle;  // static imports, merge dialogue files
```

### engine/input.ts
```ts
export function createInput(canvas: HTMLCanvasElement): { state: InputState; update(): void };
```
`update()` is called once per frame AFTER systems consume it; it clears the
`*Pressed` edge flags. Keys: WASD/arrows move, E/Space/Enter interact+confirm,
Esc cancel, C/Tab checklist, R radio, ` or F1 debug.

### engine/renderer.ts
```ts
export function createRenderer(canvas: HTMLCanvasElement): Renderer;
```
Implements `Renderer` from types.ts. Integer-scales 480×270 to the window
(CSS transform on canvas). Tile drawing: procedural per tile type id —
`water` (animated 2-frame shimmer), `sand`, `grass`, `road`, `boardwalk`,
`marsh`, `rock`, `rail`, `floor_wood`, `floor_tile`, `wall`, `sidewalk`,
`dirt`, `pool`, `pool_empty`. Unknown tile types draw as checker so they're
visible. `text()` uses ui/font.ts. Fog = ordered 4×4 Bayer dither of color 3.
`nightOverlay` darkens with color 0 except radial holes (window light 15).

### engine/sprites.ts
```ts
export function getSprite(id: string): Sprite | null;
export interface Sprite { w: number; h: number; frames: number; data: Uint8Array /* palette idx, 255=transparent, frame-major */ }
export function spriteIds(): string[];
```
Sprites authored as string grids in this file (chars map to palette indices,
'.'=transparent). Required ids:
- NPCs (16×24, 2 frames): `npc_june npc_margie npc_sal npc_roz npc_petey
  npc_edith npc_cutter npc_amaral npc_gus npc_alma npc_second_gus npc_hutch`
- `player` (16×24, 2-frame walk ×4 directions = 8 frames: d0,d1,u0,u1,l0,l1,r0,r1)
- `cat` (12×10, 2 frames), `cat_tuxedo`
- `truck` (32×20), `boat` (24×14), `train` (repeatable 48×24 car)
- props (16×16 unless noted): `porch_chair flag_pole flag_folded buoy dinghy
  shutter valve meter door_boarded lantern_small mailbox hydrangea
  hydrangea_brown gull phone_booth bench telescope coffee_cup ledger_book
  lighthouse_lamp plow_truck(32x20) sign_town(24x16) casserole key papers
  radio_set stove bed table counter shelf pew altar plaque winch chain gate
  padlock pool_valve tape_note lamp_post lamp_post_off cottage_light`
Style: chunky, readable silhouettes, ≤6 colors per sprite, dark outline (0).

### engine/audio.ts
```ts
export function createAudio(): AudioEngine;
```
Implements `AudioEngine` (types.ts). All Web Audio synthesis, zero samples.
Stems (ids): `surf gulls wind traffic kids hvac halyards insects station`.
Each stem = looping synthesized source into its own GainNode → master.
`setStem` smooths over ~2s. One ConvolverReverb (generated impulse) send;
`setReverbTail` regenerates/crossfades impulse scaled. Radio: separate bus
with playback-rate + lowpass, fed by engine/music.ts sequencer. Foley cues
per list in types.ts. Keep master gain ~0.5, no clipping.

### engine/music.ts
```ts
export function createSequencer(ctxAudio: AudioContext, out: AudioNode): {
  play(song: SongDef, opts?: { rate?: number; lowpass?: number }): void;
  stop(): void;
  playing(): boolean;
  currentSongId(): string | null;
  update(dt: number): void;  // schedules ahead
};
```
Lookahead scheduler (~0.2s), square/triangle/saw/sine oscillators + noise
bursts for drums (midiPitch -1). Loops the song until stopped.

### engine/map.ts
```ts
export function compileMap(content: MapContent): CompiledMap;
export function zoneAt(map: CompiledMap, room: RoomId, pos: Vec): ZoneId | null;
export function anchorPos(map: CompiledMap, name: string): { room: RoomId; pos: Vec } | null;
export function isSolid(map: CompiledMap, room: RoomId, px: number, py: number): boolean;
```
Compiles declarative MapContent → tile arrays. Terrain default `grass`;
apply `terrain` cmds in order (rect fill or path stroke). Buildings paint
solid `wall` footprint + roof visual, carve a door tile, register door
teleports; windows drawn by renderer via building data. Props with
`solid:true` mark collision. Interiors: RoomDef → walls border + floor +
exit door. Anchors are tile-space in content, converted to pixel-space
centers in CompiledRoom. `isSolid` does pixel→tile lookup + solid props.

### systems/time.ts
```ts
export function updateTime(ctx: Ctx, dt: number): void;   // advances clock unless ctx.paused
export function clockStr(min: number): string;            // "16:10"
export function parseClock(s: string): number;            // "16:10" -> 970
export function phaseFor(day: number, clockMin: number): DayPhase;
export function sunsetMin(day: number): number;
export function isAfterSundown(state: GameState): boolean;
export function startDay(ctx: Ctx, day: number): void;    // rolls state to a new day: clock, phase, population, chores reset, emits dayStart
export function sleep(ctx: Ctx): void;                    // end-of-day: applies missed-chore debt, increments day or triggers day-9 resolution via story.checkEnding
```
`updateTime` emits `phaseChange` on transitions; at DAY_END_MIN forces
`sleep`. dt is real seconds; clock advances CLOCK_RATE game-min/sec in walk
mode only (ctx.paused true in dialogue/scene/menus).

### systems/palette.ts
```ts
export function paletteForDay(day: number, disruptionDebt: number): string[]; // 16 hex
export function fogDensity(state: GameState, zoneDebt?: number): number;      // 0..1
```
Day LUT: saturation ×(0.96^(day-1)) compounding, temperature shifts cold
(hue toward blue by ~1.5°/day), blacks lift (L floor +0.6%/day). Implement
via hex→HSL→hex. Deterministic pure function.

### systems/dialogue.ts
```ts
export function evalCond(state: GameState, expr: string): boolean;      // the flag DSL
export function condsMet(state: GameState, c?: DialogueConditions): boolean;
export function applyEffects(ctx: Ctx, e?: DialogueEffects): void;
export function bestNodeFor(ctx: Ctx, npc: NpcId): DialogueNode | null; // highest-priority matching node not seen (if oneShot)
export function nodeById(ctx: Ctx, id: string): DialogueNode | null;
export function linesFor(node: DialogueNode, day: number): string[];    // applies decaySchedule
export function barkFor(ctx: Ctx, poolId: string): string | null;      // applies decay; rng 'ambient'
```
`applyEffects` routes suspicion/trust deltas through systems/suspicion.ts,
emits bus events, handles giveKey/startChore/startScene/save.

### systems/schedule.ts
```ts
export function updateNpcs(ctx: Ctx, dt: number): void;
export function slotFor(ctx: Ctx, npc: NpcId): ScheduleSlot | null; // active slot for current day/clock
```
Moves NPCs toward their slot anchor (simple straight-line steering with
axis-aligned collision slide is fine — map is open; no A* needed if NPCs
teleport between rooms when off-screen: if NPC's target room ≠ current and
NPC not visible on screen, teleport to anchor. On-screen they walk).
Honors `deviation` set by director (deviation overrides slot). Gigi follows
player when `state.npcs.gigi.following`.

### systems/suspicion.ts
```ts
export function addSuspicion(ctx: Ctx, delta: number, reason?: string): void;
export function addTrust(ctx: Ctx, delta: number): void;                // June
export function addSignatoryTrust(ctx: Ctx, who: string, delta: number): void;
export function updateSuspicion(ctx: Ctx, dt: number): void;            // decay on clean days; late-night accrual; double-order tracking
export function suspicionTier(v: number): 0 | 1 | 2 | 3;                // <30,<60,<80,else
```
Late-night: out of house past 24:00 handled by forced sleep; past 22:30 in
blackrock/harbor/rockneck adds trickle. Double orders: flag
`bought_food_for_two` incremented by dialogue effects; at >=3, +5 suspicion
once and sets `roz_noticed_orders`.

### systems/chores.ts
```ts
export function todaysChores(ctx: Ctx): ChoreDef[];
export function activeChore(ctx: Ctx): ChoreDef | null;         // first incomplete today
export function choreState(ctx: Ctx, id: string): ChoreRecord;
export function startStep(ctx: Ctx, chore: ChoreDef, step: ChoreStep): void; // pushes minigame/meter UI or handles interact
export function onInteractTarget(ctx: Ctx, targetId: string): boolean; // called by game/interact.ts; returns true if consumed by active chore step
export function completeChore(ctx: Ctx, id: string): void;      // evaluates correctness[], applies debt, emits
export function applyEndOfDay(ctx: Ctx): void;                  // skipped chores -> disruptionOnSkip, emits choreMissed
export function updateChores(ctx: Ctx, dt: number): void;
```
Step flow: steps complete in order; `goto`/`interact` auto-advance;
`interact_sequence` tracks order; `hold_timing`/`carry`/`boat_task`/
`meter_read`/`switch` push ui/minigames or ui modes. Day-6 meter chore:
visiting June's cottage meter triggers the forgery choice **scene**
(`scene.d6.count_choice`) instead of the plain meter UI.

### systems/director.ts
```ts
export function planDay(ctx: Ctx): void;      // at dayStart: budget W, pick events, schedule ActiveEvents
export function updateDirector(ctx: Ctx, dt: number): void; // activation, cat tells, witnessing (viewport linger), escalation bookkeeping
export function eventDefById(ctx: Ctx, id: string): WrongnessEventDef | null;
```
Implements §7.3 exactly: W = DIRECTOR_BASE[day] + debt×DEBT_MULT; max
events/day = 2 + floor(day/3); no two same-district same-day before day 7;
never in room 'diner'; witnessed → next spawn from family escalates; cat
tell 10–40s early (stream `director:{day}`); placement uses anchors from
def.placement.anchors else zone anchors named `evt_*` in that zone.
NPC deviations: sets `npcs[x].deviation` for the day.

### systems/radio.ts
```ts
export function updateRadio(ctx: Ctx, dt: number): void; // plays playlist when radioOn && (in truck ui or near radio prop or at home), applies day rate/lowpass/static
export function radioTicker(ctx: Ctx): string | null;    // "WLNK 1290 — {song} — {patter}" for HUD
export function toggleRadio(ctx: Ctx): void;
```

### systems/story.ts
```ts
export function updateStory(ctx: Ctx, dt: number): void;  // beat triggers
export function startScene(ctx: Ctx, sceneId: string): void;
export function updateScene(ctx: Ctx, dt: number): void;  // executes SceneOps; ui/scenes renders
export function sceneActive(ctx: Ctx): boolean;
export function currentSlide(ctx: Ctx): { text: string } | null;
export function currentSceneText(ctx: Ctx): { speaker?: string; lines: string[]; choices?: { text: string }[]; selected: number } | null;
export function chooseSceneOption(ctx: Ctx, idx: number): void;
export function advanceScene(ctx: Ctx): void;             // on confirm press
export function checkEnding(ctx: Ctx): EndingId | null;   // §8.2 matrix, called on day 9 resolution points
```
Ending priority: last_train (susp>=90 + d8/d9 chores abandoned + on depot
platform night 9) > by_the_book (flag june_reported) > two_hundred_one
(trust>=70 + form12c_filed + count clean) > long_light (lantern refused past
midnight) > stowaway (doused with June hidden). Endings run as scenes with
`{op:'ending'}` which sets state.ending and shows epilogue slides then title.

### game/player.ts
```ts
export function updatePlayer(ctx: Ctx, dt: number): void; // movement, collision, footstep cues by surface, zone tracking flags
export function playerRect(state: GameState): Rect;
```
Speed ~70 px/s walk. Sets `state.flags.cur_zone` to current ZoneId/room.

### game/npc.ts
```ts
export function drawNpcs(ctx: Ctx, r: Renderer, cam: Camera): void;
export function npcAt(ctx: Ctx, pos: Vec, radius: number): NpcState | null; // nearest interactable NPC in player's room
```

### game/manifest.ts
```ts
export function drawEvents(ctx: Ctx, r: Renderer, cam: Camera): void;   // draw active event manifestations (prop_add etc.)
export function eventAt(ctx: Ctx, pos: Vec, radius: number): ActiveEvent | null; // for examine
export function applyAudioEvents(ctx: Ctx): void;                        // audio_cue / ambient_mute manifestations
```

### game/interact.ts
```ts
export function findInteractable(ctx: Ctx): Interactable | null;
export interface Interactable { kind: 'npc'|'prop'|'door'|'chore'|'event'|'travel'|'bed'|'radio'; id: string; label: string; pos: Vec }
export function doInteract(ctx: Ctx, it: Interactable): void;
```
Priority: chore target > npc > event > prop > door. Doors check `locked`
against state.keys (locked shows toast via strings.json). Truck = travel
mode (ui/travel). Bed = sleep confirm. Interacting with June's cottage door
before day flags allow → examine text from content.

### game/game.ts
```ts
export class Game {
  constructor(canvas: HTMLCanvasElement);
  start(): void;   // builds ctx, title screen, then per-frame update/render
}
```
Owns: Ctx construction, UI mode stack, frame loop order:
input → (mode-specific update: title/walk/dialogue/scene/minigame/...) →
time → schedules → director → suspicion → chores → radio → story → audio
mix (applyDayMix below) → render. Renders world (tiles, props, buildings,
events, npcs, player, train), then overlays (night, fog, letterbox), then
HUD, then mode UIs, then debug pane. Also owns the **train system** (§4.2
scripted ladder: schedule table per day; draws train + horn/crossing cues;
day 7–8 audio-only; day 9 silent pass) and **boardwalk lights** (9 lamp
sections; dusk shutdown interaction chore D5+; thunk cue; lamp sprites off).
Day mix: per-day stem levels table + subtraction (audio.subtracted) +
zone-local mutes from events; reverb tail shrink day 9.

### main.ts
Canvas setup, `new Game(canvas).start()`, handles first-gesture
`audio.unlock()`, window resize integer scaling.

### ui/font.ts
```ts
export function drawText(ctx2d: CanvasRenderingContext2D, s: string, x: number, y: number, color: string, opts?: { serif?: boolean; maxWidth?: number }): number; // returns width drawn
export function measure(s: string, serif?: boolean): number;
```
Two tiny bitmap fonts defined in-code as 5×7 (DIN-ish caps+lowercase+digits+
punct) and 6×8 "worn serif". No canvas font strings — bitmap only.

### ui/hud.ts
```ts
export function drawHud(ctx: Ctx, r: Renderer): void;
```
Population sign (top-right, `LANTERN NECK · POP. ####`), clock + day
(top-left), current checklist item hint (bottom-left, small), interact
prompt, radio ticker when playing, toasts.

### ui/checklist.ts
```ts
export function drawChecklist(ctx: Ctx, r: Renderer): void;   // laminated card w/ coffee ring, items 1..9, item 9 illegible until day>=8 (render as worn glyph boxes)
export function updateChecklist(ctx: Ctx): void;              // input: close on cancel/checklist key
```

### ui/dialoguebox.ts
```ts
export function startDialogue(ctx: Ctx, opts: { node?: string; npc?: NpcId }): void;
export function updateDialogue(ctx: Ctx, dt: number): void;
export function drawDialogue(ctx: Ctx, r: Renderer): void;
export function dialogueActive(ctx: Ctx): boolean;
```
Typewriter text (fast), portrait-less, speaker name tag, choice list nav.
Marks oneShot seen, applies effects via systems/dialogue.applyEffects,
follows goto chains.

### ui/scenes.ts
```ts
export function drawScene(ctx: Ctx, r: Renderer): void; // slides, letterbox text, fades — renders systems/story's current scene state
```

### ui/minigames.ts
```ts
export function startMinigame(ctx: Ctx, kind: ChoreStepType, chore: ChoreDef, step: ChoreStep): void;
export function updateMinigame(ctx: Ctx, dt: number): void;
export function drawMinigame(ctx: Ctx, r: Renderer): void;
export function minigameActive(ctx: Ctx): boolean;
```
- hold_timing: vertical bar, marker oscillates, release in band; difficulty
  narrows band. 3 successes = done.
- meter_read: dial face + digits; confirm logs reading (chore handles June
  cottage special case BEFORE pushing this UI).
- switch: hold interact 2s → heavy thunk + white flash → done.
- boat_task/carry/interact_sequence are world-side (chores.ts), not here.

### ui/ledger.ts
```ts
export function drawLedger(ctx: Ctx, r: Renderer): void;   // the book UI: 200 lines abstracted, page footer, the blank 201st line; Form 12-C filing when flags allow
export function updateLedger(ctx: Ctx): void;
```

### ui/travel.ts
```ts
export function startTravel(ctx: Ctx): void;    // truck destination menu (anchors tagged travel_*)
export function updateTravel(ctx: Ctx): void;
export function drawTravel(ctx: Ctx, r: Renderer): void;
```
Traveling advances clock 5–10 min, plays truck+radio ambience.

### ui/title.ts
```ts
export function updateTitle(ctx: Ctx): { action: 'new' | 'continue' | null; seed?: number };
export function drawTitle(ctx: Ctx, r: Renderer): void;
```
Title: game name, New/Continue, seed entry in debug mode only.

### ui/debugpane.ts
```ts
export function updateDebug(ctx: Ctx): void;
export function drawDebug(ctx: Ctx, r: Renderer): void;
```
`?debug=1` or toggle key: day warp (with proper startDay), clock scrub,
budget/debt/suspicion/trust readout+edit, teleport to zone, flag list,
seed display, director planned-events list, "Day 7 mode" contrast toggle
(forces day-7 palette/mix/decay while staying day 1 — M1 requirement).

### tools/validate-content.mjs
Node script, no deps: loads every content JSON, checks:
- schema shape (hand-rolled checks, clear error messages with file+path)
- every dialogue goto/startScene/startChore resolves
- every schedule anchor/room exists in map content
- every chore target/anchor exists; chore days 1..9 covered exactly
- every event manifest anchor/zone exists; tags known; escalatesTo resolves
- every song id in playlists exists; every scene id in beats exists
- bark pool refs resolve
Exit 1 with a readable list of problems; 0 clean. Also exported as a
function for the vitest suite.

## Render order (game.ts)

tiles → props/buildings (y-sorted with actors) → events → npcs → player →
train → weather/night/fog → letterbox → HUD → active UI mode → debug.

## The train (scripted, in game.ts)

Passes at fixed clock times: [08:10, 10:40, 13:05, 15:30, 17:50, 20:15].
Stops at depot (boardwalk anchor `depot_platform`) on days 1–3 at 10:40 &
17:50. Days 4–6: passes, no stop, departure board blank. Days 7–8: horn +
rail hum cues at pass times, **no sprite**. Day 9: one silent pass at 17:50,
sprite drawn, zero audio. Suspicion/story hooks: standing on depot platform
night 9 with conditions → ending check (last_train).

## Boardwalk lights (game.ts + chores)

9 lamp sections along the boardwalk, each ~10 lamps. From D5 dusk, the
day's chore includes shutting the day's section via its panel (interact →
hold 1s → THUNK, section lamps off permanently, `lightsOut` push, bus
event). Sections shut in order 1..9; D5 shuts 1, D6 → 2, D7 → 3, D8 → 4,
and D9 pre-Point shuts 5–8 in one go (scripted), Lantern is item 9.
Wait — bible says one per night from D5: D5..D8 = sections 1–4? No: sections
1..9 with "one section per night, in order, at dusk exactly" starting D5
gives 5 nights (D5–D9) for 9 sections: shut TWO per night D5–D8 (sections
1+2, 3+4, 5+6, 7+8) and the 9th at the Point on D9 before the Lantern.
Content defines this pacing in chores JSON (`targets` per day); engine just
processes panel targets. Correctness: at dusk (±40 min), in order.

## Day audio mix table (game.ts applyDayMix)

Base levels by day (0–1), before event mutes; stems absent = 0:
```
stem      D1   D2   D3   D4   D5   D6   D7   D8   D9
surf     .8   .8   .75  .7   .65  .6   .5   .45  .35
gulls    .7   .65  .6   .45  .3   .2   0    0    0
wind     .5   .5   .5   .55  .55  .5   .45  .3   0
traffic  .4   .15  0    0    0    0    0    0    0
kids     .3   0    0    0    0    0    0    0    0
hvac     .3   .3   .3   .25  .2   .2   .15  .1   0
halyards .5   .5   .45  .4   .3   .25  .2   .1   0
insects  .5   .5   .5   .45  .4   [cut mid-loop D6, audibly, once, outdoors]
station  .12  .14  .16  .18  .22  .26  .3   .34  .4
```
Indoor rooms: outdoor stems ×0.25, hvac ×1.5. High-debt: subtract earlier
(shift one day ahead per 3 debt). Day 9 reverb tail 0.4×.

## Integration order (for the composition root)

`main.ts` → `Game.start()`:
1. `loadContent()` → validate lite (throw on missing core files)
2. `compileMap(content.map)`
3. title → `newGame(seed)` or `loadGame()`
4. per-frame as specified in game/game.ts contract above.

## Testing (vitest, /tests)

- `prng.test.ts` — determinism, stream independence
- `director.test.ts` — same seed+state ⇒ identical plan; placement rules hold on synthetic content
- `palette.test.ts` — day 1 = base palette; monotonic desaturation
- `content.test.ts` — runs tools/validate-content checks
- `story.test.ts` — checkEnding matrix truth table (synthetic states)
