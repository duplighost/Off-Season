/**
 * The audio engine (§7.7, §11) — the Subtraction System's instrument.
 *
 * Everything is synthesized; there are no audio samples anywhere in the game.
 * Ambient stems loop forever at gain 0 until setStem raises them (smoothed).
 * The signature move is subtraction: as days pass, game.ts lowers stems, and
 * the world gets quieter and wronger. The Station hum is the one constant.
 */

import type { AudioEngine, SongDef } from '../types';
import { createSequencer } from './music';

const STEMS = ['surf', 'gulls', 'wind', 'traffic', 'kids', 'hvac', 'halyards', 'insects', 'station'];

/** Small deterministic LCG so ambient flavor never touches Math.random. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function createAudio(): AudioEngine {
  let ac: AudioContext | null = null;
  let master: GainNode | null = null;
  let reverb: ConvolverNode | null = null;
  let reverbGain: GainNode | null = null;
  let radioBus: GainNode | null = null;
  let radioFilter: BiquadFilterNode | null = null;
  let seq: ReturnType<typeof createSequencer> | null = null;

  const stemGains: Record<string, GainNode> = {};
  const stemTargets: Record<string, number> = {};
  const stemLevels: Record<string, number> = {};
  const stemNodes: AudioScheduledSourceNode[] = [];

  let staticSrc: AudioBufferSourceNode | null = null;
  let unlocked = false;

  function noiseBuffer(seconds: number, seed: number): AudioBuffer {
    const len = Math.floor(44100 * seconds);
    const buf = ac!.createBuffer(1, len, 44100);
    const d = buf.getChannelData(0);
    const rnd = lcg(seed);
    let last = 0;
    for (let i = 0; i < len; i++) {
      // brownish noise
      const white = rnd() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.5;
    }
    return buf;
  }

  function impulse(seconds: number, seed: number): AudioBuffer {
    const len = Math.max(1, Math.floor(44100 * seconds));
    const buf = ac!.createBuffer(2, len, 44100);
    const rnd = lcg(seed);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / len, 2.5);
      }
    }
    return buf;
  }

  function buildStems(): void {
    if (!ac || !master) return;
    const now = ac.currentTime;
    for (const name of STEMS) {
      const g = ac.createGain();
      g.gain.value = 0;
      g.connect(master);
      stemGains[name] = g;
      stemTargets[name] = 0;
      stemLevels[name] = 0;

      if (name === 'station') {
        const o = ac.createOscillator();
        o.type = 'sine';
        o.frequency.value = 55;
        const o2 = ac.createOscillator();
        o2.type = 'sine';
        o2.frequency.value = 55.4; // slow beat frequency
        const mix = ac.createGain();
        mix.gain.value = 0.5;
        o.connect(mix);
        o2.connect(mix);
        mix.connect(g);
        o.start(now);
        o2.start(now);
        stemNodes.push(o, o2);
      } else if (name === 'hvac') {
        const o = ac.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = 60;
        const lp = ac.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 200;
        o.connect(lp);
        lp.connect(g);
        o.start(now);
        stemNodes.push(o);
      } else if (name === 'insects') {
        const o = ac.createOscillator();
        o.type = 'square';
        o.frequency.value = 5200;
        const bp = ac.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 5000;
        bp.Q.value = 8;
        const trem = ac.createGain();
        trem.gain.value = 0.15;
        const lfo = ac.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 12;
        const lfoGain = ac.createGain();
        lfoGain.gain.value = 0.12;
        lfo.connect(lfoGain);
        lfoGain.connect(trem.gain);
        o.connect(bp);
        bp.connect(trem);
        trem.connect(g);
        o.start(now);
        lfo.start(now);
        stemNodes.push(o, lfo);
      } else {
        // noise-based stems: surf/gulls/wind/traffic/kids/halyards
        const src = ac.createBufferSource();
        src.buffer = noiseBuffer(4, 1000 + name.length * 7);
        src.loop = true;
        const filt = ac.createBiquadFilter();
        if (name === 'surf') {
          filt.type = 'lowpass';
          filt.frequency.value = 600;
          const lfo = ac.createOscillator();
          lfo.frequency.value = 0.12;
          const lg = ac.createGain();
          lg.gain.value = 300;
          lfo.connect(lg);
          lg.connect(filt.frequency);
          lfo.start(now);
          stemNodes.push(lfo);
        } else if (name === 'wind') {
          filt.type = 'lowpass';
          filt.frequency.value = 400;
        } else if (name === 'traffic') {
          filt.type = 'lowpass';
          filt.frequency.value = 180;
        } else if (name === 'kids') {
          filt.type = 'bandpass';
          filt.frequency.value = 900;
          filt.Q.value = 2;
        } else if (name === 'gulls') {
          filt.type = 'highpass';
          filt.frequency.value = 1500;
        } else if (name === 'halyards') {
          filt.type = 'bandpass';
          filt.frequency.value = 2200;
          filt.Q.value = 6;
        }
        src.connect(filt);
        filt.connect(g);
        src.start(now);
        stemNodes.push(src);
      }
    }
  }

  async function unlock(): Promise<void> {
    if (unlocked) return;
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = 0.5;
    master.connect(ac.destination);

    reverbGain = ac.createGain();
    reverbGain.gain.value = 0.18;
    reverb = ac.createConvolver();
    reverb.buffer = impulse(1.6, 7);
    reverb.connect(reverbGain);
    reverbGain.connect(master);

    radioBus = ac.createGain();
    radioBus.gain.value = 0.9;
    radioFilter = ac.createBiquadFilter();
    radioFilter.type = 'lowpass';
    radioFilter.frequency.value = 8000;
    radioFilter.connect(radioBus);
    radioBus.connect(master);
    seq = createSequencer(ac, radioFilter);

    buildStems();
    if (ac.state === 'suspended') await ac.resume();
    unlocked = true;
  }

  function setStem(stem: string, level: number): void {
    stemTargets[stem] = Math.max(0, Math.min(1, level));
  }

  function stems(): string[] {
    return STEMS.slice();
  }

  function env(node: AudioParam, peak: number, t: number, attack: number, decay: number): void {
    node.cancelScheduledValues(t);
    node.setValueAtTime(0.0001, t);
    node.linearRampToValueAtTime(peak, t + attack);
    node.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  function tone(type: OscillatorType, freq: number, peak: number, attack: number, decay: number, dest?: AudioNode): void {
    if (!ac || !master) return;
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ac.createGain();
    o.connect(g);
    g.connect(dest ?? master);
    if (reverb) g.connect(reverb);
    env(g.gain, peak, ac.currentTime, attack, decay);
    o.start();
    o.stop(ac.currentTime + attack + decay + 0.05);
  }

  function cue(name: string, opts?: { volume?: number; pan?: number }): void {
    if (!ac || !master) return;
    const v = opts?.volume ?? 1;
    const t = ac.currentTime;
    switch (name) {
      case 'thunk': {
        // Enormous breaker: sub thump + metallic clank + master duck.
        tone('sine', 70, 0.9 * v, 0.005, 0.5);
        tone('sine', 44, 0.7 * v, 0.005, 0.7);
        const clk = ac.createBufferSource();
        clk.buffer = impulse(0.12, 42);
        const cf = ac.createBiquadFilter();
        cf.type = 'bandpass';
        cf.frequency.value = 1800;
        cf.Q.value = 3;
        const cg = ac.createGain();
        cg.gain.value = 0.5 * v;
        clk.connect(cf);
        cf.connect(cg);
        cg.connect(master);
        clk.start();
        // duck
        master.gain.cancelScheduledValues(t);
        master.gain.setValueAtTime(0.5, t);
        master.gain.linearRampToValueAtTime(0.18, t + 0.02);
        master.gain.linearRampToValueAtTime(0.5, t + 0.6);
        break;
      }
      case 'padlock':
      case 'chain': {
        const s = ac.createBufferSource();
        s.buffer = impulse(0.09, name === 'chain' ? 13 : 21);
        const f = ac.createBiquadFilter();
        f.type = 'highpass';
        f.frequency.value = 2500;
        const g = ac.createGain();
        g.gain.value = 0.35 * v;
        s.connect(f);
        f.connect(g);
        g.connect(master);
        s.start();
        break;
      }
      case 'coffee': {
        // the coziest sound in the game: a soft pour + ceramic tick
        const s = ac.createBufferSource();
        s.buffer = noiseBuffer(0.5, 99);
        const f = ac.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 1200;
        f.Q.value = 1.5;
        const g = ac.createGain();
        g.connect(master);
        env(g.gain, 0.16 * v, t, 0.05, 0.4);
        s.connect(f);
        f.connect(g);
        s.start();
        s.stop(t + 0.55);
        tone('sine', 780, 0.08 * v, 0.005, 0.12);
        break;
      }
      case 'winch': {
        tone('sawtooth', 140, 0.14 * v, 0.02, 0.18);
        break;
      }
      case 'door': tone('sine', 180, 0.12 * v, 0.01, 0.16); break;
      case 'page': tone('highpass' as any, 0, 0, 0, 0); {
        const s = ac.createBufferSource();
        s.buffer = impulse(0.08, 5);
        const g = ac.createGain(); g.gain.value = 0.12 * v; s.connect(g); g.connect(master); s.start();
        break;
      }
      case 'pen': tone('triangle', 340, 0.08 * v, 0.005, 0.09); break;
      case 'switch_heavy': tone('square', 90, 0.3 * v, 0.005, 0.25); break;
      case 'train_horn': {
        tone('sawtooth', 220, 0.18 * v, 0.05, 0.9);
        tone('sawtooth', 277, 0.14 * v, 0.05, 0.9);
        break;
      }
      case 'crossing_bell': {
        tone('sine', 1050, 0.12 * v, 0.005, 0.35);
        break;
      }
      case 'static_burst': {
        const s = ac.createBufferSource();
        s.buffer = noiseBuffer(0.3, 77);
        const g = ac.createGain();
        env(g.gain, 0.18 * v, t, 0.005, 0.25);
        s.connect(g);
        g.connect(master);
        s.start();
        s.stop(t + 0.32);
        break;
      }
      case 'footstep_wood': tone('sine', 150, 0.06 * v, 0.002, 0.05); break;
      case 'footstep_sand': { const s = ac.createBufferSource(); s.buffer = impulse(0.05, 3); const g = ac.createGain(); g.gain.value = 0.05 * v; s.connect(g); g.connect(master); s.start(); break; }
      case 'footstep_grass': { const s = ac.createBufferSource(); s.buffer = impulse(0.04, 8); const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1500; const g = ac.createGain(); g.gain.value = 0.05 * v; s.connect(f); f.connect(g); g.connect(master); s.start(); break; }
      case 'footstep_road': tone('sine', 110, 0.05 * v, 0.002, 0.04); break;
      case 'bell': bell(1); break;
      default:
        break;
    }
  }

  function setReverbTail(scale: number): void {
    if (!ac || !reverb) return;
    const s = Math.max(0.1, Math.min(1, scale));
    reverb.buffer = impulse(1.6 * s, 7);
  }

  function radioPlay(song: SongDef, opts?: { rate?: number; lowpass?: number }): void {
    if (!seq || !radioFilter) return;
    stopStatic();
    radioFilter.frequency.value = opts?.lowpass ?? 8000;
    seq.play(song, opts);
  }

  function radioStatic(rhythmic?: boolean): void {
    if (!ac || !radioBus) return;
    if (seq) seq.stop();
    stopStatic();
    const s = ac.createBufferSource();
    s.buffer = noiseBuffer(2, 55);
    s.loop = true;
    const f = ac.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1800;
    f.Q.value = 0.7;
    const g = ac.createGain();
    g.gain.value = 0.12;
    s.connect(f);
    f.connect(g);
    g.connect(radioBus);
    if (rhythmic) {
      // pulse the static so it keeps the last song's rhythm
      const lfo = ac.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 2; // ~120bpm feel
      const lg = ac.createGain();
      lg.gain.value = 0.1;
      lfo.connect(lg);
      lg.connect(g.gain);
      lfo.start();
    }
    s.start();
    staticSrc = s;
  }

  function stopStatic(): void {
    if (staticSrc) {
      try { staticSrc.stop(); } catch { /* already stopped */ }
      staticSrc = null;
    }
  }

  function radioStop(): void {
    if (seq) seq.stop();
    stopStatic();
  }

  function playEpilogueCue(): void {
    // The one guarded non-diegetic cue (§11). A warm sustained major chord.
    if (!ac || !master) return;
    const root = 261.63;
    [1, 1.25, 1.5, 2].forEach((m, i) => {
      const o = ac!.createOscillator();
      o.type = 'triangle';
      o.frequency.value = root * m;
      const g = ac!.createGain();
      o.connect(g);
      g.connect(master!);
      if (reverb) g.connect(reverb);
      const t = ac!.currentTime + i * 0.04;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.1, t + 0.4);
      g.gain.linearRampToValueAtTime(0.08, t + 2.5);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 5);
      o.start(t);
      o.stop(t + 5.2);
    });
  }

  function bell(times: number): void {
    if (!ac || !master) return;
    for (let i = 0; i < times; i++) {
      const t = ac.currentTime + i * 2.2;
      const o = ac.createOscillator();
      o.type = 'sine';
      o.frequency.value = 330;
      const mod = ac.createOscillator();
      mod.type = 'sine';
      mod.frequency.value = 330 * 2.76; // inharmonic bell partial
      const modGain = ac.createGain();
      modGain.gain.value = 400;
      mod.connect(modGain);
      modGain.connect(o.frequency);
      const g = ac.createGain();
      o.connect(g);
      g.connect(master);
      if (reverb) g.connect(reverb);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.22, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.0);
      o.start(t);
      mod.start(t);
      o.stop(t + 2.1);
      mod.stop(t + 2.1);
    }
  }

  function update(dt: number): void {
    if (!ac) return;
    // Smooth stems toward targets over ~2s.
    const rate = Math.min(1, dt / 2);
    for (const name of STEMS) {
      const cur = stemLevels[name] ?? 0;
      const tgt = stemTargets[name] ?? 0;
      const next = cur + (tgt - cur) * rate;
      stemLevels[name] = next;
      const g = stemGains[name];
      if (g) g.gain.value = next;
    }
    if (seq) seq.update(dt);
  }

  return {
    unlock,
    setStem,
    stems,
    cue,
    setReverbTail,
    radioPlay,
    radioStatic,
    radioStop,
    playEpilogueCue,
    bell,
    update,
  };
}
