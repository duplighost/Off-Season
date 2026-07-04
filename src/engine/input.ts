/**
 * Keyboard + mouse input (ARCHITECTURE.md engine/input.ts).
 *
 *   createInput(canvas) -> { state, update }
 *
 * `state` is a live InputState the systems read each frame; `update()` is
 * called once per frame AFTER systems consume it and clears the edge-triggered
 * *Pressed flags, so a key press registers for exactly one frame regardless of
 * how the browser batches events. Level flags (moveX/Y, interactHeld,
 * mouseDown) are recomputed on the events that change them and are never
 * cleared by update().
 *
 * Key map: WASD/arrows move, E/Space/Enter interact+confirm, Esc cancel,
 * C/Tab checklist, R radio, ` or F1 debug.
 *
 * Mouse is reported in the internal 480x270 space. The renderer integer-scales
 * the canvas with a CSS transform, so getBoundingClientRect() already carries
 * that scale + centering offset; mapping a client point through the rect
 * recovers internal pixels without ever reading the scale factor.
 */

import { SCREEN_H, SCREEN_W } from '../types';
import type { InputState } from '../types';

// Physical-key groups (KeyboardEvent.code — layout independent).
const UP = new Set(['KeyW', 'ArrowUp']);
const DOWN = new Set(['KeyS', 'ArrowDown']);
const LEFT = new Set(['KeyA', 'ArrowLeft']);
const RIGHT = new Set(['KeyD', 'ArrowRight']);
const INTERACT = new Set(['KeyE', 'Space', 'Enter', 'NumpadEnter']);
const CANCEL = new Set(['Escape']);
const CHECKLIST = new Set(['KeyC', 'Tab']);
const RADIO = new Set(['KeyR']);
const DEBUG = new Set(['Backquote', 'F1']);

const HANDLED = new Set<string>();
for (const g of [UP, DOWN, LEFT, RIGHT, INTERACT, CANCEL, CHECKLIST, RADIO, DEBUG]) {
  for (const code of g) HANDLED.add(code);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function createInput(canvas: HTMLCanvasElement): { state: InputState; update(): void } {
  const state: InputState = {
    moveX: 0,
    moveY: 0,
    interactPressed: false,
    cancelPressed: false,
    interactHeld: false,
    upPressed: false,
    downPressed: false,
    leftPressed: false,
    rightPressed: false,
    confirmPressed: false,
    checklistPressed: false,
    radioPressed: false,
    debugPressed: false,
    mouseX: 0,
    mouseY: 0,
    mouseDown: false,
    mouseClicked: false,
  };

  /** Currently-held handled codes, so autorepeat can't retrigger edges and a
   *  window blur can release everything cleanly. */
  const held = new Set<string>();

  function anyHeld(set: Set<string>): boolean {
    for (const code of set) if (held.has(code)) return true;
    return false;
  }

  /** Recompute the level (held) flags from the held set. */
  function recompute(): void {
    state.moveX = (anyHeld(LEFT) ? -1 : 0) + (anyHeld(RIGHT) ? 1 : 0);
    state.moveY = (anyHeld(UP) ? -1 : 0) + (anyHeld(DOWN) ? 1 : 0);
    state.interactHeld = anyHeld(INTERACT);
  }

  function onKeyDown(e: KeyboardEvent): void {
    // Leave browser/OS shortcuts (Ctrl+R, Cmd+Tab, Alt+F4…) untouched.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const code = e.code;
    if (!HANDLED.has(code)) return;
    e.preventDefault();
    if (e.repeat || held.has(code)) return; // autorepeat: no fresh edge
    held.add(code);

    if (UP.has(code)) state.upPressed = true;
    if (DOWN.has(code)) state.downPressed = true;
    if (LEFT.has(code)) state.leftPressed = true;
    if (RIGHT.has(code)) state.rightPressed = true;
    if (INTERACT.has(code)) {
      state.interactPressed = true;
      state.confirmPressed = true;
    }
    if (CANCEL.has(code)) state.cancelPressed = true;
    if (CHECKLIST.has(code)) state.checklistPressed = true;
    if (RADIO.has(code)) state.radioPressed = true;
    if (DEBUG.has(code)) state.debugPressed = true;

    recompute();
  }

  function onKeyUp(e: KeyboardEvent): void {
    if (!held.delete(e.code)) return;
    recompute();
  }

  function onBlur(): void {
    held.clear();
    state.mouseDown = false;
    recompute();
  }

  function setMouse(clientX: number, clientY: number): void {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const mx = ((clientX - rect.left) / rect.width) * SCREEN_W;
    const my = ((clientY - rect.top) / rect.height) * SCREEN_H;
    state.mouseX = clamp(Math.floor(mx), 0, SCREEN_W - 1);
    state.mouseY = clamp(Math.floor(my), 0, SCREEN_H - 1);
  }

  function onMouseMove(e: MouseEvent): void {
    setMouse(e.clientX, e.clientY);
  }

  function onMouseDown(e: MouseEvent): void {
    setMouse(e.clientX, e.clientY);
    state.mouseDown = true;
    state.mouseClicked = true;
  }

  function onMouseUp(): void {
    state.mouseDown = false;
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mousedown', onMouseDown);
  }

  function update(): void {
    state.interactPressed = false;
    state.confirmPressed = false;
    state.cancelPressed = false;
    state.upPressed = false;
    state.downPressed = false;
    state.leftPressed = false;
    state.rightPressed = false;
    state.checklistPressed = false;
    state.radioPressed = false;
    state.debugPressed = false;
    state.mouseClicked = false;
  }

  return { state, update };
}
