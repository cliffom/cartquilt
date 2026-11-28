import {
  artworkImage,
  type ArtworkAsset,
  type ArtworkEdit,
  type ArtworkHistoryEdit,
} from "./artwork-model.js";
import { setupAssetPicker } from "./asset-picker.js";
import { el, get, positionTileArea } from "./dom.js";
import type { TileArea } from "./grid-geometry.js";
import { decode, type HistoryDirection, type Point, type Scene, type Workspace } from "./model.js";
import type { QueueSceneWrite } from "./scene-actions.js";

type Brush = ArtworkAsset | "erase";

export function setupArtwork(
  workspace: Workspace,
  queueWrite: QueueSceneWrite,
  canvas: HTMLElement,
  selectionFor: (scene: Scene) => TileArea | undefined,
  stopPlacement: () => void,
  changed: (sceneId: string, edit: ArtworkEdit | ArtworkHistoryEdit) => void,
  visibilityChanged: () => void,
  saveStateChanged: () => void,
  selectionModeChanged: () => void,
  selectTileAt: (scene: Scene, point: Point) => boolean,
  canEdit: () => boolean,
) {
  const toggle = get<HTMLButtonElement>("toggle-artwork");
  const panel = get("artwork-tools");
  const layerSelect = get<HTMLSelectElement>("tile-layer");
  const layerForm = get<HTMLFormElement>("add-tile-layer-form");
  const name = get<HTMLInputElement>("tile-layer-name");
  const show = get<HTMLInputElement>("show-artwork");
  const visibility = get<HTMLButtonElement>("tile-layer-visibility");
  const visibilityIcon = get("tile-layer-visibility-icon");
  const visibilityLabel = get("tile-layer-visibility-label");
  const raise = get<HTMLButtonElement>("raise-tile-layer");
  const lower = get<HTMLButtonElement>("lower-tile-layer");
  const remove = get<HTMLButtonElement>("remove-tile-layer");
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
  let open = false;
  let layerId: string | undefined;
  let brush: Brush | undefined;
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
      if (!open) {
        open = true;
        stopPlacement();
      }
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
    void pickAsset(spriteBrush() ? "sprite" : "tile", workspace.desk === "scene");
  choose.onclick = openLibrary;
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
    const canPaint = !!layer && !layer.hidden && show.checked;
    const armed = open && show.checked && !!brush && (spriteBrush() || canPaint);
    canvas.classList.toggle("placing-artwork", armed);
    canvas.classList.toggle("erasing-artwork", armed && brush === "erase");
    canvas.classList.toggle("showing-artwork-grid", open);
    erase.disabled = !canPaint;
    erase.setAttribute("aria-pressed", String(armed && brush === "erase"));
    select.setAttribute("aria-pressed", String(open && !brush));
    choose.toggleAttribute("data-active", armed && brush !== "erase");
    activeBrush.textContent = armed
      ? brush === "erase"
        ? "Erasing tiles"
        : (brush?.name ?? "")
      : "";
    apply.disabled = !armed || !scene || !selectionFor(scene);
    coordApply.disabled = !armed && !(open && !brush && canPaint);
    coordApply.textContent = brush ? "Place at coordinates" : "Select at coordinates";
    for (const field of [width, height]) field.disabled = !brush || spriteBrush();
    selectionModeChanged();
  }
  function sync() {
    const scene = activeScene();
    if (sceneId !== scene?.id) {
      sceneId = scene?.id;
      open = false;
      brush = undefined;
      layerId = undefined;
      name.value = "";
      coords.reset();
    }
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (scene) {
      const layers = scene.tileLayers;
      if (!selectedLayer(scene)) layerId = layers.at(-1)?.id;
      const signature = JSON.stringify(layers.map(({ id, name, hidden }) => [id, name, hidden]));
      if (layerSelect.dataset.layers !== signature) {
        layerSelect.dataset.layers = signature;
        layerSelect.replaceChildren(
          ...layers.map((layer) => new Option(layer.name, layer.id)).reverse(),
        );
        if (!layers.length) layerSelect.append(new Option("No tile layers", ""));
      }
      layerSelect.value = layerId ?? "";
      layerSelect.disabled = !layers.length;
      const index = layers.findIndex((layer) => layer.id === layerId);
      visibility.disabled = remove.disabled = index < 0;
      const hidden = layers[index]?.hidden;
      visibilityLabel.textContent = hidden ? "Show layer" : "Hide layer";
      visibilityIcon.setAttribute("href", hidden ? "#icon-eye-off" : "#icon-eye");
      visibility.toggleAttribute("data-layer-hidden", !!hidden);
      raise.disabled = index < 0 || index === layers.length - 1;
      lower.disabled = index <= 0;
      x.max = String(scene.width - 1);
      y.max = String(scene.height - 1);
      width.max = String(scene.width);
      height.max = String(scene.height);
    }
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
          if (name.value === edit.name) name.value = "";
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
    if (scene.id !== sceneId || !open || !show.checked || !brush) return false;
    if (!canEdit()) return true;
    if (brush !== "erase" && brush.kind === "sprite") {
      if (placingSprite) return true;
      if (area.width !== 1 || area.height !== 1) {
        feedback.textContent = "Place the sprite on one tile.";
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
    if (!layer || layer.hidden) return false;
    void save(
      scene.id,
      brush === "erase"
        ? { op: "erase", layerId: layer.id, area }
        : { op: "paint", layerId: layer.id, tile: brush.id, area },
    );
    return true;
  }
  toggle.onclick = (event) => {
    open = !open;
    if (open) stopPlacement();
    else brush = undefined;
    sync();
    if (open && event.detail === 0) name.focus();
  };
  show.onchange = () => {
    visibilityChanged();
    syncSelection();
  };
  layerSelect.onchange = () => {
    layerId = layerSelect.value;
    sync();
  };
  layerForm.onsubmit = (event) => {
    event.preventDefault();
    if (sceneId && name.value.trim()) void save(sceneId, { op: "add-layer", name: name.value });
  };
  for (const [control, op] of [
    [visibility, "toggle-layer"],
    [raise, "raise-layer"],
    [lower, "lower-layer"],
    [remove, "remove-layer"],
  ] as const) {
    control.onclick = () => {
      const scene = activeScene();
      const layer = scene && selectedLayer(scene);
      if (!scene || !layer) return;
      if (op === "remove-layer" && !window.confirm(`Remove the “${layer.name}” tile layer?`))
        return;
      void save(scene.id, { op, layerId: layer.id });
    };
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
      if (selectTileAt(scene, { x: x.valueAsNumber, y: y.valueAsNumber })) {
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
      return open && !brush && show.checked && !layer?.hidden ? layer : undefined;
    },
    get brushArmed() {
      return open && brush !== undefined && show.checked;
    },
    disarm() {
      open = false;
      brush = undefined;
      sync();
    },
    get visible() {
      return show.checked;
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
    art.querySelector(":scope > .blockout-layer") ?? art.querySelector(":scope > .background");
  if (after) after.after(group);
  else art.prepend(group);
}
