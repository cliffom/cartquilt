export type Point = { x: number; y: number };
export type Actor = Point & {
  id: string;
  name: string;
  sprite: string;
  width: number;
  height: number;
};
export type Scene = {
  id: string;
  name: string;
  world: Point;
  art: string;
  width: number;
  height: number;
  actors: Actor[];
};
export type Project = { version: 1; id: string; name: string; scenes: Scene[] };
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
export function decode(value: unknown): Snapshot {
  const snapshot = record(value),
    p = record(snapshot.project);
  if (p.version !== 1) throw Error("Unsupported project version");
  const scenes = items(p.scenes, (s) => {
    const width = integer(s.width, 1, 1024),
      height = integer(s.height, 1, 1024),
      world = record(s.world);
    const actors = items(s.actors, (a) => {
      const w = integer(a.width, 1, width * 8),
        h = integer(a.height, 1, height * 8);
      return {
        id: str(a.id, id),
        name: str(a.name),
        width: w,
        height: h,
        sprite: str(a.sprite, asset),
        x: integer(a.x, 0, width * 8 - w),
        y: integer(a.y, 0, height * 8 - h),
      };
    });
    return {
      id: str(s.id, id),
      name: str(s.name),
      art: s.art === "" ? "" : str(s.art, asset),
      width,
      height,
      world: { x: integer(world.x), y: integer(world.y) },
      actors,
    };
  });
  return {
    revision: str(snapshot.revision, /^[0-9a-f]{64}$/),
    project: { version: 1, id: str(p.id, id), name: str(p.name), scenes },
  };
}

export type MoveActor = { type: "moveActor"; actor: string; axis: keyof Point; value: number };
export class SceneDocument {
  readonly baseline: Scene;
  scene: Scene;
  private past: Scene[] = [];
  private future: Scene[] = [];
  private group?: symbol;
  constructor(scene: Scene) {
    this.baseline = structuredClone(scene);
    this.scene = structuredClone(scene);
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
    const max = this.scene[extent] * 8 - actor[extent];
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
