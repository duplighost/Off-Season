/**
 * The composition root. Owns the Ctx, the UI-mode stack, the frame loop, the
 * render order, the scripted train, the boardwalk lights, the per-day audio
 * mix, and the night/fog/palette passes. Everything else is a system it calls.
 */

import type {
  Bus,
  BusEvent,
  Camera,
  CompiledMap,
  ContentBundle,
  Ctx,
  GameState,
  UiMode,
} from '../types';
import { DIRECTOR_BASE, SCREEN_H, SCREEN_W, TILE } from '../types';

import { makeRngFactory } from '../engine/prng';
import { loadContent } from '../engine/assets';
import { compileMap, anchorPos } from '../engine/map';
import { createRenderer } from '../engine/renderer';
import { createInput } from '../engine/input';
import { createAudio } from '../engine/audio';
import { newGame, loadGame, saveGame } from '../engine/save';

import { updateTime, startDay, sunsetMin, clockStr } from '../systems/time';
import { updateNpcs } from '../systems/schedule';
import { updateDirector } from '../systems/director';
import { updateSuspicion, applyDailySuspicionDecay } from '../systems/suspicion';
import { updateChores } from '../systems/chores';
import { updateRadio } from '../systems/radio';
import { updateStory, updateScene, sceneActive, startScene as storyStartScene } from '../systems/story';
import { toggleRadio } from '../systems/radio';
import { paletteForDay, fogDensity } from '../systems/palette';

import { updatePlayer, playerFrame } from './player';
import { drawNpcs } from './npc';
import { drawEvents, suppressedProps, eventLights, mutedStems, applyAudioEvents } from './manifest';
import { findInteractable, doInteract } from './interact';

import { updateDialogue, drawDialogue, startDialogue, dialogueActive } from '../ui/dialoguebox';
import { drawScene } from '../ui/scenes';
import { updateMinigame, drawMinigame } from '../ui/minigames';
import { drawChecklist, updateChecklist } from '../ui/checklist';
import { drawLedger, updateLedger } from '../ui/ledger';
import { updateTravel, drawTravel } from '../ui/travel';
import { updateTitle, drawTitle } from '../ui/title';
import { updateDebug, drawDebug } from '../ui/debugpane';
import { drawHud, pushToast, updateToasts } from '../ui/hud';
import { advanceScene, moveSceneCursor } from '../systems/story';

// --- day audio mix table (ARCHITECTURE.md) --------------------------------
// indices [day] 1..9; day 0 unused.
const MIX: Record<string, number[]> = {
  surf:     [0, .8, .8, .75, .7, .65, .6, .5, .45, .35],
  gulls:    [0, .7, .65, .6, .45, .3, .2, 0, 0, 0],
  wind:     [0, .5, .5, .5, .55, .55, .5, .45, .3, 0],
  traffic:  [0, .4, .15, 0, 0, 0, 0, 0, 0, 0],
  kids:     [0, .3, 0, 0, 0, 0, 0, 0, 0, 0],
  hvac:     [0, .3, .3, .3, .25, .2, .2, .15, .1, 0],
  halyards: [0, .5, .5, .45, .4, .3, .25, .2, .1, 0],
  insects:  [0, .5, .5, .5, .45, .4, 0, 0, 0, 0],
  station:  [0, .12, .14, .16, .18, .22, .26, .3, .34, .4],
};

const TRAIN_TIMES = ['08:10', '10:40', '13:05', '15:30', '17:50', '20:15'];
const TRAIN_STOP_TIMES = new Set(['10:40', '17:50']);

interface TrainRun {
  x: number;
  speed: number;
  hasSprite: boolean;
  hasAudio: boolean;
  stopping: boolean;
  stopped: number; // seconds held at depot
  hornDone: boolean;
}

export class Game {
  private canvas: HTMLCanvasElement;
  private renderer;
  private input;
  private audio;
  private content: ContentBundle;
  private map: CompiledMap;
  private state!: GameState;
  private ctx!: Ctx;
  private bus: Bus;
  private modeStack: UiMode[] = ['title'];
  private last = 0;
  private train: TrainRun | null = null;
  private lastTrainCheck = 0;
  private railY = 0;
  private started = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = createRenderer(canvas);
    this.input = createInput(canvas);
    this.audio = createAudio();
    this.content = loadContent();
    this.map = compileMap(this.content.map);
    this.bus = makeBus();
  }

  start(): void {
    // Boot into the title screen; real state is created on New/Continue.
    this.state = newGame(88291);
    this.ctx = this.buildCtx();
    this.registerBusListeners();
    // Debug affordance: expose the live instance (harmless in production).
    (window as unknown as { __game: Game }).__game = this;
    // rail line: just north of the depot platform.
    const depot = anchorPos(this.map, 'depot_platform');
    this.railY = depot ? depot.pos.y - 10 : 40 * TILE;

    const loop = (t: number) => {
      const dt = Math.min(0.05, this.last ? (t - this.last) / 1000 : 0.016);
      this.last = t;
      try {
        this.frame(dt);
      } catch (e) {
        console.error('[game] frame error', e);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private get mode(): UiMode {
    return this.modeStack[this.modeStack.length - 1];
  }

  private buildCtx(): Ctx {
    const self = this;
    const ui = {
      get mode(): UiMode {
        return self.mode;
      },
      push(m: UiMode) {
        self.modeStack.push(m);
      },
      pop() {
        if (self.modeStack.length > 1) self.modeStack.pop();
      },
      startDialogue(opts: { node?: string; npc?: any }) {
        startDialogue(self.ctx, opts);
      },
      startScene(id: string) {
        // Route to the story system, which sets up the VM and pushes 'scene'.
        // Imported lazily to avoid a cycle at module init.
        storyStartScene(self.ctx, id);
      },
      toast(msg: string) {
        pushToast(msg);
      },
    };
    return {
      state: this.state,
      content: this.content,
      map: this.map,
      rng: makeRngFactory(this.state.seed),
      bus: this.bus,
      audio: this.audio,
      input: this.input.state,
      ui: ui as any,
      paused: false,
      debug: new URLSearchParams(location.search).has('debug'),
    };
  }

  private registerBusListeners(): void {
    this.bus.on('dayStart', () => {
      applyDailySuspicionDecay(this.ctx);
      this.applyDayMix(true);
    });
    this.bus.on('lightSectionOut', () => {
      this.audio.cue('thunk', { volume: 1 });
    });
    this.bus.on('endingReached', () => {
      saveGame(this.state);
    });
  }

  // -----------------------------------------------------------------------
  // Frame
  // -----------------------------------------------------------------------

  private frame(dt: number): void {
    const ctx = this.ctx;
    ctx.state = this.state;
    ctx.input = this.input.state;
    ctx.debug = new URLSearchParams(location.search).has('debug') || !!this.state.flags._debug_on;

    // global toggles
    if (this.input.state.debugPressed && this.mode !== 'title') {
      if (this.mode === 'debug') this.modeStack.pop();
      else this.modeStack.push('debug');
    }

    const modal =
      this.mode === 'dialogue' ||
      this.mode === 'scene' ||
      this.mode === 'minigame' ||
      this.mode === 'meter' ||
      this.mode === 'ending';
    ctx.paused = modal || this.mode !== 'walk';

    this.updateMode(dt);

    // Systems only run in walk mode (clock frozen otherwise), except audio.
    if (this.mode === 'walk' && !this.state.ending) {
      updateTime(ctx, dt);
      updatePlayer(ctx, dt);
      updateNpcs(ctx, dt);
      updateDirector(ctx, dt);
      updateSuspicion(ctx, dt);
      updateChores(ctx, dt);
      updateStory(ctx, dt);
      // handle a scene-requested teleport
      this.resolveSceneTeleport();
    }
    // Scene VM advances even while paused.
    if (sceneActive(ctx)) updateScene(ctx, dt);

    updateRadio(ctx, dt);
    this.updateTrain(dt);
    this.applyDayMix(false);
    applyAudioEvents(ctx);
    this.audio.update(dt);
    updateToasts(dt);

    this.render();
    this.input.update();
  }

  private updateMode(dt: number): void {
    const ctx = this.ctx;
    switch (this.mode) {
      case 'title': {
        const res = updateTitle(ctx);
        if (res.action === 'new') {
          this.state = newGame(res.seed ?? 88291);
          this.ctx.state = this.state;
          this.ctx.rng = makeRngFactory(this.state.seed);
          this.snapPlayerHome();
          startDay(this.ctx, 1);
          this.modeStack = ['walk'];
          this.audio.unlock();
        } else if (res.action === 'continue') {
          const loaded = loadGame();
          if (loaded) {
            this.state = loaded;
            this.ctx.state = this.state;
            this.ctx.rng = makeRngFactory(this.state.seed);
            this.modeStack = ['walk'];
            this.audio.unlock();
          }
        }
        break;
      }
      case 'walk':
        this.updateWalk();
        break;
      case 'dialogue':
        updateDialogue(ctx, dt);
        if (!dialogueActive(ctx) && this.mode === 'dialogue') this.modeStack.pop();
        break;
      case 'scene':
        this.updateSceneInput();
        break;
      case 'checklist':
        updateChecklist(ctx);
        break;
      case 'minigame':
      case 'meter':
        updateMinigame(ctx, dt);
        break;
      case 'ledger':
        updateLedger(ctx);
        break;
      case 'travel':
        updateTravel(ctx);
        break;
      case 'debug':
        updateDebug(ctx);
        break;
      case 'ending':
        this.updateSceneInput();
        break;
    }
  }

  private updateWalk(): void {
    const ctx = this.ctx;
    const i = this.input.state;
    if (i.checklistPressed) {
      this.modeStack.push('checklist');
      return;
    }
    if (i.radioPressed) {
      // R toggles radio directly when not near a set
      toggleRadio(ctx);
      return;
    }
    if (i.interactPressed || i.confirmPressed) {
      const it = findInteractable(ctx);
      if (it) doInteract(ctx, it);
    }
  }

  private updateSceneInput(): void {
    const i = this.input.state;
    if (i.upPressed) moveSceneCursor(-1);
    if (i.downPressed) moveSceneCursor(1);
    if (i.confirmPressed || i.interactPressed) advanceScene(this.ctx);
  }

  private snapPlayerHome(): void {
    const bed = anchorPos(this.map, 'wren_bed');
    const home = bed ?? anchorPos(this.map, 'wren_home_door');
    if (home) {
      this.state.player.room = home.room;
      this.state.player.pos = { ...home.pos };
    }
  }

  private resolveSceneTeleport(): void {
    const tp = this.state.flags._scene_teleport;
    if (typeof tp === 'string') {
      const [, anchor] = tp.split(':');
      const p = anchorPos(this.map, anchor);
      if (p) {
        this.state.player.room = p.room;
        this.state.player.pos = { ...p.pos };
      }
      delete this.state.flags._scene_teleport;
    }
  }

  // -----------------------------------------------------------------------
  // Train (§4.2)
  // -----------------------------------------------------------------------

  private updateTrain(dt: number): void {
    const s = this.state;
    // trigger check: crossing a pass time
    const nowMin = s.clockMin;
    if (this.mode === 'walk' && !this.train) {
      for (const tt of TRAIN_TIMES) {
        const [hh, mm] = tt.split(':').map(Number);
        const m = hh * 60 + mm;
        if (this.lastTrainCheck < m && nowMin >= m) {
          this.spawnTrain(tt);
          break;
        }
      }
    }
    this.lastTrainCheck = nowMin;

    if (this.train) {
      const tr = this.train;
      if (tr.hasAudio && !tr.hornDone) {
        this.audio.cue('train_horn');
        this.audio.cue('crossing_bell');
        tr.hornDone = true;
      }
      if (tr.stopping && Math.abs(tr.x - (this.depotX())) < 6 && tr.stopped < 20) {
        tr.stopped += dt;
        if (tr.stopped >= 20) tr.stopping = false;
      } else {
        tr.x += tr.speed * dt;
      }
      const townW = this.map.rooms.town ? this.map.rooms.town.width * TILE : 120 * TILE;
      if (tr.x > townW + 120) this.train = null;
    }
  }

  private depotX(): number {
    const depot = anchorPos(this.map, 'depot_platform');
    return depot ? depot.pos.x : 60 * TILE;
  }

  private spawnTrain(tt: string): void {
    const day = this.state.day;
    let hasSprite = true;
    let hasAudio = true;
    if (day >= 4 && day <= 6) {
      // passes, no stop; departure board blank flag
      this.state.flags.depot_board_blank = true;
    }
    if (day === 7 || day === 8) {
      hasSprite = false; // heard, not seen
      hasAudio = true;
    }
    if (day === 9) {
      if (tt !== '17:50') return; // only one pass
      hasSprite = true;
      hasAudio = false; // total silence
    }
    const stopping = day <= 3 && TRAIN_STOP_TIMES.has(tt);
    this.train = {
      x: -120,
      speed: 90,
      hasSprite,
      hasAudio,
      stopping,
      stopped: 0,
      hornDone: false,
    };
  }

  // -----------------------------------------------------------------------
  // Audio mix (§7.7)
  // -----------------------------------------------------------------------

  private applyDayMix(_dayStart: boolean): void {
    const s = this.state;
    const day7 = !!s.flags._day7_mode;
    const day = day7 ? 7 : Math.min(9, Math.max(1, s.day));
    const indoor = s.player.room !== 'town';
    const muted = mutedStems(this.ctx);
    // debt accelerates subtraction: shift one day ahead per 3 debt.
    const shift = Math.floor(s.disruptionDebt / 3);
    const effDay = Math.min(9, day + shift);

    for (const stem of Object.keys(MIX)) {
      let level = MIX[stem][effDay] ?? 0;
      // insects: hard mid-loop cut on day 6, once, outdoors, 14:00-16:00
      if (stem === 'insects' && day >= 6 && !s.flags._insects_cut) {
        if (!indoor && s.clockMin >= 14 * 60 && s.clockMin <= 16 * 60) {
          s.flags._insects_cut = true;
        }
      }
      if (stem === 'insects' && s.flags._insects_cut) level = 0;
      if (indoor) {
        level *= stem === 'hvac' ? 1.5 : 0.25;
      }
      if (muted.has(stem)) level = 0;
      this.audio.setStem(stem, Math.min(1, level));
    }
    this.audio.setReverbTail(day >= 9 ? 0.4 : 1);
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  private render(): void {
    const r = this.renderer;
    const ctx = this.ctx;

    if (this.mode === 'title') {
      r.setPalette(paletteForDay(1, 0));
      r.begin({ x: 0, y: 0 });
      drawTitle(ctx, r);
      r.end();
      return;
    }

    const s = this.state;
    const day7 = !!s.flags._day7_mode;
    const palDay = day7 ? 7 : s.day;
    r.setPalette(paletteForDay(palDay, s.disruptionDebt));

    const cam = this.camera();
    r.begin(cam);

    const room = this.map.rooms[s.player.room];
    if (room) this.drawRoom(room, cam);

    // events (prop_add / prop_swap)
    drawEvents(ctx, r, cam);

    // train behind actors if on the rail line (north of player mostly)
    this.drawTrain(cam);

    // npcs + player, y-sorted amongst themselves; player drawn by baseline
    drawNpcs(ctx, r, cam);
    this.drawPlayer(cam);

    // night + fog
    this.drawNight(cam);
    r.fog(fogDensity(s));

    // --- screen-space UI (rect/text/frame ignore the camera) ---
    // NOTE: begin() clears the frame, so it must be called exactly once. The
    // world pass above and this UI pass share the same begin()/end().
    if (this.mode !== 'scene' && this.mode !== 'ending') drawHud(ctx, r);

    switch (this.mode) {
      case 'dialogue': drawDialogue(ctx, r); break;
      case 'scene':
      case 'ending': drawScene(ctx, r); break;
      case 'checklist': drawChecklist(ctx, r); break;
      case 'minigame':
      case 'meter': drawMinigame(ctx, r); break;
      case 'ledger': drawLedger(ctx, r); break;
      case 'travel': drawTravel(ctx, r); break;
    }
    // debug overlays on top of everything
    if (this.modeStack.includes('debug')) drawDebug(ctx, r);
    r.end();
  }

  private camera(): Camera {
    const s = this.state;
    const room = this.map.rooms[s.player.room];
    const w = room ? room.width * TILE : SCREEN_W;
    const h = room ? room.height * TILE : SCREEN_H;
    let x = Math.round(s.player.pos.x - SCREEN_W / 2);
    let y = Math.round(s.player.pos.y - SCREEN_H / 2);
    x = Math.max(0, Math.min(x, Math.max(0, w - SCREEN_W)));
    y = Math.max(0, Math.min(y, Math.max(0, h - SCREEN_H)));
    return { x, y };
  }

  private drawRoom(room: CompiledMap['rooms'][string], cam: Camera): void {
    const r = this.renderer;
    const x0 = Math.max(0, Math.floor(cam.x / TILE));
    const y0 = Math.max(0, Math.floor(cam.y / TILE));
    const x1 = Math.min(room.width, Math.ceil((cam.x + SCREEN_W) / TILE) + 1);
    const y1 = Math.min(room.height, Math.ceil((cam.y + SCREEN_H) / TILE) + 1);
    for (let ty = y0; ty < y1; ty++) {
      for (let tx = x0; tx < x1; tx++) {
        const t = room.tiles[ty * room.width + tx];
        if (t) r.drawTile(t, tx * TILE, ty * TILE);
      }
    }

    // building roofs / bodies are baked into 'wall' tiles; draw windows via
    // night pass. Props (y-sorted with a simple pass — props are small):
    const suppressed = suppressedProps(this.ctx);
    const props = room.props.slice().sort((a, b) => a.y - b.y);
    for (const p of props) {
      if (suppressed.has(p.id)) continue;
      if (p.sprite === 'lamp_post') {
        const section = lampSection(p.id);
        const off = section > 0 && this.state.lightsOut.includes(section);
        r.drawSprite(off ? 'lamp_post_off' : 'lamp_post', p.x * TILE, p.y * TILE - (32 - TILE));
        continue;
      }
      r.drawSprite(p.sprite, p.x * TILE, p.y * TILE - (spriteTall(p.sprite) ? 8 : 0));
    }
  }

  private drawPlayer(cam: Camera): void {
    const r = this.renderer;
    const s = this.state;
    const frame = playerFrame(s);
    const wx = Math.round(s.player.pos.x - 8);
    const wy = Math.round(s.player.pos.y - 24 + 4); // feet a touch below pos
    r.drawSprite('player', wx, wy, { frame });
    void cam;
  }

  private drawTrain(cam: Camera): void {
    if (!this.train || !this.train.hasSprite) return;
    if (this.state.player.room !== 'town') return;
    const r = this.renderer;
    // three cars
    for (let i = 0; i < 3; i++) {
      r.drawSprite('train', Math.round(this.train.x + i * 48), Math.round(this.railY - 24));
    }
    void cam;
  }

  private drawNight(cam: Camera): void {
    const r = this.renderer;
    const s = this.state;
    // Interiors are lit by their own ambient; the outdoor night model only
    // applies to the town map.
    if (s.player.room !== 'town') return;
    const day7 = !!s.flags._day7_mode;
    const day = day7 ? 7 : s.day;
    const sunset = sunsetMin(day);
    // Daylight until sunset; then darkness ramps over the following hour and
    // holds through the night. (September mornings are postcard-bright.)
    let darkness = 0;
    if (s.clockMin >= sunset) {
      darkness = Math.min(0.82, (s.clockMin - sunset) / 55 + 0.08);
    }
    if (darkness <= 0.02) return;

    const lights: { x: number; y: number; r: number }[] = [];
    const room = this.map.rooms[s.player.room];
    if (room) {
      // building windows whose lightFlag is set (or unconditional at night)
      for (const b of room.buildings) {
        for (const win of b.windows ?? []) {
          const lit = !win.lightFlag || !!s.flags[win.lightFlag];
          if (lit) lights.push({ x: win.x * TILE + TILE / 2, y: win.y * TILE + TILE / 2, r: 22 });
        }
      }
      // boardwalk lamps still burning
      for (const p of room.props) {
        if (p.sprite === 'lamp_post') {
          const section = lampSection(p.id);
          if (!(section > 0 && s.lightsOut.includes(section))) {
            lights.push({ x: p.x * TILE + TILE / 2, y: p.y * TILE - 10, r: 16 });
          }
        }
      }
    }
    // event lights (a window lit that shouldn't be, etc.)
    for (const L of eventLights(this.ctx)) lights.push(L);

    r.nightOverlay(darkness, lights, cam);

    // The Station across the water: aviation reds that never close.
    if (s.player.room === 'town') {
      const blink = Math.floor(s.clockMin) % 2 === 0;
      r.rect(SCREEN_W - 30, 30, 2, 2, 15, 0.6);
      r.rect(SCREEN_W - 24, 30, 2, 2, 15, 0.6);
      if (blink) r.rect(SCREEN_W - 27, 26, 2, 2, 14, 0.8);
    }
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function lampSection(id: string): number {
  // ids look like lamp_s{section}_{i}
  const m = /lamp_s(\d+)_/.exec(id);
  return m ? parseInt(m[1], 10) : 0;
}

function spriteTall(sprite: string): boolean {
  return sprite === 'flag_pole' || sprite === 'phone_booth' || sprite === 'lighthouse';
}

function makeBus(): Bus {
  const listeners: Record<string, ((e: BusEvent) => void)[]> = {};
  return {
    emit(e: BusEvent) {
      for (const fn of listeners[e.type] ?? []) fn(e);
    },
    on(type: BusEvent['type'], fn: (e: BusEvent) => void) {
      (listeners[type] ??= []).push(fn);
      return () => {
        const arr = listeners[type];
        const i = arr.indexOf(fn);
        if (i >= 0) arr.splice(i, 1);
      };
    },
  };
}

// silence unused-import warnings for values referenced only in types
void DIRECTOR_BASE;
void clockStr;
