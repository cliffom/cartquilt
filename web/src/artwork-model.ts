import type { TileArea } from "./grid-geometry.js";
import type { Point } from "./model.js";

export const roomTiles = {
  floor: "Floor",
  wall: "Wall",
  doorway: "Doorway",
  rug: "Rug",
} as const;
export const courierSprite = "starter:courier";
const projectPNG = /^[a-zA-Z0-9_-]+\.png$/;
const importedID = /^asset-[a-f0-9]{32}$/;
export type ArtworkKind = "tile" | "sprite";
export type ArtworkAsset = {
  id: string;
  name: string;
  kind: ArtworkKind;
  width: number;
  height: number;
};
export type PaintedTile = TileArea & { tile: string };
export type TileLayer = { id: string; name: string; hidden: boolean; tiles: PaintedTile[] };
export type ArtworkEdit =
  | { op: "add-layer"; name: string }
  | { op: "remove-layer" | "toggle-layer" | "raise-layer" | "lower-layer"; layerId: string }
  | { op: "paint"; layerId: string; tile: string; area: TileArea }
  | { op: "erase"; layerId: string; area: TileArea }
  | { op: "move-tile"; layerId: string; tile: string; area: TileArea; position: Point }
  | { op: "place-sprite"; sprite: string; area: TileArea }
  | { op: "move-actor"; actorId: string; position: Point }
  | { op: "remove-actor"; actorId: string }
  | { op: "restore-actor"; actorRecord: string; actorIndex: number; position?: Point };

export type ArtworkMove = Extract<ArtworkEdit, { op: "move-tile" | "move-actor" }>;
export type ArtworkHistoryEdit =
  | ArtworkMove
  | Extract<ArtworkEdit, { op: "remove-actor" | "restore-actor" }>
  | { op: "restore-layers"; layers: TileLayer[] };

export function isArtworkReference(kind: ArtworkKind, value: unknown): value is string {
  return (
    typeof value === "string" &&
    ((kind === "tile" ? Object.hasOwn(roomTiles, value) : value === courierSprite) ||
      (value.startsWith(`${kind}:`) &&
        (projectPNG.test(value.slice(kind.length + 1)) ||
          importedID.test(value.slice(kind.length + 1)))))
  );
}

export function artworkImage(kind: ArtworkKind, id: string) {
  if (id.startsWith(`${kind}:`)) return `./api/artwork-assets/${kind}/${id.slice(kind.length + 1)}`;
  return `/starter/${id === courierSprite ? "courier" : id}.png`;
}
