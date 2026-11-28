import "./editor.css";
import { artworkImage, isArtworkReference } from "./artwork-model.js";
import { setupArtworkMove } from "./artwork-move.js";
import { drawTileLayers, setupArtwork } from "./artwork.js";
import { drawBlockout, setupBlockout } from "./blockout.js";
import {
  connectionLabel,
  drawConnectionMarkers,
  positionWorldConnections,
  sceneConnections,
  setupConnections,
} from "./connections.js";
import { button, el, get, pointerButton, pressedPointerButton } from "./dom.js";
import { createSceneWriteQueue, setupSceneActions, type QueueSceneWrite } from "./scene-actions.js";
import { decode, Workspace, type Scene, type Point } from "./model.js";
import {
  gbcViewportTiles,
  maxSceneTilesPerAxis,
  minSceneTilesPerAxis,
  pixelsPerTile,
} from "./project-constants.js";
import { setupSceneLayers } from "./scene-layers.js";
import { gbcSpriteLimits, sceneMetrics } from "./scene-metrics.js";

const launcherPreference = "cartquilt.showLauncher";
const recentProjectsKey = "cartquilt.recentProjects";
const recentProjectLimit = 8;
const serviceHealthTimeoutMs = 3_000;
const serviceHealthIntervalMs = 15_000;
const downloadURLLifetimeMs = 30_000;
const httpStatus = { noContent: 204, notFound: 404 } as const;
const sceneCanvasHint = "Drag or Shift-click to select tiles · Right-click to add a connection";
const moveCanvasHint = "Click or drag to select cells · Drag selection or use arrows to move";
const brushCanvasHint = "Click or drag to apply the brush · Shift-click to select tiles";
const viewport = {
  zoomStep: 1.2,
  minZoom: 0.1,
  maxZoom: 4,
  maxWheelDelta: 200,
  wheelZoomRate: 0.003,
  dragThresholdPx: 3,
  keyboardPanPx: 24,
} as const;
const worldMap = {
  minFitZoom: 0.01,
  maxFitZoom: 1.25,
  fitPaddingPx: 18,
  keyboardSceneMovePx: 8,
} as const;

type RecentProject = { name: string; path: string };

function recentProjects(): RecentProject[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(recentProjectsKey) ?? "[]");
    return Array.isArray(saved)
      ? saved
          .filter((entry) => typeof entry?.name === "string" && typeof entry?.path === "string")
          .slice(0, recentProjectLimit)
      : [];
  } catch {
    return [];
  }
}

function saveRecentProjects(projects: RecentProject[]): boolean {
  try {
    localStorage.setItem(recentProjectsKey, JSON.stringify(projects.slice(0, recentProjectLimit)));
    return true;
  } catch {
    return false;
  }
}

async function accessProject(path: string, name?: string) {
  const response = await fetch(name === undefined ? "/api/project-open" : "/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(name === undefined ? { path } : { path, name }),
  });
  if (!response.ok) throw Error((await response.text()).trim());
  const url = response.headers.get("Location");
  if (!url)
    throw Error("Cartquilt did not return a project URL. Choose Open project to try again.");
  const saved = await response.json();
  const { project } = decode(saved);
  if (typeof saved.path === "string" && saved.path) {
    const entry = { name: project.name, path: saved.path };
    const recent = [entry, ...recentProjects().filter((item) => item.path !== entry.path)];
    saveRecentProjects(recent);
  }
  return { url, name: project.name };
}

function img(file: string, cls = "") {
  const node = el("img", cls);
  node.src = isArtworkReference("sprite", file) ? artworkImage("sprite", file) : `./assets/${file}`;
  node.alt = "";
  node.draggable = false;
  return node;
}
function pressed(node: HTMLElement, selected: boolean) {
  node.setAttribute("aria-pressed", String(selected));
}

function monitorService() {
  const indicator = get("service-status");
  const label = indicator.querySelector("span");
  let checking = false;
  async function check() {
    if (checking || document.hidden) return;
    checking = true;
    let live = false;
    try {
      const response = await fetch("/api/project", {
        method: "HEAD",
        cache: "no-store",
        signal: AbortSignal.timeout(serviceHealthTimeoutMs),
      });
      live = response.ok;
    } catch {
      // A stopped or unresponsive service appears offline.
    } finally {
      checking = false;
    }
    const message = live ? "Service online" : "Service unavailable";
    indicator.dataset.state = live ? "online" : "offline";
    indicator.title = message;
    if (label && label.textContent !== message) label.textContent = message;
  }
  void check();
  window.setInterval(check, serviceHealthIntervalMs);
  document.addEventListener("visibilitychange", check);
}

function setupProjectDialog() {
  const dialog = get<HTMLDialogElement>("new-project-dialog");
  const form = get<HTMLFormElement>("new-project-form");
  const name = get<HTMLInputElement>("project-name");
  const path = get<HTMLInputElement>("project-path");
  const submit = get<HTMLButtonElement>("create-project");
  const cancel = get<HTMLButtonElement>("close-project-dialog");
  const result = get("create-project-result");
  const browse = get<HTMLButtonElement>("browse-project-folders");
  let mode: "create" | "open" = "create";
  let parent: string | undefined;
  let picker: AbortController | undefined;
  function suggestProjectPath() {
    if (!parent) return;
    // Use the project name as one path component and let the creator edit the result.
    const folder = name.value
      .trim()
      .replace(/[<>:"/\\|?*]/g, "-")
      .replace(/[. ]+$/, "");
    path.value = `${parent.endsWith("/") ? parent : `${parent}/`}${folder || "New Project"}`;
  }
  browse.onclick = async () => {
    const controller = new AbortController();
    picker = controller;
    browse.disabled = submit.disabled = path.disabled = true;
    result.textContent =
      mode === "create"
        ? "Choose a parent folder in the macOS dialog…"
        : "Choose the project folder in the macOS dialog…";
    try {
      const response = await fetch("/api/project-folder-picker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: controller.signal,
      });
      if (!response.ok) throw Error((await response.text()).trim());
      if (response.status !== httpStatus.noContent) {
        const selected: { path: string } = await response.json();
        if (controller.signal.aborted) return;
        if (mode === "open") {
          path.value = selected.path;
        } else {
          parent = selected.path;
          suggestProjectPath();
        }
      }
      result.textContent = "";
    } catch (error) {
      if (!controller.signal.aborted) result.textContent = (error as Error).message;
    } finally {
      if (picker === controller) {
        picker = undefined;
        browse.disabled = submit.disabled = path.disabled = false;
        path.focus();
      }
    }
  };
  name.oninput = suggestProjectPath;
  path.oninput = () => {
    parent = undefined;
  };
  function show(next: typeof mode) {
    form.reset();
    mode = next;
    parent = undefined;
    const creating = mode === "create";
    get("new-project-title").textContent = creating ? "New project" : "Open project";
    get("project-name-field").hidden = !creating;
    name.required = creating;
    get("project-path-help").textContent = creating
      ? "Choose a parent folder or enter the full path to a new project folder."
      : "Choose the project folder or enter the full path to its saved JSON file.";
    submit.textContent = creating ? "Create project" : "Open project";
    submit.hidden = false;
    result.replaceChildren();
    dialog.showModal();
    (creating ? name : path).focus();
  }
  const menu = get<HTMLDetailsElement>("project-menu");
  const summary = menu.querySelector("summary");
  function dismissMenu() {
    menu.open = false;
    summary?.focus();
  }
  get("new-project").onclick = () => {
    dismissMenu();
    show("create");
  };
  get("open-project").onclick = () => {
    dismissMenu();
    show("open");
  };
  const confirmClose = get<HTMLDialogElement>("confirm-project-close");
  get("close-project").onclick = () => {
    dismissMenu();
    get("confirm-close-message").textContent = window.onbeforeunload
      ? "Unsaved edits in this tab will be discarded."
      : "You'll return to the project launcher.";
    confirmClose.returnValue = "";
    confirmClose.showModal();
  };
  confirmClose.onclose = () => {
    if (confirmClose.returnValue !== "close") return;
    // A project supplied at startup can still be closed in this tab.
    sessionStorage.setItem(launcherPreference, "true");
    window.onbeforeunload = null;
    window.location.replace("/");
  };
  menu.onkeydown = (event) => {
    if (event.key !== "Escape" || !menu.open) return;
    event.preventDefault();
    event.stopPropagation();
    dismissMenu();
  };
  menu.addEventListener("focusout", (event) => {
    if (event.relatedTarget instanceof Node && !menu.contains(event.relatedTarget)) {
      menu.open = false;
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
  });
  get("start-new-project").onclick = () => show("create");
  get("start-open-project").onclick = () => show("open");
  cancel.onclick = () => dialog.close();
  dialog.oncancel = (event) => {
    if (submit.disabled && !picker) event.preventDefault();
  };
  dialog.onclose = () => {
    if (!picker) return;
    picker.abort();
    picker = undefined;
    browse.disabled = submit.disabled = path.disabled = false;
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (submit.disabled || submit.hidden) return;
    submit.disabled = cancel.disabled = name.disabled = path.disabled = browse.disabled = true;
    const creating = mode === "create";
    result.textContent = creating ? "Creating project…" : "Opening project…";
    try {
      const project = await accessProject(path.value, creating ? name.value : undefined);
      if (!window.onbeforeunload) {
        submit.hidden = true;
        window.location.assign(project.url);
        return;
      }
      const link = el("a", "", `Open ${project.name} in a new tab`);
      link.href = project.url;
      link.target = "_blank";
      link.rel = "noopener";
      result.replaceChildren(link);
      submit.hidden = true;
      link.focus();
    } catch (error) {
      result.textContent = (error as Error).message;
    } finally {
      submit.disabled = cancel.disabled = name.disabled = path.disabled = browse.disabled = false;
      if (!submit.hidden) (creating ? name : path).focus();
    }
  };
}

function launcherStatus(message: string) {
  const status = get("launcher-status");
  status.textContent = message;
  status.hidden = !message;
}

function renderRecentProjects() {
  const section = get("recent-projects");
  const list = get("recent-project-list");
  const actions = get("launcher-actions");
  const recent = recentProjects();
  let opening = false;
  section.hidden = recent.length === 0;
  list.replaceChildren();
  for (const [index, project] of recent.entries()) {
    const row = button(
      "",
      async () => {
        if (opening) return;
        opening = true;
        actions.inert = true;
        section.setAttribute("aria-busy", "true");
        launcherStatus(`Opening ${project.name}…`);
        try {
          const opened = await accessProject(project.path);
          launcherStatus("");
          window.location.assign(opened.url);
        } catch (error) {
          launcherStatus(`Could not open ${project.name}. ${(error as Error).message}`);
        } finally {
          section.removeAttribute("aria-busy");
          actions.inert = false;
          opening = false;
        }
      },
      "recent-project-open",
    );
    row.title = project.path;
    row.append(
      el("span", "recent-project-name", project.name),
      el("span", "recent-project-path", project.path),
    );
    const remove = button(
      "×",
      () => {
        if (opening) return;
        const remaining = recentProjects().filter((item) => item.path !== project.path);
        if (!saveRecentProjects(remaining)) {
          launcherStatus("Could not update recent projects in this browser.");
          return;
        }
        renderRecentProjects();
        launcherStatus(`Removed ${project.name} from recent projects.`);
        const buttons = list.querySelectorAll<HTMLButtonElement>(".recent-project-remove");
        (buttons[Math.min(index, buttons.length - 1)] ?? get("start-open-project")).focus();
      },
      "recent-project-remove",
    );
    remove.title = "Remove from recent projects";
    remove.setAttribute("aria-label", `Remove ${project.name} from recent projects`);
    const item = el("li");
    item.append(row, remove);
    list.append(item);
  }
}

function showLauncher(message = "") {
  launcherStatus(message);
  renderRecentProjects();
  get("project-launcher").hidden = false;
}

function setupSceneCreation(
  w: Workspace,
  queueWrite: QueueSceneWrite,
  refreshWorld: (newScene?: string) => void,
) {
  const dialog = get<HTMLDialogElement>("new-scene-dialog");
  const form = get<HTMLFormElement>("new-scene-form");
  const name = get<HTMLInputElement>("scene-name");
  const width = get<HTMLInputElement>("scene-width");
  const height = get<HTMLInputElement>("scene-height");
  const submit = get<HTMLButtonElement>("create-scene");
  const cancel = get<HTMLButtonElement>("cancel-new-scene");
  const refresh = get<HTMLButtonElement>("refresh-scene-list");
  for (const [input, defaultTiles] of [
    [width, gbcViewportTiles.width],
    [height, gbcViewportTiles.height],
  ] as const) {
    input.min = String(minSceneTilesPerAxis);
    input.max = String(maxSceneTilesPerAxis);
    input.defaultValue = String(defaultTiles);
  }
  const message = get("new-scene-status");
  function busy(value: boolean) {
    name.disabled =
      width.disabled =
      height.disabled =
      submit.disabled =
      cancel.disabled =
      refresh.disabled =
        value;
  }
  cancel.onclick = () => dialog.close();
  dialog.oncancel = (event) => {
    if (cancel.disabled) event.preventDefault();
  };
  refresh.onclick = async () => {
    busy(true);
    try {
      await queueWrite(async () => {
        const response = await fetch("./api/project");
        if (!response.ok) throw Error("Could not read the saved scene list.");
        w.acceptSceneAdditions(decode(await response.json()));
        refreshWorld();
        refresh.hidden = true;
        message.textContent = "Scene list refreshed.";
      });
    } catch (error) {
      message.textContent = (error as Error).message;
    } finally {
      busy(false);
      (refresh.hidden ? submit : refresh).focus();
    }
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    busy(true);
    message.textContent = "Creating scene…";
    try {
      await queueWrite(async () => {
        const response = await fetch("./api/project/scenes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            baseRevision: w.snapshot.revision,
            name: name.value,
            width: width.valueAsNumber,
            height: height.valueAsNumber,
          }),
        });
        if (!response.ok) {
          refresh.hidden = response.headers.get("Cartquilt-Conflict") !== "stale-revision";
          throw Error((await response.text()).trim());
        }
        const added = await response.json();
        const next = decode(added);
        if (
          !next.project.scenes
            .slice(w.snapshot.project.scenes.length)
            .some((scene) => scene.id === added.sceneId)
        )
          throw Error(
            "The service did not return the new scene. Reopen the project to check what was saved.",
          );
        w.acceptSceneAdditions(next);
        dialog.close();
        refreshWorld(added.sceneId);
      });
    } catch (error) {
      message.textContent = (error as Error).message;
    } finally {
      busy(false);
      if (dialog.open && !refresh.hidden) refresh.focus();
    }
  };
  return () => {
    form.reset();
    message.textContent = "";
    refresh.hidden = true;
    dialog.showModal();
    name.focus();
  };
}

async function start() {
  if (window.location.pathname === "/" && sessionStorage.getItem(launcherPreference) === "true") {
    showLauncher();
    return;
  }
  const response = await fetch("./api/project");
  if (response.status === httpStatus.noContent) {
    showLauncher();
    return;
  }
  if (response.status === httpStatus.notFound) {
    showLauncher("Choose Open project to reopen the saved folder.");
    return;
  }
  if (!response.ok) throw Error("The project service could not load this project.");
  const w = new Workspace(decode(await response.json()));
  const project = w.snapshot.project;
  const canvas = get("canvas"),
    plane = get("plane"),
    details = get("details"),
    actions = get("actions");
  const zoomOut = get<HTMLButtonElement>("zoom-out");
  const zoomIn = get<HTMLButtonElement>("zoom-in");
  const percentage = get("percentage");
  zoomOut.onclick = () => zoom(1 / viewport.zoomStep);
  zoomIn.onclick = () => zoom(viewport.zoomStep);
  get("fit-view").onclick = fit;
  const filter = get<HTMLInputElement>("filter");
  const search = get<HTMLButtonElement>("search-scenes");
  const sceneGroup = get("scene-list-group");
  const sceneToggle = get<HTMLButtonElement>("toggle-scenes");
  get("project").textContent = project.name;
  document.title = `${project.name} · Cartquilt`;
  let panelButton: HTMLButtonElement | null = null;
  function closePanel(restore = true) {
    document.querySelector("aside.open")?.classList.remove("open");
    panelButton?.setAttribute("aria-expanded", "false");
    if (restore) panelButton?.focus();
    panelButton = null;
  }
  document.querySelectorAll<HTMLButtonElement>("[data-panel]").forEach((b) => {
    const panel = get(b.dataset.panel);
    b.setAttribute("aria-controls", panel.id);
    b.setAttribute("aria-expanded", "false");
    const close = button("Close", () => closePanel(), "dismiss");
    panel.prepend(close);
    b.onclick = () => {
      if (panelButton === b) {
        closePanel();
        return;
      }
      closePanel(false);
      panelButton = b;
      panel.classList.add("open");
      b.setAttribute("aria-expanded", "true");
      close.focus();
    };
  });
  const queueWrite = createSceneWriteQueue();
  let replayingHistory = false;
  const projectMenu = get<HTMLDetailsElement>("project-menu");
  function dismissProjectMenu() {
    projectMenu.open = false;
    projectMenu.querySelector("summary")?.focus();
  }
  get("open-project-assets").onclick = () => {
    dismissProjectMenu();
    artworkTools.openLibrary();
  };
  const exportTiled = get<HTMLButtonElement>("export-scene-tiled");
  exportTiled.onclick = async () => {
    if (!sceneMode()) return;
    const id = w.active.scene.id;
    const exportError = get("tiled-export-error");
    dismissProjectMenu();
    exportTiled.disabled = true;
    exportError.textContent = "";
    try {
      const response = await fetch(`./api/project/scenes/${id}/tiled`);
      if (!response.ok) throw Error((await response.text()).trim());
      const url = URL.createObjectURL(await response.blob());
      const download = el("a");
      download.href = url;
      download.download = `${id}-tiled.zip`;
      download.click();
      // Leave the URL available until the browser starts consuming the download.
      setTimeout(() => URL.revokeObjectURL(url), downloadURLLifetimeMs);
    } catch (error) {
      exportError.textContent = `Could not export to Tiled. ${(error as Error).message}`;
    } finally {
      exportTiled.disabled = false;
    }
  };
  const layers = setupSceneLayers(() => {
    if (connections.placement && !layers.editing("connections")) connections.resetPlacement();
    render();
  });
  const connections = setupConnections(w, queueWrite, canvas, render, {
    selectConnections: () => layers.select("connections"),
    tileSampler: (point) => artworkTools.tileSampler(point),
    hoverArtwork: (art, point) => artworkTools.hover(art, point),
    applyBrush: (scene, area) =>
      artworkTools.applyBrush(scene, area) || blockout.applyBrush(scene, area),
    artworkOwnsClick: () => artworkMove.ownsClick,
    movingArtwork: () => layers.editing("artwork") && !artworkTools.brushArmed,
    selectionChanged: () => {
      if (sceneMode() && layers.editing("artwork") && connections.selectionFor(w.active.scene))
        updateActorSelection();
      blockout.syncSelection();
      artworkTools.syncSelection();
    },
  });
  const blockout = setupBlockout(
    w,
    queueWrite,
    canvas,
    redrawBlockout,
    connections.selectionFor,
    connections.clearSelectionAfterErase,
    () => layers.editing("blockout"),
    () => {
      updateSceneTools();
      status();
    },
    (active) => {
      if (!sceneMode() || connections.placement) return;
      const hints = get("hints");
      if (hints.textContent === sceneCanvasHint || hints.textContent === brushCanvasHint) {
        hints.textContent = active ? brushCanvasHint : sceneCanvasHint;
      }
      artworkMove.refresh();
    },
    () => !replayingHistory,
  );
  const artworkTools = setupArtwork(
    w,
    queueWrite,
    canvas,
    connections.selectionFor,
    connections.clearSelectionAfterErase,
    () => layers.editing("artwork"),
    () => layers.select("artwork"),
    (id, edit) => {
      if (sceneMode() && w.selected !== id) return;
      if (edit.op === "move-tiles") artworkMove.followTileMove(id, edit);
      if (
        edit.op === "place-sprite" ||
        edit.op === "move-actor" ||
        edit.op === "remove-actor" ||
        edit.op === "restore-actor"
      ) {
        draw();
        navigator();
        inspector();
      } else {
        const scene = w.documentFor(id).scene;
        const art = plane.querySelector<HTMLElement>(`[data-grid-scene="${CSS.escape(id)}"]`);
        if (art) drawTileLayers(art, scene, !sceneMode() || layers.visible("artwork"));
        if (w.selected === id) {
          const preview = details.querySelector<HTMLElement>(".preview .art");
          if (preview) drawTileLayers(preview, scene, !sceneMode() || layers.visible("artwork"));
        }
      }
    },
    () => {
      updateSceneTools();
      status();
    },
    () => {
      artworkMove.refresh();
      if (sceneMode() && !connections.placement) {
        const hints = get("hints");
        if (layers.editing("artwork"))
          hints.textContent = artworkTools.brushArmed ? brushCanvasHint : moveCanvasHint;
      }
    },
    (scene, point) => artworkMove.selectTileAt(scene, point),
    () => !replayingHistory,
  );
  const artworkMove = setupArtworkMove(canvas, w, {
    enabled: () => layers.editing("artwork") && !artworkTools.brushArmed,
    layer: artworkTools.moveLayer,
    selectArea: connections.selectArea,
    selectionFor: connections.selectionFor,
    selectActor: (id) => {
      if (id) artworkMove.clearSelection();
      updateActorSelection(id);
    },
    save: async (id, edit) => {
      if (artworkTools.busy || blockout.busy) return false;
      return artworkTools.save(id, edit);
    },
    notice: (text) => {
      get("artwork-feedback").textContent = text;
    },
  });
  const sceneToolbar = get("scene-toolbar");
  const entranceTool = get<HTMLButtonElement>("place-entrance");
  const exitTool = get<HTMLButtonElement>("place-exit");
  const undoTool = get<HTMLButtonElement>("undo-scene");
  const redoTool = get<HTMLButtonElement>("redo-scene");
  for (const [kind, tool] of [
    ["entrance", entranceTool],
    ["exit", exitTool],
  ] as const) {
    tool.onclick = () => {
      if (connections.placement === kind) {
        connections.resetPlacement();
        render();
      } else {
        connections.start(kind);
        updateSceneTools();
      }
    };
  }
  for (const [op, tool, alternate] of [
    ["undo", undoTool, redoTool],
    ["redo", redoTool, undoTool],
  ] as const) {
    tool.onclick = async () => {
      const scene = w.selected;
      await history(op);
      if (!sceneMode() || w.selected !== scene) return;
      if (document.activeElement !== tool && document.activeElement !== document.body) return;
      (tool.disabled ? (alternate.disabled ? canvas : alternate) : tool).focus({
        preventScroll: true,
      });
    };
  }
  const newScene = setupSceneCreation(w, queueWrite, (id) => {
    if (id) {
      w.selected = id;
      w.desk = "world";
      showSceneGroup(true);
      showSceneSearch(false);
      closePanel(false);
    }
    render();
    if (id) {
      fit();
      plane.querySelector<HTMLButtonElement>("[aria-pressed=true]")?.focus({ preventScroll: true });
    }
  });
  get("add-scene").onclick = newScene;
  const sceneActions = setupSceneActions(
    w,
    queueWrite,
    (action, id, surface) => {
      if (action === "duplicate") {
        w.selected = id;
        w.desk = "world";
        showSceneGroup(true);
        showSceneSearch(false);
        closePanel(false);
      }
      render();
      if (action === "duplicate") fit();
      const root = surface === "world" || action === "duplicate" ? plane : get("scenes");
      const focusId = action === "delete" ? w.selected : id;
      const scene = Array.from(root.querySelectorAll<HTMLButtonElement>("button[data-id]")).find(
        (entry) => entry.dataset.id === focusId,
      );
      const fallback = surface === "navigator" ? get("add-scene") : canvas;
      (scene ?? fallback).focus({ preventScroll: true });
    },
    connections.openPreviewMenu,
  );
  function sceneMode() {
    return w.desk === "scene";
  }
  function open(id: string) {
    connections.resetPlacement();
    w.openScene(id);
    closePanel(false);
    render();
    get("crumb").querySelector("button")?.focus();
  }
  function back() {
    connections.resetPlacement();
    w.desk = "world";
    closePanel(false);
    render();
    plane.querySelector<HTMLButtonElement>("[aria-pressed=true]")?.focus({ preventScroll: true });
  }
  function selectScene(id: string) {
    if (sceneMode()) {
      open(id);
      return;
    }
    w.selected = id;
    for (const card of plane.querySelectorAll<HTMLElement>(".card"))
      pressed(card, card.dataset.id === id);
    navigator();
    inspector();
    status();
  }
  function selectActor(id: string, source: "navigator" | "canvas") {
    artworkMove.clearSelection();
    updateActorSelection(id);
    const root = source === "navigator" ? get("objects") : plane;
    root.querySelector<HTMLButtonElement>("[aria-pressed=true]")?.focus({ preventScroll: true });
  }
  function updateActorSelection(id?: string) {
    const sceneId = w.active.scene.id;
    if (id === w.objects.get(sceneId)) return;
    if (id) w.objects.set(sceneId, id);
    else w.objects.delete(sceneId);
    for (const sprite of plane.querySelectorAll<HTMLButtonElement>("button[data-actor-id]"))
      pressed(sprite, sprite.dataset.actorId === id);
    navigator();
    inspector();
  }
  function artwork(s: Scene, interactive = false) {
    const art = el("span", "art");
    art.classList.toggle("blockout-reference", layers.editing("blockout"));
    art.style.aspectRatio = `${s.width}/${s.height}`;
    art.style.setProperty("--scene-columns", String(s.width));
    art.style.setProperty("--scene-rows", String(s.height));
    const showArt = !sceneMode() || layers.visible("artwork");
    if (s.art && showArt) {
      art.append(img(s.art, "background"));
    } else {
      art.classList.add("blank-art");
    }
    drawBlockout(art, s, !sceneMode() || layers.visible("blockout"));
    drawTileLayers(art, s, showArt);
    for (const a of showArt ? s.actors : []) {
      const editActor = interactive && layers.editing("artwork");
      const sprite = editActor
        ? button("", () => selectActor(a.id, "canvas"), "sprite")
        : el("span", "sprite");
      if (editActor) {
        sprite.dataset.actorId = a.id;
        sprite.setAttribute("aria-label", a.name);
        pressed(sprite, w.objects.get(s.id) === a.id);
      }
      sprite.style.left = `${(a.x / (s.width * pixelsPerTile)) * 100}%`;
      sprite.style.top = `${(a.y / (s.height * pixelsPerTile)) * 100}%`;
      sprite.style.width = `${(a.width / (s.width * pixelsPerTile)) * 100}%`;
      sprite.style.height = `${(a.height / (s.height * pixelsPerTile)) * 100}%`;
      sprite.append(img(a.sprite));
      art.append(sprite);
    }
    if (!sceneMode() || layers.visible("connections"))
      drawConnectionMarkers(
        art,
        s,
        interactive && layers.editing("connections")
          ? (kind, point) => connections.editPoint(s, kind, point)
          : undefined,
      );
    if (interactive) connections.attachGrid(art, s);
    return art;
  }
  function redrawBlockout(id: string) {
    const scene = w.documents.get(id)?.scene;
    if (!scene) return;
    const visible = !sceneMode() || layers.visible("blockout");
    const art = plane.querySelector<HTMLElement>(`[data-grid-scene="${CSS.escape(id)}"]`);
    if (art) drawBlockout(art, scene, visible);
    if (w.selected === id) {
      const preview = details.querySelector<HTMLElement>(".preview .art");
      if (preview) drawBlockout(preview, scene, visible);
    }
  }
  function navigator() {
    const scenes = get("scenes"),
      objects = get("objects");
    scenes.replaceChildren();
    objects.replaceChildren();
    const scenesInProject = w.snapshot.project.scenes;
    const matches = scenesInProject.filter((s) =>
      s.name.toLowerCase().includes(filter.value.trim().toLowerCase()),
    );
    get("count").textContent = String(matches.length);
    for (const s of matches) {
      const row = button(
        "",
        () => {
          selectScene(s.id);
          scenes.querySelector<HTMLButtonElement>("[aria-pressed=true]")?.focus();
        },
        "row",
      );
      row.append(s.art ? img(s.art) : el("span", "blank-scene-thumbnail"), s.name);
      if (w.documentFor(s.id).dirty) row.append(el("span", "badge", "Draft"));
      pressed(row, w.selected === s.id);
      row.dataset.id = s.id;
      sceneActions.attach(row, s.id, "navigator");
      const options = button(
        "⋯",
        () => sceneActions.show(s.id, "navigator", options),
        "scene-options",
      );
      options.setAttribute("aria-label", `Actions for ${s.name}`);
      options.setAttribute("aria-haspopup", "menu");
      const item = el("div", "scene-list-item");
      item.append(row, options);
      scenes.append(item);
    }
    if (!matches.length)
      scenes.append(
        el("p", "empty", scenesInProject.length ? "No matching scenes" : "No scenes yet"),
      );
    if (!sceneMode()) return;
    if (layers.editing("artwork") && w.active.scene.actors.length) {
      objects.append(el("div", "section", "Scene objects"));
      for (const a of w.active.scene.actors) {
        const row = button("", () => selectActor(a.id, "navigator"), "row");
        row.append(img(a.sprite), a.name);
        pressed(row, w.objects.get(w.active.scene.id) === a.id);
        objects.append(row);
      }
    }
    const scene = w.active.scene;
    if (layers.editing("connections") && (scene.entrances.length || scene.exits.length)) {
      objects.append(el("div", "section", "Connections"));
      for (const entrance of scene.entrances)
        objects.append(
          button(
            `Entrance · ${entrance.name}`,
            () => connections.editPoint(scene, "entrance", entrance),
            "row",
          ),
        );
      for (const exit of scene.exits)
        objects.append(
          button(`Exit · ${exit.name}`, () => connections.editPoint(scene, "exit", exit), "row"),
        );
    }
  }
  function showSceneGroup(show: boolean) {
    sceneGroup.hidden = !show;
    sceneToggle.setAttribute("aria-expanded", String(show));
    if (!show && !filter.hidden) {
      showSceneSearch(false);
      navigator();
    }
  }
  sceneToggle.onclick = () => showSceneGroup(sceneGroup.hidden);
  function showSceneSearch(show: boolean) {
    if (show) showSceneGroup(true);
    filter.hidden = !show;
    search.setAttribute("aria-expanded", String(show));
    if (show) filter.focus();
    else filter.value = "";
  }
  function toggleSceneSearch() {
    showSceneSearch(filter.hidden);
    if (filter.hidden) {
      navigator();
      search.focus();
    }
  }
  search.onclick = toggleSceneSearch;
  filter.oninput = navigator;
  filter.onkeydown = (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    toggleSceneSearch();
  };
  function updateSceneTools() {
    if (!sceneMode()) return;
    pressed(entranceTool, connections.placement === "entrance");
    pressed(exitTool, connections.placement === "exit");
    const saving = blockout.busy || artworkTools.busy;
    undoTool.disabled = saving || !w.active.canUndo;
    redoTool.disabled = saving || !w.active.canRedo;
  }
  function toolbar() {
    const crumb = get("crumb");
    crumb.replaceChildren();
    sceneToolbar.hidden = !sceneMode();
    exportTiled.hidden = !sceneMode();
    const zoomHost = get(sceneMode() ? "workspace-feedback" : "toolbar");
    if (actions.parentElement !== zoomHost) zoomHost.append(actions);
    percentage.title = sceneMode() ? "Zoom relative to Fit" : "World map zoom";
    get("inspector-launcher").textContent = sceneMode() ? "Layers & inspector" : "Inspector";
    get("desk-title").textContent = sceneMode() ? w.active.scene.name : "World map";
    if (sceneMode()) {
      crumb.append(button("← World map", back));
      updateSceneTools();
    } else {
      crumb.textContent = "World desk";
    }
  }
  async function history(op: "undo" | "redo") {
    if (replayingHistory || blockout.busy || artworkTools.busy || !sceneMode()) return;
    const blockoutStep = w.active.hasBlockoutHistory(op);
    const artworkStep = w.active.artworkHistory(op);
    if (blockoutStep || artworkStep) {
      replayingHistory = true;
      try {
        if (artworkStep) await artworkTools.save(w.active.scene.id, artworkStep, op);
        else await blockout.history(op);
      } finally {
        replayingHistory = false;
      }
      return;
    }
    w.active[op]();
    toolbar();
    draw();
    navigator();
    inspector();
    status();
  }
  function inspector() {
    details.replaceChildren();
    const sceneInfo = get<HTMLDetailsElement>("scene-info");
    sceneInfo.hidden = true;
    if (!w.selected) {
      details.append(el("p", "empty", "Select a scene to inspect it."));
      return;
    }
    const s = w.active.scene;
    const a =
      layers.editing("artwork") && s.actors.find((actor) => actor.id === w.objects.get(s.id));
    if (a) {
      details.append(
        el("div", "kicker", "Actor"),
        el("h3", "", a.name),
        el("div", "section", "Position in pixels"),
      );
      const fields = el("div", "fields");
      const actorId = a.id;
      const actorPosition = () =>
        w.documents.get(s.id)?.scene.actors.find((actor) => actor.id === actorId);
      const savePosition = button("Save position", () => {
        const actor = actorPosition();
        if (!actor) return;
        savePosition.disabled = removeActor.disabled = true;
        void artworkTools
          .save(
            s.id,
            { op: "move-actor", actorId: a.id, position: { x: actor.x, y: actor.y } },
            "draft",
          )
          .finally(updateActorActions);
      });
      const removeActor = button("Remove actor", () => {
        if (!window.confirm(`Remove “${a.name}” from this scene?`)) return;
        savePosition.disabled = removeActor.disabled = true;
        void artworkTools.save(s.id, { op: "remove-actor", actorId: a.id }).finally(() => {
          if (sceneMode() && w.selected === s.id && !actorPosition())
            canvas.focus({ preventScroll: true });
          updateActorActions();
        });
      });
      function updateActorActions() {
        const actor = actorPosition();
        const saved = w.documents.get(s.id)?.baseline.actors.find((entry) => entry.id === actorId);
        savePosition.disabled = !actor || !saved || (actor.x === saved.x && actor.y === saved.y);
        removeActor.disabled = !actor;
      }
      for (const axis of ["x", "y"] as const) {
        const label = el("label", "", axis.toUpperCase()),
          input = el("input"),
          error = el("small", "error");
        error.id = `error-${axis}`;
        input.setAttribute("aria-describedby", error.id);
        input.setAttribute("aria-label", axis.toUpperCase());
        input.type = "number";
        input.min = "0";
        input.step = "1";
        const extent = axis === "x" ? "width" : "height";
        input.max = String(s[extent] * pixelsPerTile - a[extent]);
        input.value = String(a[axis]);
        let group = Symbol();
        input.onfocus = () => {
          group = Symbol();
        };
        input.oninput = () => {
          if (artworkTools.busy || replayingHistory) {
            input.value = String(actorPosition()?.[axis] ?? a[axis]);
            return;
          }
          try {
            w.active.apply(
              { type: "moveActor", actor: a.id, axis, value: input.valueAsNumber },
              group,
            );
            input.removeAttribute("aria-invalid");
            error.textContent = "";
            draw();
            toolbar();
            navigator();
            status();
            updateActorActions();
          } catch (e) {
            error.textContent = (e as Error).message;
            input.setAttribute("aria-invalid", "true");
          }
        };
        label.append(input, error);
        fields.append(label);
      }
      const actorActions = el("div", "actor-actions");
      actorActions.append(savePosition, removeActor);
      updateActorActions();
      details.append(fields, actorActions);
    } else {
      const editing = sceneMode();
      const metricsPanel = editing ? get("scene-metrics") : details;
      if (editing) {
        sceneInfo.hidden = false;
        metricsPanel.replaceChildren();
      } else {
        details.append(el("div", "kicker", "Scene"), el("h3", "", s.name));
        const preview = el("div", "preview");
        preview.append(artwork(s));
        details.append(preview);
      }
      const stats = el("dl");
      const metrics = sceneMetrics(s);
      stats.append(
        el("dt", "", "Dimensions"),
        el("dd", "", `${s.width} × ${s.height} tiles`),
        el("dt", "", "Actors"),
        el("dd", "", String(metrics.actors)),
        el("dt", "", "Sprite tiles"),
        el("dd", "", metrics.spriteTiles ? `~${metrics.spriteTiles}` : "0"),
        el("dt", "", "Triggers"),
        el("dd", "", String(metrics.triggers)),
      );
      metricsPanel.append(stats);
      const gbc = metrics.gbc;
      if (gbc && metrics.actors) {
        const budgetPanel = gbc.overBudget ? details : metricsPanel;
        budgetPanel.append(
          el(
            "p",
            gbc.overBudget ? "error" : "empty",
            `GBC estimate · ${gbc.hardwareSprites}/${gbcSpriteLimits.onscreen} hardware sprites · ${gbc.peakScanline}/${gbcSpriteLimits.perScanline} on the busiest scanline`,
          ),
        );
      }
      if (!sceneMode()) {
        details.append(button("Open scene", () => open(s.id), "primary"));
        const links = sceneConnections(w.snapshot.project).filter(
          (link) => link.source.id === s.id || link.target.id === s.id,
        );
        if (links.length) details.append(el("div", "section", "Connections"));
        for (const link of links)
          details.append(
            button(
              connectionLabel(link),
              () => {
                open(link.source.id);
                connections.editPoint(w.active.scene, "exit", link.exit);
              },
              "row connection-summary",
            ),
          );
      }
    }
  }
  // Capture completed moves. An in-flight save never replaces a newer position in the tab.
  const pendingPositions = new Map<string, Point>();
  const retryLayout = get<HTMLButtonElement>("retry-layout-save");
  let savingLayout = false;
  let layoutError = "";
  let layoutConflict = false;

  function savePosition(id: string) {
    const current = w.positionFor(id);
    const rounded = { x: Math.round(current.x), y: Math.round(current.y) };
    w.positions.set(id, rounded);
    pendingPositions.set(id, rounded);
    positionCards();
    status();
    if (!layoutError) void flushPositions();
  }

  async function flushPositions() {
    if (savingLayout || layoutConflict || !pendingPositions.size) return;
    savingLayout = true;
    layoutError = "";
    status();
    try {
      for (const [id, world] of pendingPositions) {
        await queueWrite(async () => {
          const scene = w.snapshot.project.scenes.find((candidate) => candidate.id === id);
          if (scene && (scene.world.x !== world.x || scene.world.y !== world.y)) {
            const response = await fetch(`./api/project/scenes/${id}/actions`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                baseRevision: w.snapshot.revision,
                action: "position",
                world,
              }),
            });
            if (response.headers.get("Cartquilt-Conflict") === "stale-revision") {
              layoutConflict = true;
              throw Error("Layout is unsaved. Reopen the project to load the changes on disk.");
            }
            if (!response.ok) throw Error("Layout is unsaved.");
            w.acceptSceneAction(decode(await response.json()), id, "position");
          }
        });
        // A second drop may have updated this entry while the request was in flight.
        if (pendingPositions.get(id) === world) pendingPositions.delete(id);
        else {
          const newer = pendingPositions.get(id);
          pendingPositions.delete(id);
          if (newer) pendingPositions.set(id, newer);
        }
      }
    } catch {
      layoutError = layoutConflict
        ? "Layout is unsaved. Reopen the project to load the changes on disk."
        : "Could not save layout.";
    } finally {
      savingLayout = false;
      status();
    }
  }

  retryLayout.onclick = () => void flushPositions();

  function status() {
    const drafts = [...w.documents.values()].filter((d) => d.dirty).map((d) => d.scene.name);
    const hasUnsavedEdits = !!drafts.length || w.layoutDirty || blockout.busy || artworkTools.busy;
    let message = drafts.length
      ? `Unsaved in this tab · ${drafts.join(", ")}`
      : blockout.busy
        ? "Saving blockout…"
        : blockout.saveFailed
          ? "Blockout save failed"
          : "No unsaved scene edits";
    if (sceneMode() && drafts.length && !w.active.dirty)
      message = `${w.active.scene.name} is clean · ${message}`;
    if (artworkTools.saveFailed) message += " · Artwork save failed";
    if (layoutError && w.layoutDirty) message += ` · ${layoutError}`;
    else if (savingLayout) message += " · Saving layout…";
    else if (w.layoutDirty) message += " · Unsaved layout";
    retryLayout.hidden = !layoutError || layoutConflict || !w.layoutDirty;
    get("location").textContent =
      `${project.name} / ${sceneMode() ? w.active.scene.name : "World map"}`;
    if (get("status").textContent !== message) get("status").textContent = message;
    get("status").classList.toggle("dirty", hasUnsavedEdits);
    window.onbeforeunload = hasUnsavedEdits
      ? (e) => {
          e.preventDefault();
          e.returnValue = "";
        }
      : null;
  }
  function positionCamera() {
    const c = w.viewportCamera;
    plane.style.transform = `translate(${c.x}px,${c.y}px) scale(${c.zoom})`;
    percentage.textContent = `${Math.round(c.zoom * 100)}%`;
    zoomOut.disabled = c.zoom <= viewport.minZoom;
    zoomIn.disabled = c.zoom >= viewport.maxZoom;
  }
  function positionCards() {
    if (sceneMode()) return;
    positionCamera();
    for (const card of plane.querySelectorAll<HTMLElement>(".card")) {
      const p = w.positionFor(card.dataset.id);
      card.style.left = `${p.x}px`;
      card.style.top = `${p.y}px`;
    }
    positionWorldConnections(plane, w);
  }
  function zoom(factor: number, x = canvas.clientWidth / 2, y = canvas.clientHeight / 2) {
    const c = w.viewportCamera;
    const next = Math.min(viewport.maxZoom, Math.max(viewport.minZoom, c.zoom * factor));
    if (sceneMode()) {
      x -= canvas.clientWidth / 2;
      y -= canvas.clientHeight / 2;
    }
    c.x = x - ((x - c.x) * next) / c.zoom;
    c.y = y - ((y - c.y) * next) / c.zoom;
    c.zoom = next;
    positionCamera();
  }
  function fit() {
    if (sceneMode()) {
      w.resetSceneCamera();
      positionCamera();
      return;
    }
    const bounds = Array.from(plane.querySelectorAll<HTMLElement>(".card"), (card) => {
      const p = w.positionFor(card.dataset.id);
      return { ...p, right: p.x + card.offsetWidth, bottom: p.y + card.offsetHeight };
    });
    if (!bounds.length) return;
    const l = Math.min(...bounds.map((b) => b.x)),
      t = Math.min(...bounds.map((b) => b.y));
    const width = Math.max(...bounds.map((b) => b.right)) - l,
      height = Math.max(...bounds.map((b) => b.bottom)) - t;
    const z = Math.max(
      worldMap.minFitZoom,
      Math.min(
        worldMap.maxFitZoom,
        (canvas.clientWidth - 2 * worldMap.fitPaddingPx) / width,
        (canvas.clientHeight - 2 * worldMap.fitPaddingPx) / height,
      ),
    );
    w.camera = {
      x: (canvas.clientWidth - width * z) / 2 - l * z,
      y: (canvas.clientHeight - height * z) / 2 - t * z,
      zoom: z,
    };
    positionCamera();
  }
  function draw() {
    finishCanvasDrag(true);
    plane.replaceChildren();
    if (sceneMode()) {
      plane.style.setProperty("--ratio", String(w.active.scene.width / w.active.scene.height));
      plane.append(artwork(w.active.scene, true));
      positionCamera();
      artworkMove.refresh();
      return;
    }
    const groups = new Map<string, ReturnType<typeof sceneConnections>>();
    for (const link of sceneConnections(w.snapshot.project)) {
      const key = [link.source.id, link.target.id].sort().join("/");
      const group = groups.get(key) ?? [];
      group.push(link);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      for (const [index, link] of group.entries()) {
        const edge = button(
          "",
          () => {
            open(link.source.id);
            connections.editPoint(w.active.scene, "exit", link.exit);
          },
          "world-connection",
        );
        edge.title = connectionLabel(link);
        edge.setAttribute("aria-label", edge.title);
        edge.dataset.source = link.source.id;
        edge.dataset.target = link.target.id;
        const lane = (index - (group.length - 1) / 2) * (link.source.id < link.target.id ? 1 : -1);
        edge.dataset.lane = String(lane);
        plane.append(edge);
      }
    }
    for (const d of w.documents.values()) {
      const s = d.scene,
        card = el("button", "card");
      card.dataset.id = s.id;
      if (s.color) card.style.setProperty("--scene-border", s.color);
      sceneActions.attach(card, s.id, "world");
      pressed(card, s.id === w.selected);
      card.onclick = () => selectScene(s.id);
      card.ondblclick = (event) => {
        if (!event.shiftKey) open(s.id);
      };
      const header = el("span", "scene-card-header");
      const title = el("span", "scene-card-name", s.name);
      title.title = s.name;
      header.append(title);
      if (d.dirty) header.append(el("span", "badge", "Draft"));
      const metrics = sceneMetrics(s);
      const footer = el("span", "scene-card-footer");
      footer.append(el("span", "scene-card-metric", `${s.width}×${s.height}`));
      for (const [short, value] of [
        ["A", String(metrics.actors)],
        ["S", metrics.spriteTiles ? `~${metrics.spriteTiles}` : "0"],
        ["T", String(metrics.triggers)],
      ]) {
        const metric = el("span", "scene-card-metric");
        metric.append(el("span", "scene-metric-label", `${short}: `), value);
        if (short === "S" && metrics.gbc?.overBudget) metric.classList.add("scene-card-warning");
        footer.append(metric);
      }
      const tooltip = el("span", "scene-card-tooltip");
      tooltip.id = `scene-summary-${s.id}`;
      tooltip.setAttribute("role", "tooltip");
      const gbc = metrics.gbc;
      const rows = [
        `Size ${s.width}×${s.height} tiles (${s.width * pixelsPerTile}×${s.height * pixelsPerTile} pixels)`,
        `Actors ${metrics.actors} · Triggers ${metrics.triggers}`,
        `Entrances ${s.entrances.length}`,
        `Estimated sprite tiles ${metrics.spriteTiles}`,
      ];
      if (gbc) {
        rows.push(
          `GBC estimates in ${pixelsPerTile}×${pixelsPerTile} sprite mode`,
          `${gbc.hardwareSprites}/${gbcSpriteLimits.onscreen} hardware sprites · ${gbc.peakScanline}/${gbcSpriteLimits.perScanline} on the busiest scanline`,
        );
      }
      for (const row of rows) tooltip.append(el("span", "", row));
      if (gbc?.overBudget)
        tooltip.append(el("span", "scene-card-warning", "GBC sprite budget exceeded"));
      footer.append(tooltip);
      footer.onpointerenter = () => delete card.dataset.tooltipDismissed;
      card.onfocus = () => delete card.dataset.tooltipDismissed;
      card.setAttribute("aria-label", d.dirty ? `${s.name} · Draft` : s.name);
      card.setAttribute("aria-describedby", tooltip.id);
      const preview = artwork(s);
      connections.attachGrid(preview, s, card);
      card.append(header, preview, footer);
      plane.append(card);
    }
    positionCards();
  }
  function render() {
    connections.syncDesk();
    canvas.classList.toggle("scene", sceneMode());
    canvas.setAttribute(
      "aria-label",
      sceneMode() ? `${w.active.scene.name} scene canvas` : "World map canvas",
    );
    if (!connections.placement)
      get("hints").textContent = sceneMode()
        ? sceneCanvasHint
        : "Drag a scene header to move it · Double-click to open · Drag or Shift-click tiles to select";
    if (!w.snapshot.project.scenes.length)
      get("hints").textContent = "This world has no scenes yet";
    layers.sync(sceneMode() ? w.active.scene : undefined);
    blockout.sync();
    artworkTools.sync();
    toolbar();
    draw();
    navigator();
    inspector();
    status();
  }
  type Drag = {
    pointer: number;
    buttons: number;
    owner: HTMLElement;
    start: Point;
    origin: Point;
    card?: string;
    moved: boolean;
  };
  let drag: Drag | undefined;
  function finishCanvasDrag(cancel = false) {
    if (!drag) return;
    const { pointer, owner, card, origin, moved } = drag;
    drag = undefined;
    canvas.classList.remove("middle-panning");
    if (owner.hasPointerCapture(pointer)) owner.releasePointerCapture(pointer);
    if (!card || !moved || !w.positions.has(card)) return;
    if (cancel) {
      w.positions.set(card, origin);
      positionCards();
      status();
    } else {
      savePosition(card);
    }
  }
  canvas.onpointerdown = (e) => {
    const middlePan = e.pointerType === "mouse" && e.button === pointerButton.middle;
    if (drag || (!middlePan && (sceneMode() || e.button !== pointerButton.primary))) return;
    const target = e.target as Element;
    if (!middlePan && target.closest(".world-connection")) return;
    const card = middlePan ? null : target.closest<HTMLElement>(".card");
    if (card && !target.closest(".scene-card-header")) return;
    const id = card?.dataset.id;
    drag = {
      pointer: e.pointerId,
      buttons: middlePan ? pressedPointerButton.middle : pressedPointerButton.primary,
      owner: card ?? canvas,
      start: { x: e.clientX, y: e.clientY },
      origin: { ...(id ? w.positionFor(id) : w.viewportCamera) },
      card: id,
      moved: false,
    };
    if (middlePan) {
      e.preventDefault();
      canvas.classList.add("middle-panning");
    }
    drag.owner.setPointerCapture(e.pointerId);
  };
  canvas.onpointermove = (e) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    if ((e.buttons & drag.buttons) === 0) {
      finishCanvasDrag();
      return;
    }
    const dx = e.clientX - drag.start.x,
      dy = e.clientY - drag.start.y;
    if (!drag.moved && Math.hypot(dx, dy) < viewport.dragThresholdPx) return;
    if (!drag.moved && drag.card) selectScene(drag.card);
    drag.moved = true;
    if (drag.card) {
      w.positions.set(drag.card, {
        x: drag.origin.x + dx / w.camera.zoom,
        y: drag.origin.y + dy / w.camera.zoom,
      });
      positionCards();
      status();
    } else {
      const camera = w.viewportCamera;
      camera.x = drag.origin.x + dx;
      camera.y = drag.origin.y + dy;
      positionCamera();
    }
  };
  canvas.onpointerup = (event) => {
    if (drag?.pointer === event.pointerId) finishCanvasDrag();
  };
  for (const type of ["pointercancel", "lostpointercapture"] as const) {
    canvas.addEventListener(type, (event) => {
      if (drag?.pointer === event.pointerId && drag.owner === event.target) finishCanvasDrag(true);
    });
  }
  canvas.addEventListener("auxclick", (event) => {
    if (event.button === pointerButton.middle) event.preventDefault();
  });
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      if (drag) return;
      const r = canvas.getBoundingClientRect();
      zoom(
        Math.exp(
          -Math.max(-viewport.maxWheelDelta, Math.min(viewport.maxWheelDelta, e.deltaY)) *
            viewport.wheelZoomRate,
        ),
        e.clientX - r.left,
        e.clientY - r.top,
      );
    },
    { passive: false },
  );
  canvas.onkeydown = (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const card = (e.target as Element).closest<HTMLElement>(".card")?.dataset.id;
    if (e.key === "Enter" && card) {
      e.preventDefault();
      open(card);
      return;
    }
    const step: Record<string, Point> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    };
    if (Object.hasOwn(step, e.key)) {
      e.preventDefault();
      const d = step[e.key];
      if (card && e.shiftKey) {
        const p = w.positionFor(card);
        p.x += worldMap.keyboardSceneMovePx * d.x;
        p.y += worldMap.keyboardSceneMovePx * d.y;
        selectScene(card);
        savePosition(card);
      } else {
        const camera = w.viewportCamera;
        camera.x += viewport.keyboardPanPx * d.x;
        camera.y += viewport.keyboardPanPx * d.y;
        positionCamera();
      }
    } else if (["+", "=", "-"].includes(e.key)) {
      e.preventDefault();
      zoom(e.key === "-" ? 1 / viewport.zoomStep : viewport.zoomStep);
    } else if (e.key.toLowerCase() === "f") fit();
  };
  document.addEventListener("keydown", (e) => {
    if (document.querySelector("dialog[open]")) return;
    if (e.key === "Escape") {
      if (artworkTools.dismissTooltip()) return;
      const card = plane.querySelector<HTMLElement>(
        ".card:not([data-tooltip-dismissed]):is(:focus-visible, :has(.scene-card-footer:hover))",
      );
      if (card) {
        card.dataset.tooltipDismissed = "";
        return;
      }
    }
    if (e.key === "Escape" && panelButton) {
      closePanel();
      return;
    }
    const key = e.key.toLowerCase();
    const typingToolInput =
      e.target instanceof HTMLInputElement && e.target.closest("#blockout-tools, #artwork-tools");
    const historyShortcut =
      (key === "z" && (e.ctrlKey || e.metaKey)) || (key === "y" && e.ctrlKey && !e.metaKey);
    if (sceneMode() && !typingToolInput && historyShortcut) {
      e.preventDefault();
      void history(key === "y" || e.shiftKey ? "redo" : "undo");
    }
  });
  for (const id of ["project-divider", "project", "project-menu", "editor-desk", "editor-footer"])
    get(id).hidden = false;
  render();
  fit();
}
setupProjectDialog();
monitorService();
window.addEventListener("pageshow", (event) => {
  if (event.persisted && !get("project-launcher").hidden) renderRecentProjects();
});
start().catch((e) => {
  showLauncher(e.message);
});
