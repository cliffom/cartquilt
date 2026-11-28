import type { Point } from "./model.js";

export type TileArea = Point & { width: number; height: number };

export function tileArea(start: Point, end = start): TileArea {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x) + 1,
    height: Math.abs(end.y - start.y) + 1,
  };
}

export function areasOverlap(a: TileArea, b: TileArea) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function overlappingTiles(a: TileArea, b: TileArea) {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}

export function isMultiTile(area: TileArea) {
  return area.width > 1 || area.height > 1;
}

export function containsTile(area: TileArea, x: number, y: number) {
  return x >= area.x && x < area.x + area.width && y >= area.y && y < area.y + area.height;
}
