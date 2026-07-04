/**
 * Map compiler. Turns the declarative, hand-authored MapContent (content/map/
 * town.json) into a CompiledMap of tile arrays, collision grids, pixel-space
 * anchors and door teleport registries.
 *
 * Contract (ARCHITECTURE.md engine/map.ts):
 *  - Terrain default 'grass'; terrain cmds applied in order (rect fill or path
 *    stroke).
 *  - Buildings paint a solid 'wall' footprint (the roof is drawn by the
 *    renderer from the buildings array), carve a walkable door tile, and
 *    register a door teleport.
 *  - Interiors compile from RoomDef: auto-walled border, floor fill, a carved
 *    exit door back out (target room resolved from the anchor it lands on) plus
 *    any extra interior→interior doors (e.g. Town Hall → records room).
 *  - Props flagged solid contribute to collision.
 *  - Anchors are tile-space in content, converted to pixel-space centres here.
 *  - Zones (town only) become pixel-space rects.
 *
 * Solidity: water / wall / rock / pool block; rail / road / sand / grass /
 * boardwalk / marsh / dirt / sidewalk / floors / pool_empty are walkable.
 * Everything unknown is treated as walkable (the renderer draws it as a loud
 * checker, so a typo shows up visually rather than trapping the player).
 *
 * Door.locked passes through verbatim — a plain key id ('lantern') OR a
 * 'flag:NAME' expression (unlocked while that flag is truthy). game/interact.ts
 * evaluates it; the map layer only carries the string.
 */

import { TILE } from '../types';
import type {
  BuildingDef,
  CompiledMap,
  CompiledRoom,
  MapContent,
  PropDef,
  Rect,
  RoomDef,
  RoomId,
  Vec,
  ZoneId,
} from '../types';

/** Tile types the player cannot walk through. */
const SOLID_TILES = new Set<string>(['water', 'wall', 'rock', 'pool']);

/** Extra door definitions a RoomDef may carry beyond its single `exit`
 *  (interior→interior links, e.g. the Town Hall records room). Read off the
 *  raw JSON; not part of the RoomDef contract type, so accessed defensively. */
interface InteriorDoorDef {
  x: number;
  y: number;
  to?: RoomId;
  toAnchor: string;
  locked?: string;
}

type CompiledDoor = CompiledRoom['doors'][number];

// ---------------------------------------------------------------------------
// Tile grid helpers (tile-space)
// ---------------------------------------------------------------------------

function setTile(tiles: string[], w: number, h: number, x: number, y: number, tile: string): void {
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  tiles[y * w + x] = tile;
}

function fillRect(tiles: string[], w: number, h: number, r: Rect | undefined, tile: string): void {
  if (!r) return;
  const x0 = Math.floor(r.x);
  const y0 = Math.floor(r.y);
  const x1 = x0 + Math.floor(r.w);
  const y1 = y0 + Math.floor(r.h);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) setTile(tiles, w, h, x, y, tile);
  }
}

/** Stroke a polyline with a square brush of the given tile width (default 1). */
function strokePath(
  tiles: string[],
  w: number,
  h: number,
  path: [number, number][] | undefined,
  tile: string,
  width = 1,
): void {
  if (!path || path.length === 0) return;
  const bw = Math.max(1, Math.floor(width));
  const start = -Math.floor((bw - 1) / 2);
  const brush = (cx: number, cy: number): void => {
    for (let oy = 0; oy < bw; oy++) {
      for (let ox = 0; ox < bw; ox++) setTile(tiles, w, h, cx + start + ox, cy + start + oy, tile);
    }
  };
  if (path.length === 1) {
    brush(Math.round(path[0][0]), Math.round(path[0][1]));
    return;
  }
  for (let i = 0; i < path.length - 1; i++) {
    const [x0, y0] = path[i];
    const [x1, y1] = path[i + 1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const steps = Math.max(Math.abs(dx), Math.abs(dy));
    for (let s = 0; s <= steps; s++) {
      const t = steps === 0 ? 0 : s / steps;
      brush(Math.round(x0 + dx * t), Math.round(y0 + dy * t));
    }
  }
}

function applyTerrain(tiles: string[], w: number, h: number, cmds: MapContent['terrain']): void {
  for (const cmd of cmds ?? []) {
    if (!cmd || typeof cmd.tile !== 'string') continue;
    if (cmd.rect) fillRect(tiles, w, h, cmd.rect, cmd.tile);
    if (cmd.path) strokePath(tiles, w, h, cmd.path, cmd.tile, cmd.pathWidth ?? 1);
  }
}

/** Build the collision grid from tiles, then OR in any solid props. */
function buildSolid(tiles: string[], w: number, h: number, props: PropDef[]): Uint8Array {
  const solid = new Uint8Array(w * h);
  for (let i = 0; i < tiles.length; i++) solid[i] = SOLID_TILES.has(tiles[i]) ? 1 : 0;
  for (const p of props) {
    if (!p.solid) continue;
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    if (x >= 0 && y >= 0 && x < w && y < h) solid[y * w + x] = 1;
  }
  return solid;
}

function tileToPixelRect(x: number, y: number): Rect {
  return { x: x * TILE, y: y * TILE, w: TILE, h: TILE };
}

// ---------------------------------------------------------------------------
// Compilation
// ---------------------------------------------------------------------------

/** name -> owning room, so a door's target room can be inferred from the
 *  anchor it teleports to (an exit that lands on a 'townhall' anchor goes to
 *  townhall, one that lands on a 'town' anchor goes outside). */
function buildAnchorRooms(content: MapContent): Map<string, RoomId> {
  const owner = new Map<string, RoomId>();
  for (const [name, a] of Object.entries(content.anchors ?? {})) {
    if (a && typeof a.room === 'string') owner.set(name, a.room);
  }
  for (const rd of content.rooms ?? []) {
    if (!rd?.anchors) continue;
    for (const name of Object.keys(rd.anchors)) owner.set(name, rd.id);
  }
  return owner;
}

function compileTown(content: MapContent, anchorRoom: Map<string, RoomId>): CompiledRoom {
  const w = Math.max(1, Math.floor(content.width) || 120);
  const h = Math.max(1, Math.floor(content.height) || 90);
  const tiles = new Array<string>(w * h).fill('grass');
  applyTerrain(tiles, w, h, content.terrain);

  const doors: CompiledDoor[] = [];
  for (const b of content.buildings ?? []) {
    if (!b?.rect) continue;
    fillRect(tiles, w, h, b.rect, 'wall');
    if (!b.door) continue;
    const dx = Math.floor(b.door.x);
    const dy = Math.floor(b.door.y);
    setTile(tiles, w, h, dx, dy, 'floor_wood'); // carve a walkable threshold
    const to = b.door.to ?? anchorRoom.get(b.door.toAnchor ?? '') ?? '';
    if (to) {
      doors.push({
        rect: tileToPixelRect(dx, dy),
        to,
        toAnchor: b.door.toAnchor ?? '',
        ...(b.door.locked ? { locked: b.door.locked } : {}),
      });
    }
  }

  const townProps = (content.props ?? []).filter((p) => (p.room ?? 'town') === 'town');
  const solid = buildSolid(tiles, w, h, townProps);

  const anchors: Record<string, Vec> = {};
  for (const [name, a] of Object.entries(content.anchors ?? {})) {
    if (a && a.room === 'town') anchors[name] = { x: a.x * TILE + TILE / 2, y: a.y * TILE + TILE / 2 };
  }

  const zones = (content.zones ?? []).map((z) => ({
    id: z.id,
    rect: { x: z.rect.x * TILE, y: z.rect.y * TILE, w: z.rect.w * TILE, h: z.rect.h * TILE },
  }));

  return {
    id: 'town',
    width: w,
    height: h,
    tiles,
    solid,
    props: townProps,
    anchors,
    zones,
    buildings: (content.buildings ?? []) as BuildingDef[],
    doors,
  };
}

function compileInterior(rd: RoomDef, anchorRoom: Map<string, RoomId>): CompiledRoom {
  const w = Math.max(1, Math.floor(rd.width) || 12);
  const h = Math.max(1, Math.floor(rd.height) || 10);
  const floor = rd.floor || 'floor_wood';
  const tiles = new Array<string>(w * h).fill(floor);

  if (rd.walls !== false) {
    for (let x = 0; x < w; x++) {
      setTile(tiles, w, h, x, 0, 'wall');
      setTile(tiles, w, h, x, h - 1, 'wall');
    }
    for (let y = 0; y < h; y++) {
      setTile(tiles, w, h, 0, y, 'wall');
      setTile(tiles, w, h, w - 1, y, 'wall');
    }
  }

  const doors: CompiledDoor[] = [];

  if (rd.exit) {
    const ex = Math.floor(rd.exit.x);
    const ey = Math.floor(rd.exit.y);
    setTile(tiles, w, h, ex, ey, floor); // carve the opening back out
    doors.push({
      rect: tileToPixelRect(ex, ey),
      to: anchorRoom.get(rd.exit.toAnchor) ?? 'town',
      toAnchor: rd.exit.toAnchor,
    });
  }

  const extra = (rd as unknown as { doors?: InteriorDoorDef[] }).doors;
  if (Array.isArray(extra)) {
    for (const d of extra) {
      if (!d) continue;
      const dx = Math.floor(d.x);
      const dy = Math.floor(d.y);
      setTile(tiles, w, h, dx, dy, floor);
      doors.push({
        rect: tileToPixelRect(dx, dy),
        to: d.to ?? anchorRoom.get(d.toAnchor) ?? 'town',
        toAnchor: d.toAnchor,
        ...(d.locked ? { locked: d.locked } : {}),
      });
    }
  }

  const props = (rd.props ?? []).map((p) => ({ ...p, room: rd.id }));
  const solid = buildSolid(tiles, w, h, props);

  const anchors: Record<string, Vec> = {};
  for (const [name, a] of Object.entries(rd.anchors ?? {})) {
    anchors[name] = { x: a.x * TILE + TILE / 2, y: a.y * TILE + TILE / 2 };
  }

  return {
    id: rd.id,
    width: w,
    height: h,
    tiles,
    solid,
    props,
    anchors,
    zones: [],
    buildings: [],
    doors,
  };
}

/** Compile the declarative town description into a CompiledMap. */
export function compileMap(content: MapContent): CompiledMap {
  const anchorRoom = buildAnchorRooms(content);
  const rooms: Record<RoomId, CompiledRoom> = {};

  rooms.town = compileTown(content, anchorRoom);

  for (const rd of content.rooms ?? []) {
    if (!rd || typeof rd.id !== 'string' || rd.id === 'town') {
      if (rd?.id === 'town') console.warn("[map] a RoomDef is named 'town'; skipped (reserved)");
      continue;
    }
    if (rooms[rd.id]) {
      console.warn(`[map] duplicate room id '${rd.id}'; keeping first`);
      continue;
    }
    rooms[rd.id] = compileInterior(rd, anchorRoom);
  }

  return { rooms };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Which outdoor zone (if any) contains a pixel-space point in `room`.
 *  Interiors carry no zones and always return null. */
export function zoneAt(map: CompiledMap, room: RoomId, pos: Vec): ZoneId | null {
  const r = map.rooms[room];
  if (!r) return null;
  for (const z of r.zones) {
    const { rect } = z;
    if (pos.x >= rect.x && pos.x < rect.x + rect.w && pos.y >= rect.y && pos.y < rect.y + rect.h) {
      return z.id;
    }
  }
  return null;
}

/** Resolve a named anchor to its room + pixel-space centre. */
export function anchorPos(map: CompiledMap, name: string): { room: RoomId; pos: Vec } | null {
  for (const roomId of Object.keys(map.rooms)) {
    const p = map.rooms[roomId].anchors[name];
    if (p) return { room: roomId, pos: { x: p.x, y: p.y } };
  }
  return null;
}

/** Pixel-space collision test. Out-of-bounds and unknown rooms read solid so
 *  the player is never able to walk into the void. */
export function isSolid(map: CompiledMap, room: RoomId, px: number, py: number): boolean {
  const r = map.rooms[room];
  if (!r) return true;
  const tx = Math.floor(px / TILE);
  const ty = Math.floor(py / TILE);
  if (tx < 0 || ty < 0 || tx >= r.width || ty >= r.height) return true;
  return r.solid[ty * r.width + tx] === 1;
}
