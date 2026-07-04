/**
 * Chiptune sequencer for WLNK's rotation (§7.8). Plays SongDef note data
 * with a ~0.2s lookahead scheduler: square/triangle/saw/sine oscillators
 * plus filtered-noise bursts for drums (midiPitch -1, or any 'noise' track).
 * Songs loop until stopped.
 *
 * The `rate` option is tape-style: it stretches time AND drops pitch by the
 * same factor, which is what makes the Day-8 survivor song go wrong at 0.85x.
 * The `lowpass` option is the day's top-end rolloff on the whole song bus.
 */

import type { SongDef } from '../types';

interface Ev {
  beat: number;
  pitch: number;
  dur: number;
  track: number;
}

const LOOKAHEAD_SEC = 0.2;

export function createSequencer(
  ctxAudio: AudioContext,
  out: AudioNode
): {
  play(song: SongDef, opts?: { rate?: number; lowpass?: number }): void;
  stop(): void;
  playing(): boolean;
  currentSongId(): string | null;
  update(dt: number): void;
} {
  let song: SongDef | null = null;
  let events: Ev[] = [];
  let idx = 0;
  let loopStart = 0; // AudioContext time of the current loop iteration's beat 0
  let beatSec = 0.5;
  let freqMult = 1;
  let bus: GainNode | null = null;
  let filter: BiquadFilterNode | null = null;
  const live = new Set<AudioScheduledSourceNode>();
  let noiseBuf: AudioBuffer | null = null;

  /** Deterministic noise buffer (LCG, constant seed) — no Math.random. */
  function noise(): AudioBuffer {
    if (noiseBuf) return noiseBuf;
    let s = 0x9d2c5681 >>> 0;
    const len = Math.max(1, Math.floor(ctxAudio.sampleRate));
    const buf = ctxAudio.createBuffer(1, len, ctxAudio.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      d[i] = s / 2147483648 - 1;
    }
    noiseBuf = buf;
    return buf;
  }

  const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

  function track(src: AudioScheduledSourceNode, extra: AudioNode[]): void {
    live.add(src);
    src.onended = () => {
      live.delete(src);
      try {
        src.disconnect();
      } catch {}
      for (const n of extra) {
        try {
          n.disconnect();
        } catch {}
      }
    };
  }

  function scheduleNote(ev: Ev, t: number): void {
    const sg = song;
    if (!sg || !bus) return;
    const tr = sg.tracks[ev.track];
    if (!tr) return;
    const vol = Math.min(1, Math.max(0, tr.volume));
    if (vol <= 0) return;
    const durSec = Math.max(0.04, ev.dur * beatSec);

    if (tr.wave === 'noise' || ev.pitch < 0) {
      // Drum: filtered noise burst. A pitched note on a noise track centers
      // the bandpass there (kick thump vs. hat sizzle is all in the pitch).
      const src = ctxAudio.createBufferSource();
      src.buffer = noise();
      src.loop = true;
      const bp = ctxAudio.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value =
        ev.pitch >= 0 ? Math.min(9000, Math.max(40, mtof(ev.pitch) * freqMult)) : 3200;
      bp.Q.value = 1.1;
      const g = ctxAudio.createGain();
      const d = Math.min(durSec, 0.4);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol * 0.8, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.001, t + d);
      src.connect(bp);
      bp.connect(g);
      g.connect(bus);
      src.start(t);
      src.stop(t + d + 0.03);
      track(src, [bp, g]);
    } else {
      const osc = ctxAudio.createOscillator();
      osc.type = tr.wave;
      osc.frequency.value = Math.min(12000, Math.max(20, mtof(ev.pitch) * freqMult));
      const g = ctxAudio.createGain();
      const attack = 0.008;
      const level = vol * 0.5;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(level, t + attack);
      g.gain.setValueAtTime(level, Math.max(t + attack, t + durSec - 0.05));
      g.gain.linearRampToValueAtTime(0.0001, t + durSec);
      osc.connect(g);
      g.connect(bus);
      osc.start(t);
      osc.stop(t + durSec + 0.02);
      track(osc, [g]);
    }
  }

  function play(songDef: SongDef, opts?: { rate?: number; lowpass?: number }): void {
    stop();
    if (
      !songDef ||
      !Array.isArray(songDef.tracks) ||
      !(songDef.lengthBeats > 0) ||
      !(songDef.bpm > 0)
    ) {
      console.warn(`[music] unplayable song ${songDef ? `"${songDef.id}"` : '(none)'}`);
      return;
    }
    const rate = Math.min(2, Math.max(0.25, opts?.rate ?? 1));
    const bpm = Math.min(400, Math.max(20, songDef.bpm));
    beatSec = 60 / bpm / rate;
    freqMult = rate;

    filter = ctxAudio.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = Math.min(18000, Math.max(200, opts?.lowpass ?? 16000));
    bus = ctxAudio.createGain();
    bus.gain.value = 0.9;
    bus.connect(filter);
    filter.connect(out);

    events = [];
    songDef.tracks.forEach((tr, ti) => {
      for (const n of tr.notes ?? []) {
        if (Array.isArray(n) && n.length >= 3) {
          events.push({ beat: n[0], pitch: n[1], dur: n[2], track: ti });
        }
      }
    });
    events.sort((a, b) => a.beat - b.beat);
    if (events.length === 0) console.warn(`[music] song "${songDef.id}" has no notes`);

    idx = 0;
    loopStart = ctxAudio.currentTime + 0.08;
    song = songDef;
  }

  function stop(): void {
    for (const n of live) {
      n.onended = null;
      try {
        n.stop();
      } catch {}
      try {
        n.disconnect();
      } catch {}
    }
    live.clear();
    if (bus) {
      try {
        bus.disconnect();
      } catch {}
      bus = null;
    }
    if (filter) {
      try {
        filter.disconnect();
      } catch {}
      filter = null;
    }
    song = null;
    events = [];
    idx = 0;
  }

  function update(_dt: number): void {
    if (!song || !bus || events.length === 0) return;
    const now = ctxAudio.currentTime;
    const horizon = now + LOOKAHEAD_SEC;
    const loopSec = song.lengthBeats * beatSec;
    if (!(loopSec > 0)) return;

    // Resync after long stalls (hidden tab): jump whole loops, restart scan.
    if (loopStart + loopSec < now) {
      const behind = Math.floor((now - loopStart) / loopSec);
      loopStart += behind * loopSec;
      idx = 0;
    }

    let guard = 0;
    while (guard++ < 1024) {
      const ev = events[idx];
      const t = loopStart + ev.beat * beatSec;
      if (t > horizon) break;
      if (t >= now - 0.005) scheduleNote(ev, Math.max(t, now + 0.005));
      idx++;
      if (idx >= events.length) {
        idx = 0;
        loopStart += loopSec;
      }
    }
  }

  return {
    play,
    stop,
    playing: () => song !== null,
    currentSongId: () => (song ? song.id : null),
    update,
  };
}
