import {
  artworkImage,
  type ArtworkMove,
  type PaintedTile,
  type TileLayer,
} from "./artwork-model.js";
import { el, positionTileArea, pointerButton, tileAt } from "./dom.js";
import { areasOverlap, containsTile, type TileArea } from "./grid-geometry.js";
import type { Actor, Point, Scene, Workspace } from "./model.js";
import { pixelsPerTile } from "./project-constants.js";

const dragThreshold = 3;
const arrowSteps: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

type TileSelection = { sceneId: string; layerId: string; tile: PaintedTile };
type Target = { kind: "tile"; selection: TileSelection } | { kind: "actor"; actor: Actor };

export function setupArtworkMove(
  canvas: HTMLElement,
  workspace: Workspace,
  actions: {
    enabled: () => boolean;
    layer: (scene: Scene) => TileLayer | undefined;
    selectActor: (id?: string) => void;
    save: (sceneId: string, edit: ArtworkMove) => Promise<boolean>;
    notice: (text: string) => void;
  },
) {
  const selection = el("span", "artwork-selection");
  selection.setAttribute("aria-hidden", "true");
  const footprint = el("span", "artwork-move-footprint");
  footprint.setAttribute("aria-hidden", "true");
  let selected: TileSelection | undefined;
  let movableLayer: HTMLElement | undefined;
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
  function sameTile(a: PaintedTile, b: PaintedTile) {
    return (
      a.tile === b.tile &&
      a.x === b.x &&
      a.y === b.y &&
      a.width === b.width &&
      a.height === b.height
    );
  }
  function sceneArt(scene: Scene) {
    return canvas.querySelector<HTMLElement>(`[data-grid-scene="${CSS.escape(scene.id)}"]`);
  }
  function currentTile(scene: Scene) {
    const layer = actions.layer(scene);
    if (selected?.sceneId !== scene.id || layer?.id !== selected.layerId) return;
    return layer.tiles.find((tile) => selected && sameTile(tile, selected.tile));
  }
  function refresh() {
    selection.remove();
    const scene = activeScene();
    const enabled = !!scene && actions.enabled();
    if (drag && (!drag.art.isConnected || scene?.id !== drag.scene.id || !enabled)) cancel();
    canvas.classList.toggle("selecting-artwork", enabled);
    const art = enabled ? sceneArt(scene) : undefined;
    const layer = enabled ? actions.layer(scene) : undefined;
    const nextLayer = layer
      ? (art?.querySelector<HTMLElement>(`.artwork-layer[data-layer="${CSS.escape(layer.id)}"]`) ??
        undefined)
      : undefined;
    if (nextLayer !== movableLayer) {
      movableLayer?.classList.remove("movable-artwork-layer");
      nextLayer?.classList.add("movable-artwork-layer");
      movableLayer = nextLayer;
    }
    if (!scene || !art) return;
    const tile = currentTile(scene);
    if (!tile) return;
    positionTileArea(selection, tile, scene);
    art.append(selection);
  }
  function clearSelection() {
    selected = undefined;
    refresh();
  }
  function selectTileAt(scene: Scene, point: Point) {
    const layer = actions.layer(scene);
    const tile = layer?.tiles.find((tile) => containsTile(tile, point.x, point.y));
    if (!layer || !tile) {
      clearSelection();
      return false;
    }
    selected = { sceneId: scene.id, layerId: layer.id, tile };
    actions.selectActor();
    refresh();
    return true;
  }
  function targetArea(target: Target): TileArea {
    return target.kind === "tile" ? target.selection.tile : target.actor;
  }
  function footprintSize(area: TileArea, scale: number) {
    return { width: Math.ceil(area.width / scale), height: Math.ceil(area.height / scale) };
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
    const original = target.selection.tile;
    const layer = actions.layer(scene);
    return (
      !layer ||
      layer.id !== target.selection.layerId ||
      layer.tiles.some(
        (tile) => !sameTile(tile, original) && areasOverlap(tile, { ...original, ...position }),
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
            op: "move-tile",
            layerId: target.selection.layerId,
            tile: target.selection.tile.tile,
            area: { x, y, width, height },
            position,
          };
    await actions.save(scene.id, edit);
  }
  function followTileMove(sceneId: string, edit: Extract<ArtworkMove, { op: "move-tile" }>) {
    if (selected?.sceneId !== sceneId || selected.layerId !== edit.layerId) return;
    if (!sameTile(selected.tile, { ...edit.area, tile: edit.tile })) return;
    selected = { ...selected, tile: { ...selected.tile, ...edit.position } };
    refresh();
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
      if (actor) {
        actions.selectActor(actor.id);
        target = { kind: "actor", actor };
        const preview = node.closest("[data-actor-id]")?.querySelector("img")?.cloneNode();
        if (preview) ghost.append(preview);
      } else {
        const point = tileAt(art, event, scene.width, scene.height);
        if (!point || !selectTileAt(scene, point) || !selected) return;
        target = { kind: "tile", selection: selected };
        const tile = selected.tile;
        ghost.style.backgroundImage = `url("${artworkImage("tile", tile.tile)}")`;
        ghost.style.backgroundSize = `${100 / tile.width}% ${100 / tile.height}%`;
      }
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
        : selected && currentTile(scene)
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

  return { refresh, clearSelection, selectTileAt, followTileMove };
}
