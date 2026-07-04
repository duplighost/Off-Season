/**
 * The radio (§7.8): WLNK 1290, "The Voice of the Shoreline." The playlist
 * thins daily; the patter decays; on Day 8 it becomes rhythmic static; Day 9
 * is dead air. Diegetic — only audible at home, in the truck, or by a radio.
 */

import type { Ctx, RadioDay, SongDef } from '../types';

let curSongId: string | null = null;
let songElapsed = 0;
let audible = false;

function radioDay(ctx: Ctx): RadioDay | null {
  const days = ctx.content.radio?.days ?? [];
  return days.find((d) => d.day === ctx.state.day) ?? null;
}

function songById(ctx: Ctx, id: string): SongDef | null {
  return ctx.content.radio?.songs.find((s) => s.id === id) ?? null;
}

/** Is the player somewhere the radio reaches? */
function isAudible(ctx: Ctx): boolean {
  const room = ctx.state.player.room;
  if (ctx.ui.mode === 'travel') return true; // in the truck
  if (room === 'wren_house') return true;
  if (room === 'diner') return true; // Roz keeps it on low
  // near a radio prop on the town map? approximate: within the neck by home.
  return false;
}

export function toggleRadio(ctx: Ctx): void {
  ctx.state.radioOn = !ctx.state.radioOn;
  ctx.audio.cue('static_burst', { volume: 0.5 });
  if (!ctx.state.radioOn) {
    ctx.audio.radioStop();
    curSongId = null;
  }
}

export function updateRadio(ctx: Ctx, dt: number): void {
  const wantAudible = ctx.state.radioOn && isAudible(ctx);
  const rd = radioDay(ctx);

  if (!wantAudible) {
    if (audible) {
      ctx.audio.radioStop();
      audible = false;
      curSongId = null;
    }
    return;
  }
  audible = true;

  if (!rd) return;

  // Day 8: rhythmic static that keeps the song's rhythm.
  if (rd.rhythmicStatic) {
    if (curSongId !== '__static') {
      ctx.audio.radioStatic(true);
      curSongId = '__static';
    }
    return;
  }

  // No playlist (Day 9): dead air.
  if (!rd.playlist || rd.playlist.length === 0) {
    if (curSongId) {
      ctx.audio.radioStop();
      curSongId = null;
    }
    return;
  }

  // Rotate through the day's playlist.
  if (!curSongId || curSongId === '__static') {
    startSong(ctx, rd, 0);
    return;
  }
  const song = songById(ctx, curSongId);
  if (!song) {
    startSong(ctx, rd, 0);
    return;
  }
  const beatSec = 60 / song.bpm;
  const lenSec = song.lengthBeats * beatSec;
  songElapsed += dt;
  if (songElapsed >= lenSec) {
    const idx = rd.playlist.indexOf(curSongId);
    startSong(ctx, rd, (idx + 1) % rd.playlist.length);
  }
}

function startSong(ctx: Ctx, rd: RadioDay, idx: number): void {
  const id = rd.playlist[idx];
  const song = songById(ctx, id);
  if (!song) return;
  curSongId = id;
  songElapsed = 0;
  ctx.audio.radioPlay(song, { rate: rd.rate, lowpass: rd.lowpass });
}

export function radioTicker(ctx: Ctx): string | null {
  if (!ctx.state.radioOn || !audible) return null;
  const rd = radioDay(ctx);
  const station = ctx.content.radio?.station ?? 'WLNK 1290';
  if (!rd) return station;
  let title = '';
  if (curSongId && curSongId !== '__static') {
    const song = songById(ctx, curSongId);
    if (song) title = `${song.title} — ${song.artist}`;
  } else if (rd.rhythmicStatic) {
    title = '···';
  }
  // Rotate patter by clock.
  let patter = '';
  if (rd.patter && rd.patter.length) {
    const i = Math.floor(ctx.state.clockMin / 30) % rd.patter.length;
    patter = rd.patter[i];
  }
  return [station, title, patter].filter(Boolean).join('  ·  ');
}
