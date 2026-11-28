import { artworkImage, type ArtworkMove, type TileLayer } from "./artwork-model.js";
import { el, positionTileArea, pointerButton, tileAt } from "./dom.js";
import {
  areasOverlap,
  containsTile,
  footprintSize,
  intersection,
  overlappingTiles,
  tileArea,
  type TileArea,
} from "./grid-geometry.js";
import type { Actor, Point, Scene, Workspace } from "./model.js";
import { pixelsPerTile } from "./project-constants.js";

const dragThreshold = 3;
const arrowSteps: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

type TileSelection = { layerId: string; area: TileArea };
type Target = { kind: "tile"; selection: TileSelection } | { kind: "actor"; actor: Actor };

export function setupArtworkMove(
  canvas: HTMLElement,
  workspace: Workspace,
  actions: {
    enabled: () => boolean;
    selectionFor: (scene: Scene) => TileArea | undefined;
    selectArea: (scene: Scene, area?: TileArea) => void;
    layer: (scene: Scene) => TileLayer | undefined;
    selectActor: (id?: string) => void;
    save: (sceneId: string, edit: ArtworkMove) => Promise<boolean>;
    notice: (text: string) => void;
  },
) {
  const footprint = el("span", "artwork-move-footprint");
  footprint.setAttribute("aria-hidden", "true");
  let drag:
    | {
        scene: Scene;
        art: HTMLElement;
        target: Target;
        pointerId: number;
        start: Point;
        bounds: DOMRect;
        ghost: HTMLElement;
        moved: boolean;
      }
    | undefined;
  let ignoreClick = false;

  function activeScene() {
    return workspace.desk === "scene" ? workspace.active.scene : undefined;
  }
  function sceneArt(scene: Scene) {
    return canvas.querySelector<HTMLElement>(`[data-grid-scene="${CSS.escape(scene.id)}"]`);
  }
  function selectedTiles(scene: Scene): TileSelection | undefined {
    const layer = actions.layer(scene);
    const area = actions.selectionFor(scene);
    if (area && layer?.tiles.some((tile) => areasOverlap(tile, area)))
      return { layerId: layer.id, area };
  }
  function refresh() {
    const scene = activeScene();
    const enabled = !!scene && actions.enabled();
    if (drag && (!drag.art.isConnected || scene?.id !== drag.scene.id || !enabled)) cancel();
    canvas.classList.toggle("selecting-artwork", enabled);
    canvas.classList.toggle("has-movable-cells", enabled && !!selectedTiles(scene));
  }
  function clearSelection() {
    const scene = activeScene();
    if (scene && actions.selectionFor(scene)) actions.selectArea(scene);
  }
  function selectTileAt(scene: Scene, area: TileArea) {
    if (!actions.layer(scene)?.tiles.some((tile) => areasOverlap(tile, area))) {
      clearSelection();
      return false;
    }
    actions.selectArea(scene, area);
    return true;
  }
  function targetArea(target: Target): TileArea {
    return target.kind === "tile" ? target.selection.area : target.actor;
  }
  function destination(scene: Scene, target: Target, offset: Point): Point {
    const area = targetArea(target);
    const scale = target.kind === "actor" ? pixelsPerTile : 1;
    const size = footprintSize(area, scale);
    const x = Math.round(area.x / scale + offset.x);
    const y = Math.round(area.y / scale + offset.y);
    return {
      x: Math.max(0, Math.min(scene.width - size.width, x)) * scale,
      y: Math.max(0, Math.min(scene.height - size.height, y)) * scale,
    };
  }
  function blocked(scene: Scene, target: Target, position: Point) {
    if (target.kind !== "tile") return false;
    const original = target.selection.area;
    const dest = { ...original, ...position };
    const shared = intersection(original, dest);
    const layer = actions.layer(scene);
    return (
      !layer ||
      layer.id !== target.selection.layerId ||
      layer.tiles.some(
        (tile) => overlappingTiles(tile, dest) > (shared ? overlappingTiles(tile, shared) : 0),
      )
    );
  }
  async function commit(scene: Scene, target: Target, position: Point) {
    const source = targetArea(target);
    if (position.x === source.x && position.y === source.y) return;
    if (blocked(scene, target, position)) {
      actions.notice("That position overlaps another tile region on this layer.");
      return;
    }
    const { x, y, width, height } = source;
    const edit: ArtworkMove =
      target.kind === "actor"
        ? { op: "move-actor", actorId: target.actor.id, position }
        : {
            op: "move-tiles",
            layerId: target.selection.layerId,
            area: { x, y, width, height },
            position,
          };
    await actions.save(scene.id, edit);
  }
  function followTileMove(sceneId: string, edit: Extract<ArtworkMove, { op: "move-tiles" }>) {
    const scene = activeScene();
    if (!scene || scene.id !== sceneId || actions.layer(scene)?.id !== edit.layerId) return;
    const area = actions.selectionFor(scene);
    if (
      area &&
      area.x === edit.area.x &&
      area.y === edit.area.y &&
      area.width === edit.area.width &&
      area.height === edit.area.height
    )
      actions.selectArea(scene, { ...area, ...edit.position });
  }
  function previewPosition(event: PointerEvent, current: NonNullable<typeof drag>) {
    const { scene, target, bounds, start } = current;
    return destination(scene, target, {
      x: ((event.clientX - start.x) * scene.width) / bounds.width,
      y: ((event.clientY - start.y) * scene.height) / bounds.height,
    });
  }
  function cancel() {
    const current = drag;
    if (!current) return;
    drag = undefined;
    current.ghost.remove();
    footprint.remove();
    canvas.classList.remove("moving-artwork");
    if (canvas.hasPointerCapture(current.pointerId))
      canvas.releasePointerCapture(current.pointerId);
  }

  canvas.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== pointerButton.primary || !event.isPrimary) return;
      ignoreClick = false;
      const scene = activeScene();
      const node = event.target instanceof Element ? event.target : undefined;
      if (!scene || !node || event.shiftKey || !actions.enabled() || node.closest(".scene-marker"))
        return;
      const art = sceneArt(scene);
      if (!art?.contains(node)) {
        clearSelection();
        return;
      }
      const actorId = node.closest<HTMLElement>("[data-actor-id]")?.dataset.actorId;
      const actor = scene.actors.find((actor) => actor.id === actorId);
      let target: Target;
      const ghost = el("span", "artwork-move-preview");
      ghost.setAttribute("aria-hidden", "true");
      const point = tileAt(art, event, scene.width, scene.height);
      const selected = selectedTiles(scene);
      if (selected && point && containsTile(selected.area, point.x, point.y)) {
        target = { kind: "tile", selection: selected };
        const area = selected.area;
        for (const tile of actions.layer(scene)?.tiles ?? []) {
          const piece = intersection(tile, area);
          if (!piece) continue;
          const patch = el("span", "artwork-tile");
          patch.style.backgroundImage = `url("${artworkImage("tile", tile.tile)}")`;
          patch.style.backgroundSize = `${100 / piece.width}% ${100 / piece.height}%`;
          positionTileArea(patch, { ...piece, x: piece.x - area.x, y: piece.y - area.y }, area);
          ghost.append(patch);
        }
      } else if (actor) {
        actions.selectActor(actor.id);
        target = { kind: "actor", actor };
        const preview = node.closest("[data-actor-id]")?.querySelector("img")?.cloneNode();
        if (preview) ghost.append(preview);
      } else return;
      const bounds = art.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      canvas.focus({ preventScroll: true });
      drag = {
        scene,
        art,
        target,
        pointerId: event.pointerId,
        start: { x: event.clientX, y: event.clientY },
        bounds,
        ghost,
        moved: false,
      };
      canvas.setPointerCapture(event.pointerId);
      ignoreClick = true;
    },
    true,
  );

  canvas.addEventListener(
    "click",
    (event) => {
      if (!ignoreClick || !event.detail) return;
      ignoreClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true,
  );

  canvas.addEventListener("pointermove", (event) => {
    const current = drag;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!current.moved) {
      if (
        Math.hypot(event.clientX - current.start.x, event.clientY - current.start.y) < dragThreshold
      )
        return;
      current.moved = true;
      current.art.append(current.ghost, footprint);
      canvas.classList.add("moving-artwork");
    }
    const pos = previewPosition(event, current);
    const scale = current.target.kind === "actor" ? pixelsPerTile : 1;
    const area = targetArea(current.target);
    const size = footprintSize(area, scale);
    positionTileArea(
      current.ghost,
      { ...area, ...pos },
      { width: current.scene.width * scale, height: current.scene.height * scale },
    );
    positionTileArea(footprint, { x: pos.x / scale, y: pos.y / scale, ...size }, current.scene);
    footprint.style.backgroundSize = `${100 / size.width}% ${100 / size.height}%`;
    const invalid = blocked(current.scene, current.target, pos);
    current.ghost.classList.toggle("blocked", invalid);
    footprint.classList.toggle("blocked", invalid);
  });

  canvas.addEventListener("pointerup", (event) => {
    const current = drag;
    if (!current || current.pointerId !== event.pointerId) return;
    const position = previewPosition(event, current);
    cancel();
    if (current.moved && current.art.isConnected && actions.enabled())
      void commit(current.scene, current.target, position);
    else if (!current.moved && current.target.kind === "tile") {
      const point = tileAt(current.art, event, current.scene.width, current.scene.height);
      if (point) actions.selectArea(current.scene, tileArea(point));
    }
  });
  for (const type of ["pointercancel", "lostpointercapture"] as const) {
    canvas.addEventListener(type, (event) => {
      if (drag?.pointerId === event.pointerId) cancel();
    });
  }
  window.addEventListener("blur", cancel);

  canvas.addEventListener(
    "keydown",
    (event) => {
      const scene = activeScene();
      const selected = scene && selectedTiles(scene);
      const selectedActor = scene && workspace.objects.get(scene.id);
      if (event.key === "Escape" && actions.enabled() && (selected || drag || selectedActor)) {
        cancel();
        clearSelection();
        if (selectedActor) actions.selectActor();
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (!Object.hasOwn(arrowSteps, event.key) || event.ctrlKey || event.metaKey || event.altKey)
        return;
      if (!scene || drag || !actions.enabled()) return;
      const actor = scene.actors.find((actor) => actor.id === workspace.objects.get(scene.id));
      const target: Target | undefined = actor
        ? { kind: "actor", actor }
        : selected
          ? { kind: "tile", selection: selected }
          : undefined;
      if (!target) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const step = arrowSteps[event.key];
      void commit(scene, target, destination(scene, target, step));
    },
    true,
  );

  return {
    refresh,
    clearSelection,
    selectTileAt,
    followTileMove,
    get ownsClick() {
      return ignoreClick;
    },
  };
}
