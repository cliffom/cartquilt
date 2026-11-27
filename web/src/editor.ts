import { decode, Workspace, type Scene, type Point } from "./model.js";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") {
  const node = document.createElement(tag);
  node.className = cls;
  node.textContent = text;
  return node;
}
function get<T extends HTMLElement = HTMLElement>(id: string) {
  return document.getElementById(id) as T;
}
function button(label: string, act: () => void, cls = "") {
  const node = el("button", cls, label);
  node.onclick = act;
  return node;
}
function img(file: string, cls = "") {
  const node = el("img", cls);
  node.src = "/assets/" + file;
  node.alt = "";
  node.draggable = false;
  return node;
}
function pressed(node: HTMLElement, selected: boolean) {
  node.setAttribute("aria-pressed", String(selected));
}

async function start() {
  const response = await fetch("/api/project");
  if (!response.ok) throw Error("The project service could not load this project.");
  const w = new Workspace(decode(await response.json()));
  const project = w.snapshot.project;
  const canvas = get("canvas"),
    plane = get("plane"),
    details = get("details"),
    actions = get("actions");
  const filter = get<HTMLInputElement>("filter");
  get("project").textContent = project.name;
  document.title = project.name + " · Cartquilt";
  let panelButton: HTMLButtonElement | null = null;
  function closePanel(restore = true) {
    document.querySelector("aside.open")?.classList.remove("open");
    panelButton?.setAttribute("aria-expanded", "false");
    if (restore) panelButton?.focus();
    panelButton = null;
  }
  document.querySelectorAll<HTMLButtonElement>("[data-panel]").forEach((b) => {
    const panel = get(b.dataset.panel!);
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
    w.objects.set(w.selected, id);
    navigator();
    draw();
    inspector();
    const root = source === "navigator" ? get("objects") : plane;
    root.querySelector<HTMLButtonElement>("[aria-pressed=true]")?.focus({ preventScroll: true });
  }
  function artwork(s: Scene, interactive = false) {
    const art = el("div", "art");
    art.style.aspectRatio = s.width + "/" + s.height;
    art.append(img(s.art, "background"));
    for (const a of s.actors) {
      const sprite = interactive
        ? button("", () => selectActor(a.id, "canvas"), "sprite")
        : el("span", "sprite");
      if (interactive) {
        sprite.setAttribute("aria-label", a.name);
        pressed(sprite, w.objects.get(s.id) === a.id);
      }
      sprite.style.left = (a.x / (s.width * 8)) * 100 + "%";
      sprite.style.top = (a.y / (s.height * 8)) * 100 + "%";
      sprite.style.width = (a.width / (s.width * 8)) * 100 + "%";
      sprite.style.height = (a.height / (s.height * 8)) * 100 + "%";
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
      if (w.documents.get(s.id)!.dirty) row.append(el("span", "badge", "Draft"));
      pressed(row, w.selected === s.id);
      scenes.append(row);
    }
    if (!matches.length) scenes.append(el("p", "empty", "No matching scenes"));
    if (!sceneMode()) return;
    objects.append(el("div", "section", "Scene objects"));
    for (const a of w.active.scene.actors) {
      const row = button("", () => selectActor(a.id, "navigator"), "row");
      row.append(img(a.sprite), a.name);
      pressed(row, w.objects.get(w.selected) === a.id);
      objects.append(row);
    }
    if (!w.active.scene.actors.length) objects.append(el("p", "empty", "No objects in this scene"));
  }
  filter.oninput = navigator;
  function toolbar() {
    const crumb = get("crumb");
    crumb.replaceChildren();
    actions.replaceChildren();
    document.querySelector("h1")!.textContent = sceneMode() ? w.active.scene.name : "World map";
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
    const s = w.active.scene;
    details.replaceChildren();
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
        error.id = "error-" + axis;
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
      if (!sceneMode()) details.append(button("Open scene", () => open(w.selected), "primary"));
    }
  }
  function status() {
    const drafts = [...w.documents.values()].filter((d) => d.dirty).map((d) => d.scene.name);
    let message = drafts.length
      ? "Unsaved in this tab · " + drafts.join(", ")
      : "No unsaved scene edits";
    if (sceneMode() && drafts.length && !w.active.dirty)
      message = w.active.scene.name + " is clean · " + message;
    if (w.layoutDirty) message += " · Layout changed in this tab";
    get("location").textContent =
      project.name + " / " + (sceneMode() ? w.active.scene.name : "World map");
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
    get("percentage").textContent = Math.round(c.zoom * 100) + "%";
    for (const card of plane.querySelectorAll<HTMLElement>(".card")) {
      const p = w.positions.get(card.dataset.id!)!;
      card.style.left = p.x + "px";
      card.style.top = p.y + "px";
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
      const p = w.positions.get(card.dataset.id!)!;
      return { ...p, right: p.x + card.offsetWidth, bottom: p.y + card.offsetHeight };
    });
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
      sceneMode() ? w.active.scene.name + " scene canvas" : "World map canvas",
    );
    get("hints").textContent = sceneMode()
      ? "Select an actor to edit its position"
      : "Drag background to pan · Scroll to zoom · Double-click a scene to open";
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
      origin: { ...(id ? w.positions.get(id)! : w.camera) },
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
        const p = w.positions.get(card)!;
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
    if (e.key === "Escape" && panelButton) {
      closePanel();
      return;
    }
    if (sceneMode() && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      history(e.shiftKey ? "redo" : "undo");
    }
  });
  render();
  fit();
}
start().catch((e) => {
  get("status").textContent = "Could not open project · " + e.message;
});
