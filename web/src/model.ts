import {
  type ArtworkEdit,
  type ArtworkHistoryEdit,
  type ArtworkMove,
  isArtworkReference,
  type TileLayer,
} from "./artwork-model.js";
import {
  defaultMovementProfile,
  elementKinds,
  isKeyOf,
  maxBlockoutEntries,
  movementProfiles,
  terrainKinds,
  type Blockout,
} from "./blockout-model.js";
import {
  maxSceneTilesPerAxis,
  minSceneTilesPerAxis,
  pixelsPerTile,
  projectVersion,
} from "./project-constants.js";

export type Point = { x: number; y: number };
type Camera = Point & { zoom: number };
const fittedSceneCamera = { x: 0, y: 0, zoom: 1 } as const;
const maxBlockoutUndoSteps = 50;
export type Actor = Point & {
  id: string;
  name: string;
  sprite: string;
  width: number;
  height: number;
};
export type Entrance = Point & { id: string; name: string };
export type Exit = Entrance & {
  width: number;
  height: number;
  destination: { sceneId: string; entranceId: string };
};
export type Scene = {
  id: string;
  name: string;
  world: Point;
  art: string;
  color?: string;
  width: number;
  height: number;
  actors: Actor[];
  entrances: Entrance[];
  exits: Exit[];
  blockout: Blockout;
  tileLayers: TileLayer[];
};
export type Project = { version: typeof projectVersion; id: string; name: string; scenes: Scene[] };
export type Snapshot = { project: Project; revision: string };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Expected an object");
  return value as Record<string, unknown>;
}
function str(value: unknown, pattern?: RegExp): string {
  if (typeof value !== "string" || !value || (pattern && !pattern.test(value)))
    throw Error("Invalid text field");
  return value;
}
function integer(
  value: unknown,
  min = Number.MIN_SAFE_INTEGER,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max)
    throw Error("Invalid coordinate or dimension");
  return value;
}
function items<T extends { id: string }>(
  value: unknown,
  decode: (entry: Record<string, unknown>) => T,
): T[] {
  if (!Array.isArray(value)) throw Error("Expected a list");
  const result = value.map((item) => decode(record(item)));
  if (new Set(result.map((item) => item.id)).size !== result.length) throw Error("Duplicate ID");
  return result;
}
const id = /^[a-z][a-z0-9-]*$/;
const asset = /^[a-zA-Z0-9_-]+\.png$/;
const sceneColor = /^#[0-9a-f]{6}$/i;
function decodeTileLayers(value: unknown, width: number, height: number): TileLayer[] {
  return items(value === undefined ? [] : value, (layer) => {
    if (
      !Array.isArray(layer.tiles) ||
      (layer.hidden !== undefined && typeof layer.hidden !== "boolean")
    )
      throw Error("Invalid tile layer");
    const occupied = new Uint8Array(layer.tiles.length ? width * height : 0);
    const tiles = layer.tiles.map((value) => {
      const region = record(value);
      const tile = region.tile;
      if (!isArtworkReference("tile", tile)) throw Error("Invalid artwork tile");
      const x = integer(region.x, 0, width - 1);
      const y = integer(region.y, 0, height - 1);
      const w = integer(region.width, 1, width - x);
      const h = integer(region.height, 1, height - y);
      for (let row = y; row < y + h; row++) {
        for (let column = x; column < x + w; column++) {
          const index = row * width + column;
          if (occupied[index]) throw Error("Overlapping tiles on one layer");
          occupied[index] = 1;
        }
      }
      return { tile, x, y, width: w, height: h };
    });
    return { id: str(layer.id, id), name: str(layer.name), hidden: layer.hidden === true, tiles };
  });
}
function decodeBlockout(value: unknown, width: number, height: number): Blockout {
  if (value === undefined) return { profile: defaultMovementProfile, terrain: [], elements: [] };
  const layer = record(value);
  const profile = layer.profile;
  if (!isKeyOf(movementProfiles, profile)) throw Error("Invalid blockout movement profile");
  const area = (entry: Record<string, unknown>) => {
    const x = integer(entry.x, 0, width - 1);
    const y = integer(entry.y, 0, height - 1);
    return {
      x,
      y,
      width: integer(entry.width, 1, width - x),
      height: integer(entry.height, 1, height - y),
    };
  };
  const regions = layer.terrain ?? [];
  if (!Array.isArray(regions) || regions.length > maxBlockoutEntries)
    throw Error("Invalid blockout terrain list");
  const occupied = new Uint8Array(regions.length ? width * height : 0);
  const terrain = regions.map((value) => {
    const entry = record(value);
    const kind = entry.kind;
    if (!isKeyOf(terrainKinds, kind)) throw Error("Invalid blockout terrain kind");
    const bounds = area(entry);
    for (let y = bounds.y; y < bounds.y + bounds.height; y++) {
      for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
        const index = y * width + x;
        if (occupied[index]) throw Error("Overlapping blockout terrain");
        occupied[index] = 1;
      }
    }
    return { kind, ...bounds };
  });
  let hasSpawn = false;
  const elements = items(layer.elements ?? [], (entry) => {
    const kind = entry.kind;
    if (!isKeyOf(elementKinds, kind)) throw Error("Invalid blockout element kind");
    const bounds = area(entry);
    if (elementKinds[kind].point && (bounds.width !== 1 || bounds.height !== 1))
      throw Error("Blockout markers use one tile");
    if (kind === "player-spawn") {
      if (hasSpawn) throw Error("A scene can have one player spawn");
      hasSpawn = true;
    }
    return {
      id: str(entry.id, id),
      kind,
      ...bounds,
      label: entry.label === undefined ? undefined : str(entry.label),
    };
  });
  if (elements.length > maxBlockoutEntries) throw Error("Too many blockout elements");
  return { profile, terrain, elements };
}
export function decode(value: unknown): Snapshot {
  const snapshot = record(value),
    p = record(snapshot.project);
  if (p.version !== projectVersion) throw Error("Unsupported project version");
  const scenes = items(p.scenes, (s) => {
    const width = integer(s.width, minSceneTilesPerAxis, maxSceneTilesPerAxis),
      height = integer(s.height, minSceneTilesPerAxis, maxSceneTilesPerAxis),
      world = record(s.world);
    const actors = items(s.actors, (a) => {
      const w = integer(a.width, 1, width * pixelsPerTile),
        h = integer(a.height, 1, height * pixelsPerTile);
      return {
        id: str(a.id, id),
        name: str(a.name),
        width: w,
        height: h,
        sprite: isArtworkReference("sprite", a.sprite) ? a.sprite : str(a.sprite, asset),
        x: integer(a.x, 0, width * pixelsPerTile - w),
        y: integer(a.y, 0, height * pixelsPerTile - h),
      };
    });
    return {
      id: str(s.id, id),
      name: str(s.name),
      art: s.art === "" ? "" : str(s.art, asset),
      color: s.color === undefined || s.color === "" ? undefined : str(s.color, sceneColor),
      width,
      height,
      world: { x: integer(world.x), y: integer(world.y) },
      actors,
      blockout: decodeBlockout(s.blockout, width, height),
      tileLayers: decodeTileLayers(s.tileLayers, width, height),
      entrances: items(s.entrances === undefined ? [] : s.entrances, (entry) => ({
        id: str(entry.id, id),
        name: str(entry.name),
        x: integer(entry.x, 0, width - 1),
        y: integer(entry.y, 0, height - 1),
      })),
      exits: items(s.exits === undefined ? [] : s.exits, (entry) => {
        const x = integer(entry.x, 0, width - 1);
        const y = integer(entry.y, 0, height - 1);
        const destination = record(entry.destination);
        return {
          id: str(entry.id, id),
          name: str(entry.name),
          x,
          y,
          width: integer(entry.width, 1, width - x),
          height: integer(entry.height, 1, height - y),
          destination: {
            sceneId: str(destination.sceneId, id),
            entranceId: str(destination.entranceId, id),
          },
        };
      }),
    };
  });
  const entrancesByScene = new Map(
    scenes.map((scene) => [scene.id, new Set(scene.entrances.map((entry) => entry.id))]),
  );
  for (const scene of scenes) {
    for (const exit of scene.exits) {
      const { sceneId, entranceId } = exit.destination;
      if (sceneId === scene.id || !entrancesByScene.get(sceneId)?.has(entranceId))
        throw Error(`Invalid destination for exit ${exit.name}`);
    }
  }
  return {
    revision: str(snapshot.revision, /^[0-9a-f]{64}$/),
    project: { version: projectVersion, id: str(p.id, id), name: str(p.name), scenes },
  };
}

export type MoveActor = { type: "moveActor"; actor: string; axis: keyof Point; value: number };
export type HistoryDirection = "undo" | "redo";
type SceneHistory =
  | { actors: Actor[] }
  | { blockout: Blockout | undefined }
  | { artwork: ArtworkHistoryEdit | undefined; reverseActorMove?: ActorMoveEdit };

type ActorMoveEdit = Extract<ArtworkMove, { op: "move-actor" }>;

export class SceneDocument {
  private saved: Scene;
  scene: Scene;
  private past: SceneHistory[] = [];
  private future: SceneHistory[] = [];
  private group?: symbol;
  private restoringBlockout = false;
  constructor(scene: Scene) {
    this.saved = structuredClone(scene);
    this.scene = structuredClone(scene);
  }
  get baseline() {
    return this.saved;
  }
  acceptSceneMetadata(saved: Scene) {
    const update = (scene: Scene) => ({
      ...scene,
      name: saved.name,
      color: saved.color,
      world: saved.world,
      entrances: saved.entrances,
      exits: saved.exits,
      blockout: saved.blockout,
      tileLayers: saved.tileLayers,
    });
    this.saved = update(this.saved);
    this.scene = update(this.scene);
  }
  acceptPlacedActor(actor: Actor, index: number, position?: Point) {
    const insert = (actors: Actor[], value: Actor) => [
      ...actors.slice(0, index),
      value,
      ...actors.slice(index),
    ];
    this.saved = { ...this.saved, actors: insert(this.saved.actors, actor) };
    this.scene = { ...this.scene, actors: insert(this.scene.actors, { ...actor, ...position }) };
  }
  acceptActorPosition(actor: Actor, updateWorking: boolean) {
    const update = (scene: Scene) => ({
      ...scene,
      actors: scene.actors.map((entry) => (entry.id === actor.id ? actor : entry)),
    });
    this.saved = update(this.saved);
    if (updateWorking) this.scene = update(this.scene);
  }
  forgetActor(id: string) {
    const without = (actors: Actor[]) => actors.filter((actor) => actor.id !== id);
    this.saved = { ...this.saved, actors: without(this.saved.actors) };
    this.scene = { ...this.scene, actors: without(this.scene.actors) };
  }
  artworkHistory(direction: HistoryDirection) {
    const entry = this.stack(direction).at(-1);
    return entry && "artwork" in entry ? entry.artwork : undefined;
  }
  beginArtworkEdit() {
    const entry: SceneHistory = { artwork: undefined };
    this.past.push(entry);
    this.group = undefined;
    return (inverse?: ArtworkHistoryEdit, forwardActorMove?: ActorMoveEdit) => {
      if (inverse) {
        entry.artwork = inverse;
        entry.reverseActorMove = forwardActorMove;
        this.future = [];
      } else {
        this.past.splice(this.past.indexOf(entry), 1);
      }
    };
  }
  acceptArtworkHistory(direction: HistoryDirection, inverse?: ArtworkHistoryEdit) {
    const entry = this.stack(direction).at(-1);
    if (!entry || !("artwork" in entry) || !entry.artwork) return;
    const reverse = entry.reverseActorMove ?? inverse;
    if (!reverse) return;
    this.advanceHistory(direction, {
      artwork: reverse,
      reverseActorMove:
        entry.reverseActorMove && entry.artwork.op === "move-actor" ? entry.artwork : undefined,
    });
  }
  captureArtworkInverse(edit: ArtworkEdit | ArtworkHistoryEdit) {
    const before = this.saved;
    const working = this.scene;
    return (removedActor?: string): ArtworkHistoryEdit | undefined => {
      switch (edit.op) {
        case "move-actor": {
          const previous = working.actors.find(({ id }) => id === edit.actorId);
          if (previous && (previous.x !== edit.position.x || previous.y !== edit.position.y))
            return { ...edit, position: { x: previous.x, y: previous.y } };
          return;
        }
        case "move-tiles": {
          const { x, y } = edit.area;
          if (x !== edit.position.x || y !== edit.position.y)
            return { ...edit, area: { ...edit.area, ...edit.position }, position: { x, y } };
          return;
        }
        case "place-sprite": {
          const actor = this.saved.actors.at(-1);
          if (actor && this.saved.actors.length > before.actors.length)
            return { op: "remove-actor", actorId: actor.id };
          return;
        }
        case "restore-actor": {
          const actor = this.saved.actors[edit.actorIndex];
          if (actor) return { op: "remove-actor", actorId: actor.id };
          return;
        }
        case "remove-actor": {
          const actorIndex = before.actors.findIndex(({ id }) => id === edit.actorId);
          const actor = working.actors.find(({ id }) => id === edit.actorId);
          if (actor && actorIndex >= 0 && removedActor)
            return {
              op: "restore-actor",
              actorRecord: removedActor,
              actorIndex,
              position: { x: actor.x, y: actor.y },
            };
          return;
        }
        default:
          if (JSON.stringify(before.tileLayers) !== JSON.stringify(this.saved.tileLayers))
            return { op: "restore-layers", layers: before.tileLayers };
      }
    };
  }
  get dirty() {
    return JSON.stringify(this.scene) !== JSON.stringify(this.baseline);
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  apply(op: MoveActor, group?: symbol) {
    if (this.restoringBlockout) throw Error("Wait for the blockout history change to finish.");
    const actor = this.scene.actors.find((a) => a.id === op.actor);
    if (!actor) throw Error("Unknown actor");
    const extent = op.axis === "x" ? "width" : "height";
    const max = this.scene[extent] * pixelsPerTile - actor[extent];
    if (!Number.isInteger(op.value) || op.value < 0 || op.value > max)
      throw Error(`Enter a whole number from 0 to ${max}.`);
    if (actor[op.axis] === op.value) return;
    if (!group || this.group !== group) this.past.push({ actors: this.scene.actors });
    this.group = group;
    this.scene = {
      ...this.scene,
      actors: this.scene.actors.map((a) => (a.id === op.actor ? { ...a, [op.axis]: op.value } : a)),
    };
    this.future = [];
  }
  undo() {
    this.restoreActors("undo");
  }
  redo() {
    this.restoreActors("redo");
  }
  private stack(direction: HistoryDirection) {
    return direction === "undo" ? this.past : this.future;
  }
  private advanceHistory(direction: HistoryDirection, current: SceneHistory) {
    this.stack(direction).pop();
    this.stack(direction === "undo" ? "redo" : "undo").push(current);
    this.group = undefined;
  }
  private restoreActors(direction: HistoryDirection) {
    const entry = this.stack(direction).at(-1);
    if (!entry || !("actors" in entry) || this.restoringBlockout) return;
    this.advanceHistory(direction, { actors: this.scene.actors });
    this.scene = {
      ...this.scene,
      actors: this.scene.actors.map(
        (actor) => entry.actors.find(({ id }) => id === actor.id) ?? actor,
      ),
    };
  }
  private trimBlockoutHistory() {
    let blockoutSteps = 0;
    for (let i = this.past.length - 1; i >= 0; i--) {
      const entry = this.past[i];
      if ("blockout" in entry && entry.blockout && ++blockoutSteps > maxBlockoutUndoSteps) {
        this.past.splice(i, 1);
        return;
      }
    }
  }
  beginBlockoutEdit() {
    const entry: SceneHistory = { blockout: undefined };
    this.past.push(entry);
    this.group = undefined;
    return (previous?: Blockout) => {
      if (previous && JSON.stringify(previous) !== JSON.stringify(this.baseline.blockout)) {
        entry.blockout = previous;
        this.future = [];
        this.trimBlockoutHistory();
      } else {
        this.past.splice(this.past.indexOf(entry), 1);
      }
    };
  }
  hasBlockoutHistory(direction: HistoryDirection) {
    const entry = this.stack(direction).at(-1);
    return !!entry && "blockout" in entry && entry.blockout !== undefined;
  }
  async restoreBlockoutHistory(
    direction: HistoryDirection,
    save: (layer: Blockout) => Promise<void>,
  ) {
    const entry = this.stack(direction).at(-1);
    if (!entry || !("blockout" in entry) || !entry.blockout || this.restoringBlockout) return;
    this.restoringBlockout = true;
    const current = this.baseline.blockout;
    try {
      await save(entry.blockout);
      this.advanceHistory(direction, { blockout: current });
    } finally {
      this.restoringBlockout = false;
    }
  }
}
export class Workspace {
  desk: "world" | "scene" = "world";
  selected: string | undefined;
  objects = new Map<string, string>();
  positions = new Map<string, Point>();
  documents = new Map<string, SceneDocument>();
  camera: Camera = { x: 0, y: 0, zoom: 1 };
  private sceneCamera: Camera = { ...fittedSceneCamera };
  constructor(private saved: Snapshot) {
    const snapshot = this.saved;
    this.selected = snapshot.project.scenes[0]?.id;
    for (const scene of snapshot.project.scenes) {
      this.documents.set(scene.id, new SceneDocument(scene));
      this.positions.set(scene.id, { ...scene.world });
    }
  }
  get snapshot() {
    return this.saved;
  }
  get viewportCamera() {
    return this.desk === "scene" ? this.sceneCamera : this.camera;
  }
  openScene(id: string) {
    this.documentFor(id);
    this.selected = id;
    this.resetSceneCamera();
    this.desk = "scene";
  }
  resetSceneCamera() {
    this.sceneCamera = { ...fittedSceneCamera };
  }
  acceptSceneAdditions(next: Snapshot) {
    const current = this.saved.project;
    const scenes = next.project.scenes;
    if (
      next.project.id !== current.id ||
      next.project.name !== current.name ||
      scenes.length < current.scenes.length ||
      current.scenes.some((scene, index) => JSON.stringify(scene) !== JSON.stringify(scenes[index]))
    ) {
      throw Error(
        "Existing project data changed on disk. Reopen the project to load those changes.",
      );
    }
    for (const scene of scenes.slice(current.scenes.length)) {
      this.documents.set(scene.id, new SceneDocument(scene));
      this.positions.set(scene.id, { ...scene.world });
    }
    this.saved = next;
  }
  acceptSceneAction(
    next: Snapshot,
    target: string,
    action: "rename" | "color" | "delete" | "position" | "connection" | "blockout" | "artwork",
    edit?: ArtworkEdit,
    updateWorkingActor = false,
  ) {
    const current = this.saved.project;
    const expected =
      action === "delete" ? current.scenes.filter((s) => s.id !== target) : current.scenes;
    const previous = current.scenes.find((s) => s.id === target);
    const updated = next.project.scenes.find((s) => s.id === target);
    const addedActor =
      edit?.op === "place-sprite" &&
      previous &&
      updated?.actors.length === previous.actors.length + 1
        ? updated.actors.at(-1)
        : undefined;
    const restoredActor =
      edit?.op === "restore-actor" ? updated?.actors[edit.actorIndex] : undefined;
    const affected =
      edit?.op === "move-actor" || edit?.op === "remove-actor" ? edit.actorId : undefined;
    const previousIndex = previous?.actors.findIndex((actor) => actor.id === affected) ?? -1;
    const previousActor = previous?.actors[previousIndex];
    const movedActor = edit?.op === "move-actor" ? updated?.actors[previousIndex] : undefined;
    const comparableActors = (actors: Actor[]) => {
      if (addedActor) return actors.slice(0, -1);
      if (edit?.op === "restore-actor" && restoredActor) {
        return [...actors.slice(0, edit.actorIndex), ...actors.slice(edit.actorIndex + 1)];
      }
      if (edit?.op === "remove-actor" && previousActor) {
        return [...actors.slice(0, previousIndex), previousActor, ...actors.slice(previousIndex)];
      }
      if (movedActor && previousActor && edit?.op === "move-actor") {
        return actors.map((actor) =>
          actor.id === affected ? { ...actor, x: previousActor.x, y: previousActor.y } : actor,
        );
      }
      return actors;
    };
    const comparable = (scene: Scene) =>
      scene.id === target && action !== "delete"
        ? {
            ...scene,
            name: action === "rename" ? previous?.name : scene.name,
            color: action === "color" ? previous?.color : scene.color,
            world: action === "position" ? previous?.world : scene.world,
            entrances: action === "connection" ? previous?.entrances : scene.entrances,
            exits: action === "connection" ? previous?.exits : scene.exits,
            blockout: action === "blockout" ? previous?.blockout : scene.blockout,
            tileLayers: action === "artwork" ? previous?.tileLayers : scene.tileLayers,
            actors: comparableActors(scene.actors),
          }
        : scene;
    if (
      !previous ||
      next.project.id !== current.id ||
      next.project.name !== current.name ||
      next.project.scenes.length !== expected.length ||
      next.project.scenes.some(
        (scene, index) => JSON.stringify(comparable(scene)) !== JSON.stringify(expected[index]),
      )
    )
      throw Error(
        "Existing project data changed on disk. Reopen the project to load those changes.",
      );

    if (action === "delete") {
      this.documents.delete(target);
      this.positions.delete(target);
      this.objects.delete(target);
      if (this.selected === target) {
        this.selected = next.project.scenes[0]?.id;
        this.desk = "world";
      }
    } else if (updated) {
      const document = this.documentFor(target);
      document.acceptSceneMetadata(updated);
      if (addedActor) document.acceptPlacedActor(addedActor, updated.actors.length - 1);
      if (restoredActor && edit?.op === "restore-actor")
        document.acceptPlacedActor(restoredActor, edit.actorIndex, edit.position);
      if (movedActor) document.acceptActorPosition(movedActor, updateWorkingActor);
      if (edit?.op === "remove-actor" && previousActor) {
        document.forgetActor(edit.actorId);
        if (this.objects.get(target) === edit.actorId) this.objects.delete(target);
      }
    }
    this.saved = next;
  }
  documentFor(id: string | undefined) {
    const document = id && this.documents.get(id);
    if (!document) throw Error(`Unknown scene: ${id}`);
    return document;
  }
  positionFor(id: string | undefined) {
    const position = id && this.positions.get(id);
    if (!position) throw Error(`Missing world position for scene: ${id}`);
    return position;
  }
  get active() {
    return this.documentFor(this.selected);
  }
  get layoutDirty() {
    return this.snapshot.project.scenes.some((s) => {
      const p = this.positionFor(s.id);
      return p.x !== s.world.x || p.y !== s.world.y;
    });
  }
}
