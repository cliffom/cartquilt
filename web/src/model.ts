import {
  maxSceneTilesPerAxis,
  minSceneTilesPerAxis,
  pixelsPerTile,
  projectVersion,
} from "./project-constants.js";

export type Point = { x: number; y: number };
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
        sprite: str(a.sprite, asset),
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
export class SceneDocument {
  private saved: Scene;
  scene: Scene;
  private past: Scene[] = [];
  private future: Scene[] = [];
  private group?: symbol;
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
    });
    this.saved = update(this.saved);
    this.scene = update(this.scene);
    this.past = this.past.map(update);
    this.future = this.future.map(update);
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
    const actor = this.scene.actors.find((a) => a.id === op.actor);
    if (!actor) throw Error("Unknown actor");
    const extent = op.axis === "x" ? "width" : "height";
    const max = this.scene[extent] * pixelsPerTile - actor[extent];
    if (!Number.isInteger(op.value) || op.value < 0 || op.value > max)
      throw Error(`Enter a whole number from 0 to ${max}.`);
    if (actor[op.axis] === op.value) return;
    if (!group || this.group !== group) this.past.push(this.scene);
    this.group = group;
    this.scene = {
      ...this.scene,
      actors: this.scene.actors.map((a) => (a.id === op.actor ? { ...a, [op.axis]: op.value } : a)),
    };
    this.future = [];
  }
  undo() {
    const scene = this.past.pop();
    if (scene) {
      this.future.push(this.scene);
      this.scene = scene;
      this.group = undefined;
    }
  }
  redo() {
    const scene = this.future.pop();
    if (scene) {
      this.past.push(this.scene);
      this.scene = scene;
      this.group = undefined;
    }
  }
}
export class Workspace {
  desk: "world" | "scene" = "world";
  selected: string | undefined;
  objects = new Map<string, string>();
  positions = new Map<string, Point>();
  documents = new Map<string, SceneDocument>();
  camera = { x: 0, y: 0, zoom: 1 };
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
    action: "rename" | "color" | "delete" | "position" | "connection",
  ) {
    const current = this.saved.project;
    const expected =
      action === "delete" ? current.scenes.filter((s) => s.id !== target) : current.scenes;
    const previous = current.scenes.find((s) => s.id === target);
    const updated = next.project.scenes.find((s) => s.id === target);
    const comparable = (scene: Scene) =>
      scene.id === target && action !== "delete"
        ? {
            ...scene,
            name: action === "rename" ? previous?.name : scene.name,
            color: action === "color" ? previous?.color : scene.color,
            world: action === "position" ? previous?.world : scene.world,
            entrances: action === "connection" ? previous?.entrances : scene.entrances,
            exits: action === "connection" ? previous?.exits : scene.exits,
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
      this.documentFor(target).acceptSceneMetadata(updated);
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
