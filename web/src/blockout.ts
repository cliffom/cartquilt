import {
  elementKinds,
  isKeyOf,
  movementProfiles,
  terrainKinds,
  type Blockout,
  type BlockoutEdit,
} from "./blockout-model.js";
import { button, el, get, positionTileArea } from "./dom.js";
import { overlappingTiles, type TileArea } from "./grid-geometry.js";
import { decode, type HistoryDirection, type Scene, type Workspace } from "./model.js";
import type { QueueSceneWrite } from "./scene-actions.js";

const selectBrush = "select";
const terrainEraser = "erase";
const elementEraser = "erase-elements";

export function setupBlockout(
  workspace: Workspace,
  queueWrite: QueueSceneWrite,
  canvas: HTMLElement,
  redrawLayer: (sceneId: string) => void,
  selectionFor: (scene: Scene) => TileArea | undefined,
  stopPlacement: () => void,
  saveStateChanged: () => void,
  brushModeChanged: (active: boolean) => void,
) {
  const toggle = get<HTMLButtonElement>("toggle-blockout");
  const panel = get("blockout-tools");
  const profile = get<HTMLSelectElement>("blockout-profile");
  const brush = get<HTMLSelectElement>("blockout-brush");
  const swatch = get("blockout-brush-swatch");
  const label = get<HTMLInputElement>("blockout-label");
  const apply = get<HTMLButtonElement>("apply-blockout-selection");
  const applyCoordinates = get<HTMLButtonElement>("apply-blockout-coordinates");
  const coordinates = get<HTMLFormElement>("blockout-coordinate-form");
  const x = get<HTMLInputElement>("blockout-x");
  const y = get<HTMLInputElement>("blockout-y");
  const width = get<HTMLInputElement>("blockout-width");
  const height = get<HTMLInputElement>("blockout-height");
  const show = get<HTMLInputElement>("show-blockout");
  const status = get("blockout-status");
  const saveAlert = get("blockout-save-error");
  const selection = get("blockout-selection");
  const selectionInfo = get("blockout-selection-info");
  const setup = get<HTMLDetailsElement>("blockout-coordinates");
  const elements = get<HTMLDetailsElement>("blockout-elements");
  const items = get("blockout-element-list");
  let open = false;
  let sceneId: string | undefined;
  const pending = new Map<string, number>();
  let restoring = false;
  const saveErrors = new Map<string, string>();

  function optionGroup(name: string, options: HTMLOptionElement[]) {
    const group = el("optgroup");
    group.label = name;
    group.append(...options);
    return group;
  }
  profile.append(
    ...Object.entries(movementProfiles).map(([value, name]) => new Option(name, value)),
  );
  brush.append(
    new Option("Select tiles", selectBrush),
    optionGroup(
      "Terrain",
      Object.entries(terrainKinds).map(([value, name]) => new Option(name, value)),
    ),
    optionGroup(
      "Markers and guides",
      Object.entries(elementKinds).map(([value, item]) => new Option(item.label, value)),
    ),
    new Option("Erase terrain", terrainEraser),
    new Option("Erase markers and guides", elementEraser),
  );

  function notice(text: string, error = false) {
    status.textContent = text;
    status.hidden = !text;
    status.dataset.error = String(error);
  }
  function syncSaveFeedback() {
    profile.setAttribute("aria-disabled", String(pending.size > 0));
    saveAlert.hidden = !saveErrors.size;
    const message = [...saveErrors.values()].join(" ");
    if (saveAlert.textContent !== message) saveAlert.textContent = message;
  }
  function toolActive() {
    return (
      open &&
      workspace.desk === "scene" &&
      show.checked &&
      brush.value !== selectBrush &&
      !restoring
    );
  }
  function syncSelection() {
    const scene = workspace.desk === "scene" ? workspace.active.scene : undefined;
    const area = scene && selectionFor(scene);
    const active = toolActive();
    brushModeChanged(active);
    apply.disabled = !area || !active;
    applyCoordinates.disabled = !active;
    canvas.classList.toggle("painting-blockout", active);
    canvas.classList.toggle("showing-blockout-grid", open && !!scene && show.checked);
    selection.hidden = !area;
    if (open && scene && area) {
      const kinds = new Set<string>();
      let painted = 0;
      for (const region of scene.blockout.terrain) {
        const count = overlappingTiles(region, area);
        if (count) kinds.add(terrainKinds[region.kind]);
        painted += count;
      }
      if (painted < area.width * area.height) kinds.add("Unpainted");
      selectionInfo.textContent = `${area.width}×${area.height} tiles · ${[...kinds].join(", ")}`;
      selectionInfo.title = selectionInfo.textContent;
    }
  }
  function syncElements(scene: Scene) {
    if (!elements.open) return;
    const active = document.activeElement;
    const focused =
      active instanceof HTMLButtonElement
        ? [...items.querySelectorAll("button")].indexOf(active)
        : -1;
    items.replaceChildren();
    for (const marker of scene.blockout.elements) {
      const name = marker.label || elementKinds[marker.kind].label;
      const row = el("li");
      const remove = button(
        "Remove",
        () => void save(scene.id, { op: "remove", id: marker.id }),
        "blockout-remove",
      );
      remove.setAttribute("aria-label", `Remove ${name}`);
      row.append(el("span", "", `${name} · ${marker.x}, ${marker.y}`), remove);
      items.append(row);
    }
    if (!items.childElementCount) items.append(el("li", "", "No markers or guides yet"));
    if (focused >= 0) {
      const buttons = items.querySelectorAll("button");
      (
        buttons[Math.min(focused, buttons.length - 1)] ?? elements.querySelector("summary")
      )?.focus();
    }
  }
  function syncBrush() {
    const kind = brush.value;
    const terrain = isKeyOf(terrainKinds, kind);
    const element = isKeyOf(elementKinds, kind);
    if (terrain) swatch.dataset.terrain = kind;
    else delete swatch.dataset.terrain;
    swatch.textContent = element ? elementKinds[kind].symbol : "";
    swatch.hidden = !terrain && !element;
    get("blockout-label-field").hidden = !element;
  }
  function sync() {
    const scene = workspace.desk === "scene" ? workspace.active.scene : undefined;
    if (sceneId !== scene?.id) {
      sceneId = scene?.id;
      open = false;
      brush.value = selectBrush;
      label.value = "";
      coordinates.reset();
      notice("");
    }
    if (!open) setup.open = elements.open = false;
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (scene) {
      profile.value = scene.blockout.profile;
      x.max = String(scene.width - 1);
      y.max = String(scene.height - 1);
      width.max = String(scene.width);
      height.max = String(scene.height);
      if (open) syncElements(scene);
    }
    syncBrush();
    syncSelection();
  }
  async function persist(target: string, change: { edit: BlockoutEdit } | { layer: Blockout }) {
    const baseRevision = workspace.snapshot.revision;
    const restore = "layer" in change;
    const response = await fetch(
      `./api/project/scenes/${target}/${restore ? "blockout" : "actions"}`,
      {
        method: restore ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          restore
            ? { baseRevision, blockout: change.layer }
            : { baseRevision, action: "blockout", blockout: [change.edit] },
        ),
      },
    );
    if (response.headers.get("Cartquilt-Conflict") === "stale-revision")
      throw Error("The project changed on disk. Reopen it to load the latest blockout.");
    if (!response.ok) throw Error((await response.text()).trim());
    workspace.acceptSceneAction(decode(await response.json()), target, "blockout");
  }
  async function changeBlockout(
    target: string,
    write: () => Promise<void>,
    success = "Blockout saved.",
  ) {
    const name = workspace.documentFor(target).scene.name;
    const queued = pending.get(target) ?? 0;
    if (!queued) saveErrors.delete(target);
    pending.set(target, queued + 1);
    notice("Saving blockout…");
    syncSelection();
    syncSaveFeedback();
    saveStateChanged();
    try {
      await write();
      redrawLayer(target);
    } catch (error) {
      saveErrors.set(target, `Could not save blockout for ${name}. ${(error as Error).message}`);
    } finally {
      const remaining = (pending.get(target) ?? 1) - 1;
      if (remaining) pending.set(target, remaining);
      else {
        pending.delete(target);
        if (sceneId === target) notice(saveErrors.has(target) ? "" : success);
      }
      syncSaveFeedback();
      sync();
      saveStateChanged();
    }
  }
  async function save(target: string, edit: BlockoutEdit) {
    if (restoring) return;
    const document = workspace.documentFor(target);
    const finish = document.beginBlockoutEdit();
    await changeBlockout(target, () =>
      queueWrite(async () => {
        const previous = document.baseline.blockout;
        let saved = false;
        try {
          await persist(target, { edit });
          saved = true;
        } finally {
          finish(saved ? previous : undefined);
        }
      }),
    );
  }
  async function history(direction: HistoryDirection) {
    if (pending.size || workspace.desk !== "scene") return;
    const document = workspace.active;
    const target = document.scene.id;
    restoring = true;
    try {
      await changeBlockout(
        target,
        () =>
          document.restoreBlockoutHistory(direction, (layer) =>
            queueWrite(() => persist(target, { layer })),
          ),
        direction === "undo" ? "Blockout edit undone." : "Blockout edit redone.",
      );
    } finally {
      restoring = false;
      syncSelection();
    }
  }
  function applyBrush(scene: Scene, area: TileArea) {
    if (!toolActive() || scene.id !== sceneId) return false;
    const value = brush.value;
    if (value === terrainEraser || value === elementEraser) {
      void save(scene.id, { op: value, area });
    } else if (isKeyOf(terrainKinds, value)) {
      void save(scene.id, { op: "paint", kind: value, area });
    } else if (isKeyOf(elementKinds, value)) {
      if (elementKinds[value].point && (area.width !== 1 || area.height !== 1)) {
        notice(`${elementKinds[value].label} uses one tile.`, true);
        return true;
      }
      void save(scene.id, {
        op: "place",
        kind: value,
        area,
        label: label.value.trim() || undefined,
      });
    }
    return true;
  }

  toggle.onclick = (event) => {
    open = !open;
    if (open) stopPlacement();
    else notice("");
    sync();
    if (open && event.detail === 0) brush.focus();
  };
  for (const details of [setup, elements]) {
    document.addEventListener("pointerdown", (event) => {
      if (details.open && event.target instanceof Node && !details.contains(event.target)) {
        details.open = false;
      }
    });
    details.addEventListener("focusout", (event) => {
      if (event.relatedTarget instanceof Node && !details.contains(event.relatedTarget)) {
        details.open = false;
      }
    });
  }
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape") return;
      const details = setup.open ? setup : elements.open ? elements : undefined;
      if (!details) return;
      event.preventDefault();
      event.stopPropagation();
      details.open = false;
      details.querySelector("summary")?.focus();
    },
    { capture: true },
  );
  brush.onchange = () => {
    if (brush.value !== selectBrush) stopPlacement();
    if (brush.value !== selectBrush && !show.checked) {
      show.checked = true;
      if (sceneId) redrawLayer(sceneId);
    }
    sync();
  };
  show.onchange = () => {
    if (sceneId) redrawLayer(sceneId);
    syncSelection();
  };
  profile.onchange = () => {
    if (pending.size) {
      sync();
      return;
    }
    const value = profile.value;
    if (sceneId && isKeyOf(movementProfiles, value))
      void save(sceneId, { op: "profile", profile: value });
  };
  apply.onclick = () => {
    const scene = workspace.active.scene;
    const area = selectionFor(scene);
    if (area) applyBrush(scene, area);
  };
  coordinates.onsubmit = (event) => {
    event.preventDefault();
    applyBrush(workspace.active.scene, {
      x: x.valueAsNumber,
      y: y.valueAsNumber,
      width: width.valueAsNumber,
      height: height.valueAsNumber,
    });
  };
  elements.ontoggle = () => {
    if (open && workspace.desk === "scene") syncElements(workspace.active.scene);
  };

  return {
    sync,
    syncSelection,
    applyBrush,
    history,
    get busy() {
      return pending.size > 0;
    },
    get saveFailed() {
      return saveErrors.size > 0;
    },
    get visible() {
      return show.checked;
    },
    disarm() {
      brush.value = selectBrush;
      sync();
    },
  };
}

export function drawBlockout(art: HTMLElement, scene: Scene, visible = true) {
  art.querySelector(":scope > .blockout-layer")?.remove();
  if (!visible || (!scene.blockout.terrain.length && !scene.blockout.elements.length)) return;
  const layer = el("span", "blockout-layer");
  layer.setAttribute("aria-hidden", "true");
  for (const region of scene.blockout.terrain) {
    const tile = el("span", "blockout-terrain");
    tile.dataset.terrain = region.kind;
    positionTileArea(tile, region, scene);
    layer.append(tile);
  }
  for (const marker of scene.blockout.elements) {
    const style = elementKinds[marker.kind];
    const node = el("span", style.point ? "blockout-marker" : "blockout-guide");
    node.dataset.element = marker.kind;
    const caption = el("span", "blockout-symbol", style.symbol);
    node.append(caption);
    positionTileArea(node, marker, scene);
    layer.append(node);
  }
  const background = art.querySelector(":scope > .background");
  if (background) background.after(layer);
  else art.prepend(layer);
}
