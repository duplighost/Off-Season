/**
 * Bootstrap. Grabs the 480×270 canvas, integer-scales it to the window, and
 * starts the game. The AudioContext is unlocked on the first user gesture.
 */

import { Game } from './game/game';
import { SCREEN_H, SCREEN_W } from './types';

function fit(canvas: HTMLCanvasElement): void {
  const scale = Math.max(
    1,
    Math.floor(Math.min(window.innerWidth / SCREEN_W, window.innerHeight / SCREEN_H)),
  );
  canvas.style.transformOrigin = 'center center';
  canvas.style.transform = `scale(${scale})`;
  canvas.style.imageRendering = 'pixelated';
}

function main(): void {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
  if (!canvas) {
    console.error('[main] #game-canvas not found');
    return;
  }
  canvas.width = SCREEN_W;
  canvas.height = SCREEN_H;
  fit(canvas);
  window.addEventListener('resize', () => fit(canvas));

  const game = new Game(canvas);
  game.start();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
