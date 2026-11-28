import {
  artworkImage,
  type ArtworkAsset,
  type ArtworkEdit,
  type ArtworkHistoryEdit,
} from "./artwork-model.js";
import { fitsScene, setupArtworkPreview } from "./artwork-preview.js";
import { pixelsPerTile } from "./project-constants.js";
import { setupTileStack } from "./tile-stack.js";
import { setupAssetPicker } from "./asset-picker.js";
import { el, get, positionTileArea } from "./dom.js";
import { containsTile, type TileArea } from "./grid-geometry.js";
import { decode, type HistoryDirection, type Point, type Scene, type Workspace } from "./model.js";
import type { QueueSceneWrite } from "./scene-actions.js";

type Brush = ArtworkAsset | "erase";

export function setupArtwork(
  workspace: Workspace,
  queueWrite: QueueSceneWrite,
  canvas: HTMLElement,
  selectionFor: (scene: Scene) => TileArea | undefined,
  clearSelectionAfterErase: (scene: Scene, saved: Promise<boolean>) => void,
  editing: () => boolean,
  selectArtwork: () => void,
  changed: (sceneId: string, edit: ArtworkEdit | ArtworkHistoryEdit) => void,
  saveStateChanged: () => void,
  selectionModeChanged: () => void,
  selectTileAt: (scene: Scene, area: TileArea) => boolean,
  canEdit: () => boolean,
) {
  const panel = get("artwork-tools");
  const apply = get<HTMLButtonElement>("apply-artwork-selection");
  const coords = get<HTMLFormElement>("artwork-coordinate-form");
  const coordApply = get<HTMLButtonElement>("apply-artwork-coordinates");
  const x = get<HTMLInputElement>("artwork-x");
  const y = get<HTMLInputElement>("artwork-y");
  const width = get<HTMLInputElement>("artwork-width");
  const height = get<HTMLInputElement>("artwork-height");
  const feedback = get("artwork-feedback");
  const failure = get("artwork-error");
  const failureGroup = get("artwork-save-feedback");
  let sceneId: string | undefined;
  let layerId: string | undefined;
  const stack = setupTileStack((id) => {
    layerId = id;
    sync();
  }, save);
  let brush: Brush | undefined;
  let lastTile: ArtworkAsset | undefined;
  const preview = setupArtworkPreview();
  const swatch = get<HTMLImageElement>("artwork-swatch");
  const paint = get<HTMLButtonElement>("paint-artwork");
  let pending = 0;
  let placingSprite = false;
  const choose = get<HTMLButtonElement>("choose-artwork-asset");
  const select = get<HTMLButtonElement>("select-artwork");
  const erase = get<HTMLButtonElement>("erase-artwork");
  const activeBrush = get("active-artwork-brush");
  for (const control of panel.querySelectorAll<HTMLElement>(".artwork-icon-control")) {
    const resetTooltip = () => delete control.dataset.tooltipDismissed;
    control.onpointerenter = resetTooltip;
    control.addEventListener("focusin", resetTooltip);
  }
  const pickAsset = setupAssetPicker(
    (asset) => {
      if (workspace.desk !== "scene") return;
      selectArtwork();
      if (asset.kind === "tile") lastTile = asset;
      brush = asset;
      sync();
    },
    async (data) => {
      pending++;
      saveStateChanged();
      try {
        await queueWrite(async () => {
          data.set("baseRevision", workspace.snapshot.revision);
          const response = await fetch("./api/artwork-assets/import", {
            method: "POST",
            body: data,
          });
          if (!response.ok) throw Error((await response.text()).trim());
          workspace.acceptSceneAdditions(decode(await response.json()));
        });
      } finally {
        pending--;
        saveStateChanged();
      }
    },
  );
  const spriteBrush = () => brush !== "erase" && brush?.kind === "sprite";
  const openLibrary = () =>
    void pickAsset.open(spriteBrush() ? "sprite" : "tile", workspace.desk === "scene");
  choose.onclick = openLibrary;
  paint.onclick = () => {
    if (!lastTile) {
      void pickAsset.open("tile", true);
      return;
    }
    brush = lastTile;
    syncSelection();
  };
  select.onclick = () => {
    brush = undefined;
    syncSelection();
  };
  erase.onclick = () => {
    brush = brush === "erase" ? undefined : "erase";
    syncSelection();
  };

  function activeScene() {
    return workspace.desk === "scene" ? workspace.active.scene : undefined;
  }
  function selectedLayer(scene: Scene) {
    return scene.tileLayers.find((layer) => layer.id === layerId);
  }
  function syncSelection() {
    const scene = activeScene();
    const layer = scene && selectedLayer(scene);
    const canPaint = !!layer && !layer.hidden;
    if (!canPaint && brush === "erase") brush = undefined;
    preview.clear();
    const armed = editing() && !!brush && (spriteBrush() || canPaint);
    canvas.classList.toggle("placing-artwork", armed);
    canvas.classList.toggle("erasing-artwork", armed && brush === "erase");
    canvas.classList.toggle("showing-artwork-grid", editing());
    erase.disabled = !canPaint;
    erase.setAttribute("aria-pressed", String(armed && brush === "erase"));
    select.setAttribute("aria-pressed", String(editing() && !brush));
    paint.setAttribute(
      "aria-pressed",
      String(editing() && brush !== "erase" && brush?.kind === "tile"),
    );
    choose.toggleAttribute("data-active", armed && spriteBrush());
    const asset = brush && brush !== "erase" ? brush : lastTile;
    swatch.hidden = !asset;
    if (asset) {
      const url = artworkImage(asset.kind, asset.id);
      if (swatch.getAttribute("src") !== url) swatch.src = url;
      choose.setAttribute("aria-description", asset.name);
    } else choose.removeAttribute("aria-description");
    activeBrush.textContent = armed
      ? brush === "erase"
        ? "Erasing tiles"
        : (brush?.name ?? "")
      : "";
    if (editing() && brush && brush !== "erase" && brush.kind === "tile" && !canPaint) {
      activeBrush.textContent = layer
        ? `Show ${layer.name} to paint.`
        : `Add a layer to paint ${brush.name}.`;
    }
    apply.hidden = !brush || !scene || !selectionFor(scene);
    apply.disabled = !armed || apply.hidden;
    coordApply.disabled = !armed && !(editing() && !brush && canPaint);
    coordApply.textContent = brush ? "Place at coordinates" : "Select at coordinates";
    for (const field of [width, height]) field.disabled = spriteBrush();
    selectionModeChanged();
  }
  function sync() {
    const scene = activeScene();
    if (sceneId !== scene?.id) {
      sceneId = scene?.id;
      brush = undefined;
      layerId = undefined;
      coords.reset();
    }
    if (!editing()) {
      brush = undefined;
    }
    if (scene) {
      const layers = scene.tileLayers;
      if (!selectedLayer(scene)) layerId = layers.at(-1)?.id;
      x.max = String(scene.width - 1);
      y.max = String(scene.height - 1);
      width.max = String(scene.width);
      height.max = String(scene.height);
    }
    stack.sync(scene, layerId);
    syncSelection();
  }
  async function save(
    target: string,
    edit: ArtworkEdit | ArtworkHistoryEdit,
    history?: "draft" | HistoryDirection,
  ) {
    if ((!history || history === "draft") && !canEdit()) return false;
    const document = workspace.documentFor(target);
    const sceneName = document.scene.name;
    const finish = history ? undefined : document.beginArtworkEdit();
    const direction = history === "draft" ? undefined : history;
    pending++;
    feedback.textContent = "Saving artwork…";
    saveStateChanged();
    let inverse: ArtworkHistoryEdit | undefined;
    try {
      await queueWrite(async () => {
        const capture = document.captureArtworkInverse(edit);
        const baseRevision = workspace.snapshot.revision;
        const restore = edit.op === "restore-layers" || edit.op === "restore-actor";
        const response = await fetch(
          `./api/project/scenes/${target}/${restore ? "artwork" : "actions"}`,
          {
            method: restore ? "PUT" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              edit.op === "restore-layers"
                ? { baseRevision, layers: edit.layers }
                : edit.op === "restore-actor"
                  ? { baseRevision, actor: edit }
                  : { baseRevision, action: "artwork", artwork: edit },
            ),
          },
        );
        if (!response.ok) throw Error((await response.text()).trim());
        const result = await response.json();
        workspace.acceptSceneAction(
          decode(result),
          target,
          "artwork",
          edit.op === "restore-layers" ? undefined : edit,
          history !== "draft",
        );
        inverse = capture(
          typeof result.removedActor === "string" ? result.removedActor : undefined,
        );
        if (direction) document.acceptArtworkHistory(direction, inverse);
        if (sceneId === target && edit.op === "add-layer") {
          layerId = document.scene.tileLayers.at(-1)?.id;
        }
        changed(target, edit);
      });
      return true;
    } catch (error) {
      failureGroup.hidden = false;
      failure.textContent = `Artwork edit in ${sceneName} could not be saved. ${(error as Error).message}`;
      return false;
    } finally {
      finish?.(inverse, edit.op === "move-actor" ? edit : undefined);
      pending--;
      if (!pending) feedback.textContent = "";
      sync();
      saveStateChanged();
    }
  }
  function applyBrush(scene: Scene, area: TileArea) {
    if (scene.id !== sceneId || !editing() || !brush) return false;
    if (!canEdit()) return true;
    if (brush !== "erase" && brush.kind === "sprite") {
      if (placingSprite) return true;
      if (area.width !== 1 || area.height !== 1) {
        feedback.textContent = "Place the sprite on one tile.";
      } else if (!fitsScene(brush, area, scene)) {
        feedback.textContent = "The sprite needs room for its full image inside the scene.";
      } else {
        const placing = brush;
        placingSprite = true;
        void save(scene.id, { op: "place-sprite", sprite: placing.id, area }).then((saved) => {
          placingSprite = false;
          if (saved && brush === placing) {
            brush = undefined;
            syncSelection();
          }
        });
      }
      return true;
    }
    const layer = selectedLayer(scene);
    if (!layer || layer.hidden) return true;
    if (brush === "erase") {
      clearSelectionAfterErase(scene, save(scene.id, { op: "erase", layerId: layer.id, area }));
    } else {
      void save(scene.id, { op: "paint", layerId: layer.id, tile: brush.id, area });
    }
    return true;
  }
  apply.onclick = () => {
    const scene = activeScene();
    const area = scene && selectionFor(scene);
    if (scene && area) applyBrush(scene, area);
  };
  coords.onsubmit = (event) => {
    event.preventDefault();
    const scene = activeScene();
    if (!scene) return;
    if (!brush) {
      if (
        x.valueAsNumber + width.valueAsNumber > scene.width ||
        y.valueAsNumber + height.valueAsNumber > scene.height
      ) {
        feedback.textContent = "Keep the selection inside the scene.";
        return;
      }
      if (
        selectTileAt(scene, {
          x: x.valueAsNumber,
          y: y.valueAsNumber,
          width: width.valueAsNumber,
          height: height.valueAsNumber,
        })
      ) {
        coords.closest("details")?.removeAttribute("open");
        canvas.focus({ preventScroll: true });
      }
    } else
      applyBrush(scene, {
        x: x.valueAsNumber,
        y: y.valueAsNumber,
        width: spriteBrush() ? 1 : width.valueAsNumber,
        height: spriteBrush() ? 1 : height.valueAsNumber,
      });
  };
  get("dismiss-artwork-error").onclick = () => {
    failureGroup.hidden = true;
    failure.textContent = "";
    saveStateChanged();
    canvas.focus({ preventScroll: true });
  };

  return {
    sync,
    syncSelection,
    applyBrush,
    openLibrary,
    tileSampler(point: Point) {
      const scene = activeScene();
      if (!scene || !editing()) return;
      const layer = selectedLayer(scene);
      if (!layer || layer.hidden) return;
      const id = layer.tiles.find((tile) => containsTile(tile, point.x, point.y))?.tile;
      if (!id) return;
      return () => {
        const sampled: ArtworkAsset = {
          kind: "tile",
          id,
          name: "Sampled tile",
          width: pixelsPerTile,
          height: pixelsPerTile,
        };
        brush = lastTile = sampled;
        syncSelection();
        // Placement only needs the saved tile reference. Resolve its display name separately.
        void pickAsset
          .findTile(id)
          .then((asset) => {
            if (!asset || lastTile !== sampled) return;
            lastTile = asset;
            if (brush === sampled) brush = asset;
            syncSelection();
          })
          .catch(() => {});
      };
    },
    hover(art: HTMLElement, point?: Point) {
      const scene = activeScene();
      if (
        point &&
        editing() &&
        scene &&
        brush &&
        brush !== "erase" &&
        (spriteBrush() || selectedLayer(scene)?.hidden === false)
      ) {
        preview.show(art, scene, brush, point);
      } else preview.clear();
    },
    save,
    dismissTooltip() {
      if (panel.hidden) return false;
      const tooltips = panel.querySelectorAll<HTMLElement>(
        ".artwork-icon-control:not([data-tooltip-dismissed]):is(:hover, :has(:focus-visible))",
      );
      for (const control of tooltips) control.dataset.tooltipDismissed = "";
      return tooltips.length > 0;
    },
    moveLayer(scene: Scene) {
      const layer = selectedLayer(scene);
      return editing() && !brush && !layer?.hidden ? layer : undefined;
    },
    get brushArmed() {
      return editing() && brush !== undefined;
    },
    get busy() {
      return pending > 0;
    },
    get saveFailed() {
      return !failureGroup.hidden;
    },
  };
}

export function drawTileLayers(art: HTMLElement, scene: Scene, visible: boolean) {
  art.querySelector(":scope > .artwork-tiles")?.remove();
  if (!visible || !scene.tileLayers.some((layer) => !layer.hidden && layer.tiles.length)) return;
  const group = el("span", "artwork-tiles");
  group.setAttribute("aria-hidden", "true");
  for (const layer of scene.tileLayers) {
    if (layer.hidden) continue;
    const surface = el("span", "artwork-layer");
    surface.dataset.layer = layer.id;
    for (const region of layer.tiles) {
      const tile = el("span", "artwork-tile");
      tile.dataset.tile = region.tile;
      tile.style.backgroundImage = `url("${artworkImage("tile", region.tile)}")`;
      tile.style.backgroundSize = `${100 / region.width}% ${100 / region.height}%`;
      positionTileArea(tile, region, scene);
      surface.append(tile);
    }
    group.append(surface);
  }
  const after =
    art.querySelector(":scope > .background") ?? art.querySelector(":scope > .blockout-layer");
  if (after) after.after(group);
  else art.prepend(group);
}
