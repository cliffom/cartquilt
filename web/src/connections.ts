import {
  el,
  get,
  pointerButton,
  positionContextMenu,
  positionTileArea,
  pressedPointerButton,
  tileAt,
} from "./dom.js";
import {
  areasOverlap,
  containsTile,
  isMultiTile,
  tileArea,
  type TileArea,
} from "./grid-geometry.js";
import {
  decode,
  type Entrance,
  type Exit,
  type Point,
  type Project,
  type Scene,
  type Workspace,
} from "./model.js";
import type { QueueSceneWrite } from "./scene-actions.js";

const tileDragThresholdPx = 4;
const worldArrowTipGapPx = 6;
const worldArrowLaneSpacingPx = 8;

type Kind = "entrance" | "exit";

type ConnectionTarget = { sceneId: string; kind: Kind; id: string };
type TileSelection = { sceneId: string; anchor: Point; area?: TileArea };
type GridOverlays = { highlight: HTMLElement; selection: HTMLElement; hovered?: Point };
type GridSurface = { art: HTMLElement; scene: Scene; anchor: HTMLElement };
type TileDrag = GridSurface & {
  pointerId: number;
  start: Point;
  origin: Point;
  preview?: HTMLElement;
};

function connectionFootprint(point: Entrance | Exit) {
  return "width" in point ? point : tileArea(point);
}

function firstFreeTile(scene: Scene): Point | undefined {
  const occupied = [...scene.entrances, ...scene.exits].map(connectionFootprint);
  for (let y = 0; y < scene.height; y++) {
    let x = 0;
    while (x < scene.width) {
      const covering = occupied.find((area) => containsTile(area, x, y));
      if (!covering) return { x, y };
      x = covering.x + covering.width;
    }
  }
}

export function sceneConnections(project: Project) {
  const scenes = new Map(project.scenes.map((scene) => [scene.id, scene]));
  return project.scenes.flatMap((source) =>
    source.exits.flatMap((exit) => {
      const target = scenes.get(exit.destination.sceneId);
      const entrance = target?.entrances.find((entry) => entry.id === exit.destination.entranceId);
      return target && entrance ? [{ source, exit, target, entrance }] : [];
    }),
  );
}

export function connectionLabel(link: ReturnType<typeof sceneConnections>[number]) {
  return `${link.source.name} · ${link.exit.name} → ${link.target.name} · ${link.entrance.name}`;
}

export function setupConnections(
  workspace: Workspace,
  queueWrite: QueueSceneWrite,
  canvas: HTMLElement,
  render: () => void,
  gridTools: {
    applyBrush: (scene: Scene, area: TileArea) => boolean;
    selectionChanged: () => void;
  },
) {
  const menu = get("connection-menu");
  const addEntrance = get<HTMLButtonElement>("add-entrance-here");
  const addExit = get<HTMLButtonElement>("add-exit-here");
  const removals = get("connection-removals");
  const dialog = get<HTMLDialogElement>("connection-dialog");
  const form = get<HTMLFormElement>("connection-form");
  const name = get<HTMLInputElement>("connection-name");
  const x = get<HTMLInputElement>("connection-x");
  const y = get<HTMLInputElement>("connection-y");
  const width = get<HTMLInputElement>("connection-width");
  const height = get<HTMLInputElement>("connection-height");
  const destinationScene = get<HTMLSelectElement>("destination-scene");
  const destinationEntrance = get<HTMLSelectElement>("destination-entrance");
  const submit = get<HTMLButtonElement>("save-connection");
  const cancel = get<HTMLButtonElement>("cancel-connection");
  const remove = get<HTMLButtonElement>("remove-connection");
  const status = get("connection-status");
  let placing: { kind: Kind; sceneId: string } | undefined;
  let drag: TileDrag | undefined;
  let pressedTile: { art: HTMLElement; tile: Point } | undefined;
  let suppressTileClick = false;
  let tileSelection: TileSelection | undefined;
  let menuTarget: { sceneId: string; area: TileArea; anchor: HTMLElement } | undefined;
  let edit: ConnectionTarget | undefined;
  let removingFromMenu = false;
  const gridOverlays = new WeakMap<HTMLElement, GridOverlays>();

  function destinations(sceneId: string) {
    return workspace.snapshot.project.scenes.filter(
      (scene) => scene.id !== sceneId && scene.entrances.length,
    );
  }
  function updateEntrances() {
    const scene = workspace.snapshot.project.scenes.find(
      (candidate) => candidate.id === destinationScene.value,
    );
    destinationEntrance.replaceChildren(
      ...(scene?.entrances.map((entry) => new Option(entry.name, entry.id)) ?? []),
    );
  }
  destinationScene.onchange = updateEntrances;
  function updateBounds() {
    const scene = workspace.documentFor(edit?.sceneId).scene;
    width.max = String(scene.width - x.valueAsNumber);
    height.max = String(scene.height - y.valueAsNumber);
  }
  x.oninput = y.oninput = updateBounds;

  function editPoint(
    scene: Scene,
    kind: Kind,
    point: Entrance & Partial<Pick<Exit, "width" | "height" | "destination">>,
  ) {
    edit = { sceneId: scene.id, kind, id: point.id };
    form.reset();
    status.textContent = "";
    name.value = point.name;
    x.max = String(scene.width - 1);
    y.max = String(scene.height - 1);
    x.value = String(point.x);
    y.value = String(point.y);
    width.value = String(point.width ?? 1);
    height.value = String(point.height ?? 1);
    updateBounds();
    get("connection-exit-fields").hidden = kind !== "exit";
    for (const input of [width, height, destinationScene, destinationEntrance]) {
      input.disabled = kind !== "exit";
    }
    destinationScene.replaceChildren(
      ...destinations(scene.id).map((candidate) => new Option(candidate.name, candidate.id)),
    );
    if (point.destination) destinationScene.value = point.destination.sceneId;
    updateEntrances();
    if (point.destination) destinationEntrance.value = point.destination.entranceId;
    get("connection-title").textContent = `${point.id ? "Edit" : "Add"} ${kind}`;
    remove.hidden = !point.id;
    dialog.showModal();
    name.focus();
  }

  function hideMenu(restoreFocus = false) {
    if (menu.hidden) return;
    menu.hidden = true;
    if (restoreFocus) (menuTarget?.anchor ?? canvas).focus({ preventScroll: true });
    menuTarget = undefined;
  }
  function clearDrag() {
    if (!drag) return;
    const { pointerId, preview } = drag;
    drag = undefined;
    preview?.remove();
    canvas.classList.remove("selecting-tile-area");
    if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
  }
  function resetPlacement() {
    hideMenu();
    clearDrag();
    pressedTile = undefined;
    updateTileSelection();
    placing = undefined;
    canvas.classList.remove("placing-connection");
  }
  function canPlace(kind: Kind, sceneId: string) {
    if (kind === "entrance" || destinations(sceneId).length) return true;
    get("hints").textContent = "Add a named entrance to another scene first.";
    return false;
  }
  function focusSceneSurface(sceneId: string) {
    const card = canvas.querySelector<HTMLElement>(`.card[data-id="${CSS.escape(sceneId)}"]`);
    (card ?? canvas).focus({ preventScroll: true });
  }
  function finishPlacement(kind: Kind, area: TileArea, sceneId = workspace.active.scene.id) {
    if (workspace.desk === "world") {
      hideMenu(true);
      updateTileSelection();
    } else {
      resetPlacement();
      render();
      focusSceneSurface(sceneId);
    }
    if (canPlace(kind, sceneId))
      editPoint(workspace.documentFor(sceneId).scene, kind, { id: "", name: "", ...area });
  }
  function sceneArt() {
    return canvas.classList.contains("scene") ? canvas.querySelector<HTMLElement>(".art") : null;
  }
  function gridForEvent(event: Event): GridSurface | undefined {
    if (!(event.target instanceof Element)) return;
    const art = event.target.closest<HTMLElement>("[data-grid-scene]");
    const id = art?.dataset.gridScene;
    if (art && id) {
      const anchor = art.closest<HTMLElement>(".card") ?? canvas;
      return { art, scene: workspace.documentFor(id).scene, anchor };
    }
    const editorArt = sceneArt();
    if (editorArt) return { art: editorArt, scene: workspace.active.scene, anchor: canvas };
  }
  function selectedTiles(scene: Scene) {
    return tileSelection?.sceneId === scene.id ? tileSelection.area : undefined;
  }
  function drawCellHover(overlays: GridOverlays, scene: Scene, selection = selectedTiles(scene)) {
    const tile = overlays.hovered;
    const inside =
      tile && selection && isMultiTile(selection) && containsTile(selection, tile.x, tile.y);
    overlays.highlight.hidden = !tile || !!inside;
    if (tile && !inside) positionTileArea(overlays.highlight, tileArea(tile), scene);
  }
  function drawTileSelection(art: HTMLElement, scene: Scene) {
    const overlays = gridOverlays.get(art);
    if (!overlays) return;
    const area = selectedTiles(scene);
    overlays.selection.hidden = !area;
    if (area) positionTileArea(overlays.selection, area, scene);
    drawCellHover(overlays, scene, area);
  }
  function updateTileSelection(next?: TileSelection) {
    const previousId = tileSelection?.sceneId;
    tileSelection = next;
    for (const id of new Set([previousId, next?.sceneId])) {
      if (!id) continue;
      const art = canvas.querySelector<HTMLElement>(`[data-grid-scene="${CSS.escape(id)}"]`);
      const document = workspace.documents.get(id);
      if (art && document) drawTileSelection(art, document.scene);
    }
    gridTools.selectionChanged();
  }
  function showMenu(scene: Scene, tile: Point, x: number, y: number, anchor: HTMLElement) {
    if (drag?.preview || removingFromMenu) return;
    const selection = selectedTiles(scene);
    const cell = tileArea(tile);
    const area = selection && containsTile(selection, tile.x, tile.y) ? selection : cell;
    menuTarget = { sceneId: scene.id, area, anchor };
    const multiTile = isMultiTile(area);
    removals.replaceChildren();
    for (const [kind, points] of [
      ["entrance", scene.entrances],
      ["exit", scene.exits],
    ] as const) {
      for (const point of points) {
        const footprint = connectionFootprint(point);
        if (!areasOverlap(area, footprint)) continue;
        const item = el("button", "scene-delete-menu", `Remove ${kind} · ${point.name}…`);
        item.type = "button";
        item.tabIndex = -1;
        item.setAttribute("role", "menuitem");
        item.onclick = () =>
          void removeFromMenu({ sceneId: scene.id, kind, id: point.id }, point.name);
        removals.append(item);
      }
    }
    removals.hidden = !removals.childElementCount;
    addEntrance.hidden = multiTile;
    addEntrance.disabled = multiTile || !removals.hidden;
    addExit.disabled = !removals.hidden;
    positionContextMenu(menu, x, y);
    menu
      .querySelector<HTMLButtonElement>("[role=menuitem]:enabled")
      ?.focus({ preventScroll: true });
  }

  function openGridMenu(event: MouseEvent, art: HTMLElement, scene: Scene, anchor: HTMLElement) {
    const tile = tileAt(art, event, scene.width, scene.height);
    if (!tile) return;
    event.preventDefault();
    event.stopPropagation();
    showMenu(scene, tile, event.clientX, event.clientY, anchor);
  }
  function openGridMenuAtAnchor(
    art: HTMLElement,
    scene: Scene,
    anchor: HTMLElement,
    point = selectedTiles(scene) ?? { x: 0, y: 0 },
  ) {
    const bounds = art.getBoundingClientRect();
    const focused = art.contains(anchor) ? anchor.getBoundingClientRect() : undefined;
    const clientX = focused
      ? focused.left + focused.width / 2
      : bounds.left + ((point.x + 0.5) * bounds.width) / scene.width;
    const clientY = focused
      ? focused.top + focused.height / 2
      : bounds.top + ((point.y + 0.5) * bounds.height) / scene.height;
    const tile = tileAt(art, { clientX, clientY }, scene.width, scene.height, true);
    if (tile) showMenu(scene, tile, clientX, clientY, anchor);
  }
  addEntrance.onclick = () => {
    if (menuTarget) finishPlacement("entrance", menuTarget.area, menuTarget.sceneId);
  };
  addExit.onclick = () => {
    if (menuTarget) finishPlacement("exit", menuTarget.area, menuTarget.sceneId);
  };
  menu.onkeydown = (event) => {
    if (event.key === "Escape" || event.key === "Tab") {
      hideMenu(true);
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    const items = [...menu.querySelectorAll<HTMLButtonElement>("[role=menuitem]:enabled")];
    const index = event.target instanceof HTMLButtonElement ? items.indexOf(event.target) : -1;
    const shortcuts: Record<string, number> = {
      ArrowDown: (index + 1) % items.length,
      ArrowUp: (index - 1 + items.length) % items.length,
      Home: 0,
      End: items.length - 1,
    };
    if (Object.hasOwn(shortcuts, event.key)) {
      event.preventDefault();
      items[shortcuts[event.key]]?.focus();
    }
  };
  document.addEventListener("pointerdown", (event) => {
    if (event.target instanceof Node && !menu.contains(event.target)) hideMenu();
  });
  window.addEventListener("resize", () => hideMenu(menu.contains(document.activeElement)));

  canvas.addEventListener(
    "click",
    (event) => {
      if (!event.detail) return;
      if (suppressTileClick) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const grid = gridForEvent(event);
      if (!grid) {
        updateTileSelection();
        return;
      }
      const { art, scene } = grid;
      const tile =
        pressedTile?.art === art ? pressedTile.tile : tileAt(art, event, scene.width, scene.height);
      pressedTile = undefined;
      if (event.shiftKey && tile) {
        event.preventDefault();
        event.stopPropagation();
        const anchor = tileSelection?.sceneId === scene.id ? tileSelection.anchor : tile;
        updateTileSelection({ sceneId: scene.id, anchor, area: tileArea(anchor, tile) });
        grid.anchor.focus({ preventScroll: true });
        return;
      }
      if (placing) {
        event.preventDefault();
        event.stopPropagation();
        if (placing.kind === "entrance" && tile)
          finishPlacement("entrance", tileArea(tile), scene.id);
        return;
      }
      if (tile && gridTools.applyBrush(scene, tileArea(tile))) {
        event.preventDefault();
        event.stopPropagation();
        grid.anchor.focus({ preventScroll: true });
        return;
      }
      updateTileSelection(tile ? { sceneId: scene.id, anchor: tile } : undefined);
    },
    true,
  );
  canvas.addEventListener("pointerdown", (event) => {
    if (drag || event.button !== pointerButton.primary || !event.isPrimary) return;
    suppressTileClick = false;
    pressedTile = undefined;
    const grid = gridForEvent(event);
    if (!grid) return;
    const { art, scene } = grid;
    const start = tileAt(art, event, scene.width, scene.height);
    if (!start) return;
    pressedTile = { art, tile: start };
    if (placing?.kind === "entrance" || event.shiftKey) return;
    drag = {
      ...grid,
      pointerId: event.pointerId,
      start,
      origin: { x: event.clientX, y: event.clientY },
    };
    if (placing?.kind === "exit") {
      positionTileArea(showDragPreview(drag), tileArea(start), scene);
      event.preventDefault();
    }
  });
  function showDragPreview(current: TileDrag) {
    const preview = el("span", "tile-drag-preview");
    preview.setAttribute("aria-hidden", "true");
    current.art.append(preview);
    current.preview = preview;
    suppressTileClick = true;
    canvas.classList.add("selecting-tile-area");
    canvas.setPointerCapture(current.pointerId);
    current.anchor.focus({ preventScroll: true });
    return preview;
  }
  function selectedArea(event: PointerEvent, current: TileDrag, scene: Scene) {
    const end = tileAt(current.art, event, scene.width, scene.height, true);
    return tileArea(current.start, end);
  }
  window.addEventListener("pointermove", (event) => {
    if (drag?.pointerId !== event.pointerId) return;
    if (!drag.art.isConnected) {
      clearDrag();
      return;
    }
    if ((event.buttons & pressedPointerButton.primary) === 0) {
      clearDrag();
      return;
    }
    if (
      !drag.preview &&
      Math.hypot(event.clientX - drag.origin.x, event.clientY - drag.origin.y) < tileDragThresholdPx
    )
      return;
    const { scene } = drag;
    positionTileArea(
      drag.preview ?? showDragPreview(drag),
      selectedArea(event, drag, scene),
      scene,
    );
  });
  window.addEventListener("pointerup", (event) => {
    if (drag?.pointerId !== event.pointerId) return;
    const current = drag;
    clearDrag();
    if (event.button !== pointerButton.primary || !current.preview || !current.art.isConnected)
      return;
    const { scene } = current;
    const area = selectedArea(event, current, scene);
    if (placing?.kind === "exit") {
      finishPlacement("exit", area, scene.id);
      return;
    }
    if (gridTools.applyBrush(scene, area)) return;
    updateTileSelection({ sceneId: scene.id, anchor: current.start, area });
  });
  window.addEventListener("blur", clearDrag);
  for (const type of ["pointercancel", "lostpointercapture"] as const) {
    canvas.addEventListener(type, (event) => {
      if (
        drag?.pointerId === event.pointerId &&
        (type === "pointercancel" || event.target === canvas)
      )
        clearDrag();
    });
  }
  canvas.addEventListener("keydown", (event) => {
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      const art = sceneArt();
      if (!art) return;
      event.preventDefault();
      event.stopPropagation();
      const anchor = event.target instanceof HTMLElement ? event.target : canvas;
      openGridMenuAtAnchor(art, workspace.active.scene, anchor);
      return;
    }
    if (placing && event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      const area = placing.kind === "exit" ? selectedTiles(workspace.active.scene) : undefined;
      finishPlacement(placing.kind, area ?? tileArea({ x: 0, y: 0 }), placing.sceneId);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || document.querySelector("dialog[open]")) return;
    if (placing) {
      event.preventDefault();
      event.stopImmediatePropagation();
      resetPlacement();
      render();
      return;
    }
    if (drag?.preview || tileSelection?.area) {
      event.preventDefault();
      event.stopImmediatePropagation();
      clearDrag();
      updateTileSelection();
    }
  });

  function writeConnection(
    current: ConnectionTarget,
    value: Pick<Entrance, "id">,
    deleting: boolean,
  ) {
    return queueWrite(async () => {
      const response = await fetch(`./api/project/scenes/${current.sceneId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseRevision: workspace.snapshot.revision,
          action: deleting ? `remove-${current.kind}` : current.kind,
          [current.kind]: value,
        }),
      });
      if (response.headers.get("Cartquilt-Conflict") === "stale-revision")
        throw Error("The project changed on disk. Reopen it to load the latest connections.");
      if (!response.ok) throw Error((await response.text()).trim());
      workspace.acceptSceneAction(decode(await response.json()), current.sceneId, "connection");
    });
  }

  async function removeFromMenu(current: ConnectionTarget, pointName: string) {
    const anchor = menuTarget?.anchor;
    hideMenu(true);
    if (removingFromMenu || !window.confirm(`Remove ${current.kind} “${pointName}”?`)) return;
    removingFromMenu = true;
    const feedback = get("hints");
    feedback.textContent = `Removing ${current.kind}…`;
    try {
      await writeConnection(current, { id: current.id }, true);
      const restoreFocus = document.activeElement === anchor;
      render();
      if (restoreFocus) focusSceneSurface(current.sceneId);
    } catch (error) {
      feedback.textContent = (error as Error).message;
    } finally {
      removingFromMenu = false;
    }
  }

  async function save(deleting = false) {
    const current = edit;
    if (!current || submit.disabled) return;
    if (deleting && !window.confirm(`Remove this ${current.kind}?`)) return;
    submit.disabled = cancel.disabled = remove.disabled = true;
    status.textContent = "Saving…";
    const base = { id: current.id, name: name.value, x: x.valueAsNumber, y: y.valueAsNumber };
    const value =
      current.kind === "entrance"
        ? base
        : {
            ...base,
            width: width.valueAsNumber,
            height: height.valueAsNumber,
            destination: { sceneId: destinationScene.value, entranceId: destinationEntrance.value },
          };
    try {
      await writeConnection(current, value, deleting);
      dialog.close();
      render();
      focusSceneSurface(current.sceneId);
    } catch (error) {
      status.textContent = (error as Error).message;
    } finally {
      submit.disabled = cancel.disabled = remove.disabled = false;
    }
  }

  form.onsubmit = (event) => {
    event.preventDefault();
    void save();
  };
  remove.onclick = () => void save(true);
  cancel.onclick = () => dialog.close();
  dialog.oncancel = (event) => {
    if (submit.disabled) event.preventDefault();
  };

  return {
    get placement() {
      return placing?.kind;
    },
    syncDesk() {
      if (placing && (workspace.desk !== "scene" || workspace.selected !== placing.sceneId)) {
        resetPlacement();
      } else if (tileSelection && !workspace.documents.has(tileSelection.sceneId)) {
        updateTileSelection();
      }
    },
    start(kind: Kind) {
      const area = kind === "exit" ? selectedTiles(workspace.active.scene) : undefined;
      if (area) {
        finishPlacement(kind, area);
        return;
      }
      hideMenu();
      clearDrag();
      if (!canPlace(kind, workspace.active.scene.id)) {
        resetPlacement();
        return;
      }
      placing = { kind, sceneId: workspace.active.scene.id };
      canvas.classList.add("placing-connection");
      get("hints").textContent =
        kind === "exit"
          ? "Click one tile or drag across tiles for the exit. Enter opens the size and coordinates. Esc cancels."
          : "Click a tile for the entrance, or press Enter to enter coordinates. Esc cancels.";
      canvas.focus({ preventScroll: true });
    },
    resetPlacement,
    selectionFor: selectedTiles,
    editPoint,
    attachGrid(art: HTMLElement, scene: Scene, anchor = canvas) {
      art.dataset.gridScene = scene.id;
      const highlight = el("span", "scene-cell-hover");
      highlight.setAttribute("aria-hidden", "true");
      const selection = el("span", "scene-tile-selection");
      selection.setAttribute("aria-hidden", "true");
      const overlays: GridOverlays = { highlight, selection };
      gridOverlays.set(art, overlays);
      art.append(highlight, selection);
      drawTileSelection(art, scene);
      art.onpointermove = (event) => {
        if (event.pointerType !== "mouse") return;
        overlays.hovered = tileAt(art, event, scene.width, scene.height);
        drawCellHover(overlays, scene);
      };
      art.onpointerleave = () => {
        overlays.hovered = undefined;
        highlight.hidden = true;
      };
      art.oncontextmenu = (event) => openGridMenu(event, art, scene, anchor);
    },
    openPreviewMenu(sceneId: string, card: HTMLElement) {
      const art = card.querySelector<HTMLElement>(".art");
      const scene = workspace.documentFor(sceneId).scene;
      if (art) openGridMenuAtAnchor(art, scene, card, selectedTiles(scene) ?? firstFreeTile(scene));
    },
  };
}

export function drawConnectionMarkers(
  art: HTMLElement,
  scene: Scene,
  edit?: (kind: Kind, point: Entrance | Exit) => void,
) {
  for (const [kind, points] of [
    ["entrance", scene.entrances],
    ["exit", scene.exits],
  ] as const) {
    for (const point of points) {
      const classes = `scene-marker scene-marker-${kind}`;
      const node = edit
        ? el("button", classes, kind === "entrance" ? "IN" : "OUT")
        : el("span", `${classes} scene-marker-preview`);
      if (node instanceof HTMLButtonElement) {
        node.type = "button";
        node.title = `${kind === "entrance" ? "Entrance" : "Exit"} · ${point.name}`;
        node.setAttribute("aria-label", node.title);
        node.onclick = () => edit?.(kind, point);
      } else {
        node.setAttribute("aria-hidden", "true");
      }
      positionTileArea(node, connectionFootprint(point), scene);
      art.append(node);
    }
  }
}

export function positionWorldConnections(plane: HTMLElement, workspace: Workspace) {
  const cards = new Map(
    [...plane.querySelectorAll<HTMLElement>(".card")].map((card) => [card.dataset.id, card]),
  );
  for (const edge of plane.querySelectorAll<HTMLElement>(".world-connection")) {
    const { source, target, lane } = edge.dataset;
    const from = cards.get(source);
    const to = cards.get(target);
    if (!from || !to) continue;
    const start = workspace.positionFor(source);
    const end = workspace.positionFor(target);
    const dx = end.x + to.offsetWidth / 2 - (start.x + from.offsetWidth / 2);
    const dy = end.y + to.offsetHeight / 2 - (start.y + from.offsetHeight / 2);
    const distance = Math.hypot(dx, dy);
    const inset = (card: HTMLElement) =>
      Math.min(
        Math.abs((card.offsetWidth * distance) / (2 * dx)),
        Math.abs((card.offsetHeight * distance) / (2 * dy)),
      );
    const beginning = inset(from);
    const length = distance - beginning - inset(to) - worldArrowTipGapPx;
    edge.hidden = !Number.isFinite(length) || length <= 0;
    if (edge.hidden) continue;
    const offset = Number(lane) * worldArrowLaneSpacingPx;
    edge.style.left = `${start.x + from.offsetWidth / 2 + (dx * beginning - dy * offset) / distance}px`;
    edge.style.top = `${start.y + from.offsetHeight / 2 + (dy * beginning + dx * offset) / distance}px`;
    edge.style.width = `${length}px`;
    edge.style.transform = `translateY(-50%) rotate(${Math.atan2(dy, dx)}rad)`;
  }
}
