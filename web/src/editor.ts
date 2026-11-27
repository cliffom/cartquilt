import { decode, Workspace, type Scene, type Point } from "./model.js";

const launcherPreference = "cartquilt.showLauncher";
const recentProjectsKey = "cartquilt.recentProjects";
const recentProjectLimit = 8;

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

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") {
  const node = document.createElement(tag);
  node.className = cls;
  node.textContent = text;
  return node;
}
function get<T extends HTMLElement = HTMLElement>(id: string | undefined) {
  const node = id && document.getElementById(id);
  if (!node) throw Error(`Missing editor element: ${id}`);
  return node as T;
}
function button(label: string, act: () => void, cls = "") {
  const node = el("button", cls, label);
  node.onclick = act;
  return node;
}
function img(file: string, cls = "") {
  const node = el("img", cls);
  node.src = `./assets/${file}`;
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
        signal: AbortSignal.timeout(3000),
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
  window.setInterval(check, 15_000);
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
      if (response.status !== 204) {
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

async function start() {
  if (window.location.pathname === "/" && sessionStorage.getItem(launcherPreference) === "true") {
    showLauncher();
    return;
  }
  const response = await fetch("./api/project");
  if (response.status === 204) {
    showLauncher();
    return;
  }
  if (response.status === 404) {
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
  const filter = get<HTMLInputElement>("filter");
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
  function sceneMode() {
    return w.desk === "scene";
  }
  function open(id: string) {
    w.selected = id;
    w.desk = "scene";
    closePanel(false);
    render();
    get("crumb").querySelector("button")?.focus();
  }
  function back() {
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
    w.objects.set(w.active.scene.id, id);
    navigator();
    draw();
    inspector();
    const root = source === "navigator" ? get("objects") : plane;
    root.querySelector<HTMLButtonElement>("[aria-pressed=true]")?.focus({ preventScroll: true });
  }
  function artwork(s: Scene, interactive = false) {
    const art = el("div", "art");
    art.style.aspectRatio = `${s.width}/${s.height}`;
    art.append(img(s.art, "background"));
    for (const a of s.actors) {
      const sprite = interactive
        ? button("", () => selectActor(a.id, "canvas"), "sprite")
        : el("span", "sprite");
      if (interactive) {
        sprite.setAttribute("aria-label", a.name);
        pressed(sprite, w.objects.get(s.id) === a.id);
      }
      sprite.style.left = `${(a.x / (s.width * 8)) * 100}%`;
      sprite.style.top = `${(a.y / (s.height * 8)) * 100}%`;
      sprite.style.width = `${(a.width / (s.width * 8)) * 100}%`;
      sprite.style.height = `${(a.height / (s.height * 8)) * 100}%`;
      sprite.append(img(a.sprite));
      art.append(sprite);
    }
    return art;
  }
  function navigator() {
    const scenes = get("scenes"),
      objects = get("objects");
    scenes.replaceChildren();
    objects.replaceChildren();
    const matches = project.scenes.filter((s) =>
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
      row.append(img(s.art), s.name);
      if (w.documentFor(s.id).dirty) row.append(el("span", "badge", "Draft"));
      pressed(row, w.selected === s.id);
      scenes.append(row);
    }
    if (!matches.length)
      scenes.append(
        el("p", "empty", project.scenes.length ? "No matching scenes" : "No scenes yet"),
      );
    if (!sceneMode()) return;
    objects.append(el("div", "section", "Scene objects"));
    for (const a of w.active.scene.actors) {
      const row = button("", () => selectActor(a.id, "navigator"), "row");
      row.append(img(a.sprite), a.name);
      pressed(row, w.objects.get(w.active.scene.id) === a.id);
      objects.append(row);
    }
    if (!w.active.scene.actors.length) objects.append(el("p", "empty", "No objects in this scene"));
  }
  filter.oninput = navigator;
  function toolbar() {
    const crumb = get("crumb");
    crumb.replaceChildren();
    actions.replaceChildren();
    get("desk-title").textContent = sceneMode() ? w.active.scene.name : "World map";
    if (sceneMode()) {
      crumb.append(button("← World map", back));
      for (const op of ["undo", "redo"] as const) {
        const b = button(op === "undo" ? "Undo" : "Redo", () => {
          history(op);
          (actions.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? canvas).focus();
        });
        b.disabled = !(op === "undo" ? w.active.canUndo : w.active.canRedo);
        actions.append(b);
      }
    } else {
      crumb.textContent = "World desk";
      const out = button("−", () => zoom(1 / 1.2)),
        plus = button("+", () => zoom(1.2));
      out.setAttribute("aria-label", "Zoom out");
      plus.setAttribute("aria-label", "Zoom in");
      const percentage = el("span");
      percentage.id = "percentage";
      actions.append(out, percentage, plus, button("Fit", fit));
    }
  }
  function history(op: "undo" | "redo") {
    w.active[op]();
    toolbar();
    draw();
    navigator();
    inspector();
    status();
  }
  function inspector() {
    details.replaceChildren();
    if (!w.selected) {
      details.append(el("p", "empty", "Select a scene to inspect it."));
      return;
    }
    const s = w.active.scene;
    const a = sceneMode() && s.actors.find((actor) => actor.id === w.objects.get(s.id));
    if (a) {
      details.append(
        el("div", "kicker", "Actor"),
        el("h3", "", a.name),
        el("div", "section", "Position in pixels"),
      );
      const fields = el("div", "fields");
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
        input.max = String(s[extent] * 8 - a[extent]);
        input.value = String(a[axis]);
        let group = Symbol();
        input.onfocus = () => {
          group = Symbol();
        };
        input.oninput = () => {
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
          } catch (e) {
            error.textContent = (e as Error).message;
            input.setAttribute("aria-invalid", "true");
          }
        };
        label.append(input, error);
        fields.append(label);
      }
      details.append(fields);
    } else {
      details.append(el("div", "kicker", "Scene"), el("h3", "", s.name));
      const preview = el("div", "preview");
      preview.append(artwork(s));
      details.append(preview);
      const stats = el("dl");
      stats.append(
        el("dt", "", "Dimensions"),
        el("dd", "", `${s.width} × ${s.height} tiles`),
        el("dt", "", "Actors"),
        el("dd", "", String(s.actors.length)),
      );
      details.append(stats);
      if (!sceneMode()) details.append(button("Open scene", () => open(s.id), "primary"));
    }
  }
  function status() {
    const drafts = [...w.documents.values()].filter((d) => d.dirty).map((d) => d.scene.name);
    let message = drafts.length
      ? `Unsaved in this tab · ${drafts.join(", ")}`
      : "No unsaved scene edits";
    if (sceneMode() && drafts.length && !w.active.dirty)
      message = `${w.active.scene.name} is clean · ${message}`;
    if (w.layoutDirty) message += " · Layout changed in this tab";
    get("location").textContent =
      `${project.name} / ${sceneMode() ? w.active.scene.name : "World map"}`;
    if (get("status").textContent !== message) get("status").textContent = message;
    get("status").classList.toggle("dirty", !!drafts.length || w.layoutDirty);
    window.onbeforeunload =
      drafts.length || w.layoutDirty
        ? (e) => {
            e.preventDefault();
            e.returnValue = "";
          }
        : null;
  }
  function positionCards() {
    if (sceneMode()) return;
    const c = w.camera;
    plane.style.transform = `translate(${c.x}px,${c.y}px) scale(${c.zoom})`;
    get("percentage").textContent = `${Math.round(c.zoom * 100)}%`;
    for (const card of plane.querySelectorAll<HTMLElement>(".card")) {
      const p = w.positionFor(card.dataset.id);
      card.style.left = `${p.x}px`;
      card.style.top = `${p.y}px`;
    }
  }
  function zoom(factor: number, x = canvas.clientWidth / 2, y = canvas.clientHeight / 2) {
    const c = w.camera,
      next = Math.min(4, Math.max(0.1, c.zoom * factor));
    c.x = x - ((x - c.x) * next) / c.zoom;
    c.y = y - ((y - c.y) * next) / c.zoom;
    c.zoom = next;
    positionCards();
  }
  function fit() {
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
      0.01,
      Math.min(1.25, (canvas.clientWidth - 36) / width, (canvas.clientHeight - 36) / height),
    );
    w.camera = {
      x: (canvas.clientWidth - width * z) / 2 - l * z,
      y: (canvas.clientHeight - height * z) / 2 - t * z,
      zoom: z,
    };
    positionCards();
  }
  function draw() {
    plane.replaceChildren();
    if (sceneMode()) {
      plane.style.transform = "";
      plane.style.setProperty("--ratio", String(w.active.scene.width / w.active.scene.height));
      plane.append(artwork(w.active.scene, true));
      return;
    }
    for (const d of w.documents.values()) {
      const s = d.scene,
        card = el("button", "card");
      card.dataset.id = s.id;
      pressed(card, s.id === w.selected);
      card.onclick = () => selectScene(s.id);
      card.ondblclick = () => open(s.id);
      const caption = el("span", "caption", s.name);
      if (d.dirty) caption.append(el("span", "badge", "Draft"));
      card.append(artwork(s), caption);
      plane.append(card);
    }
    positionCards();
  }
  function render() {
    canvas.classList.toggle("scene", sceneMode());
    canvas.setAttribute(
      "aria-label",
      sceneMode() ? `${w.active.scene.name} scene canvas` : "World map canvas",
    );
    get("hints").textContent = sceneMode()
      ? "Select an actor to edit its position"
      : "Drag background to pan · Scroll to zoom · Double-click a scene to open";
    if (!project.scenes.length) get("hints").textContent = "This world has no scenes yet";
    if (sceneMode() && !w.active.scene.actors.length)
      get("hints").textContent = "No actors in this scene";
    toolbar();
    draw();
    navigator();
    inspector();
    status();
  }
  type Drag = { pointer: number; start: Point; origin: Point; card?: string; moved: boolean };
  let drag: Drag | undefined;
  canvas.onpointerdown = (e) => {
    if (sceneMode() || e.button !== 0 || drag) return;
    const card = (e.target as Element).closest<HTMLElement>(".card");
    const id = card?.dataset.id;
    drag = {
      pointer: e.pointerId,
      start: { x: e.clientX, y: e.clientY },
      origin: { ...(id ? w.positionFor(id) : w.camera) },
      card: id,
      moved: false,
    };
    (card ?? canvas).setPointerCapture(e.pointerId);
  };
  canvas.onpointermove = (e) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const dx = e.clientX - drag.start.x,
      dy = e.clientY - drag.start.y;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    if (!drag.moved && drag.card) selectScene(drag.card);
    drag.moved = true;
    if (drag.card)
      w.positions.set(drag.card, {
        x: drag.origin.x + dx / w.camera.zoom,
        y: drag.origin.y + dy / w.camera.zoom,
      });
    else {
      w.camera.x = drag.origin.x + dx;
      w.camera.y = drag.origin.y + dy;
    }
    positionCards();
    status();
  };
  canvas.onlostpointercapture = () => {
    drag = undefined;
  };
  canvas.addEventListener(
    "wheel",
    (e) => {
      if (sceneMode()) return;
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      zoom(
        Math.exp(-Math.max(-200, Math.min(200, e.deltaY)) * 0.003),
        e.clientX - r.left,
        e.clientY - r.top,
      );
    },
    { passive: false },
  );
  canvas.onkeydown = (e) => {
    if (sceneMode()) return;
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
    if (e.key in step) {
      e.preventDefault();
      const d = step[e.key];
      if (card && e.shiftKey) {
        const p = w.positionFor(card);
        p.x += 8 * d.x;
        p.y += 8 * d.y;
        selectScene(card);
      } else {
        w.camera.x += 24 * d.x;
        w.camera.y += 24 * d.y;
      }
      positionCards();
    } else if (["+", "=", "-"].includes(e.key)) {
      e.preventDefault();
      zoom(e.key === "-" ? 1 / 1.2 : 1.2);
    } else if (e.key.toLowerCase() === "f") fit();
  };
  document.addEventListener("keydown", (e) => {
    if (document.querySelector("dialog[open]")) return;
    if (e.key === "Escape" && panelButton) {
      closePanel();
      return;
    }
    if (sceneMode() && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      history(e.shiftKey ? "redo" : "undo");
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
