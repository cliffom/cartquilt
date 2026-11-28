import type { TileArea } from "./grid-geometry.js";

export const terrainKinds = {
  walkable: "Walkable",
  blocked: "Blocked / solid ground",
  "one-way": "One-way platform",
  water: "Water",
  pit: "Pit",
  hazard: "Damaging terrain",
  climb: "Climb region",
} as const;

export const elementKinds = {
  "player-spawn": { label: "Player spawn", symbol: "S", point: true },
  checkpoint: { label: "Checkpoint", symbol: "C", point: true },
  "stage-exit": { label: "Stage exit", symbol: "X", point: true },
  enemy: { label: "Enemy", symbol: "E", point: true },
  patrol: { label: "Patrol range", symbol: "↔", point: false },
  "flying-approach": { label: "Flying approach", symbol: "↘", point: false },
  "boss-entrance": { label: "Boss entrance", symbol: "B", point: true },
  "boss-arena": { label: "Boss arena", symbol: "A", point: false },
  reward: { label: "Visible reward", symbol: "+", point: true },
  discoverable: { label: "Hidden discoverable", symbol: "?", point: true },
  detour: { label: "Optional detour", symbol: "D", point: false },
  section: { label: "Named section", symbol: "§", point: false },
  note: { label: "Design note", symbol: "N", point: true },
  camera: { label: "Camera frame", symbol: "CAM", point: false },
} as const;

export const movementProfiles = { "top-down": "Top-down", platformer: "Platformer" } as const;
export const defaultMovementProfile = "top-down";
export const maxBlockoutEntries = 4096;

export type TerrainKind = keyof typeof terrainKinds;
export type ElementKind = keyof typeof elementKinds;
export type MovementProfile = keyof typeof movementProfiles;
export type Blockout = {
  profile: MovementProfile;
  terrain: (TileArea & { kind: TerrainKind })[];
  elements: (TileArea & { id: string; kind: ElementKind; label?: string })[];
};
export type BlockoutEdit =
  | { op: "paint"; kind: TerrainKind; area: TileArea }
  | { op: "erase" | "erase-elements"; area: TileArea }
  | { op: "place"; kind: ElementKind; area: TileArea; label?: string; id?: string }
  | { op: "remove"; id: string }
  | { op: "profile"; profile: MovementProfile };

export function isKeyOf<T extends object>(values: T, key: unknown): key is keyof T {
  return typeof key === "string" && Object.hasOwn(values, key);
}
