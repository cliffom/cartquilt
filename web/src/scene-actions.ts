import { get } from "./dom.js";
import { decode, type Workspace } from "./model.js";

type SceneAction = "rename" | "duplicate" | "color" | "delete";
export type SceneSurface = "navigator" | "world";

export type QueueSceneWrite = <T>(write: () => Promise<T>) => Promise<T>;

export function createSceneWriteQueue(): QueueSceneWrite {
  let tail = Promise.resolve();
  return (write) => {
    const next = tail.then(write);
    tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
}

export function setupSceneActions(
  workspace: Workspace,
  queueWrite: QueueSceneWrite,
  changed: (action: SceneAction, id: string, surface: SceneSurface) => void,
) {
  const menu = get("scene-context-menu");
  const buttons = Array.from(menu.querySelectorAll<HTMLButtonElement>("button"));
  const chips = buttons.filter((button) => button.dataset.sceneColor !== undefined);
  for (const chip of chips) chip.style.setProperty("--chip-color", chip.dataset.sceneColor ?? "");
  const firstAction = buttons[chips.length];
  const dialog = get<HTMLDialogElement>("scene-action-dialog");
  const form = get<HTMLFormElement>("scene-action-form");
  const title = get("scene-action-title");
  const description = get("scene-action-description");
  const name = get<HTMLInputElement>("scene-action-name");
  const message = get("scene-action-message");
  const apply = get<HTMLButtonElement>("apply-scene-action");
  const cancel = get<HTMLButtonElement>("cancel-scene-action");
  let target: { id: string; surface: SceneSurface; anchor: HTMLElement } | undefined;
  let action: SceneAction;
  let pending = false;

  function hideMenu(restore = false) {
    menu.hidden = true;
    if (restore) target?.anchor.focus({ preventScroll: true });
  }

  function show(id: string, surface: SceneSurface, anchor: HTMLElement, x?: number, y?: number) {
    if (pending || dialog.open) return;
    target = { id, surface, anchor };
    const bounds = anchor.getBoundingClientRect();
    const scene = workspace.documentFor(id).scene;
    menu.setAttribute("aria-label", `Actions for ${scene.name}`);
    for (const chip of chips) {
      chip.setAttribute(
        "aria-checked",
        String(chip.dataset.sceneColor === (scene.color?.toLowerCase() ?? "")),
      );
    }
    menu.hidden = false;
    menu.style.left = `${Math.max(8, Math.min(x ?? bounds.left, innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y ?? bounds.bottom, innerHeight - menu.offsetHeight - 8))}px`;
    firstAction?.focus({ preventScroll: true });
  }

  function attach(anchor: HTMLElement, id: string, surface: SceneSurface) {
    anchor.oncontextmenu = (event) => {
      event.preventDefault();
      show(id, surface, anchor, event.clientX || undefined, event.clientY || undefined);
    };
    anchor.onkeydown = (event) => {
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        event.preventDefault();
        event.stopPropagation();
        show(id, surface, anchor);
      }
    };
  }

  document.addEventListener("pointerdown", (event) => {
    if (!menu.hidden && event.target instanceof Node && !menu.contains(event.target)) hideMenu();
  });
  window.addEventListener("resize", () => hideMenu());
  menu.onkeydown = (event) => {
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (event.key === "Escape" || event.key === "Tab") {
      hideMenu(true);
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    if (
      index >= 0 &&
      index < chips.length &&
      (event.key === "ArrowLeft" || event.key === "ArrowRight")
    ) {
      event.preventDefault();
      const step = event.key === "ArrowRight" ? 1 : -1;
      chips[(index + step + chips.length) % chips.length]?.focus();
      return;
    }
    const next: Record<string, number> = {
      ArrowDown: (index + 1) % buttons.length,
      ArrowUp: (index - 1 + buttons.length) % buttons.length,
      Home: 0,
      End: buttons.length - 1,
    };
    if (Object.hasOwn(next, event.key)) {
      event.preventDefault();
      buttons[next[event.key]]?.focus();
    }
  };

  async function save(currentAction: SceneAction, fields: { name?: string; color?: string } = {}) {
    const selected = target;
    if (!selected || pending) return;
    pending = true;
    const status = dialog.open ? message : get("status");
    apply.disabled = cancel.disabled = name.disabled = true;
    status.textContent = "Saving scene…";
    try {
      await queueWrite(async () => {
        const response = await fetch(`./api/project/scenes/${selected.id}/actions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            baseRevision: workspace.snapshot.revision,
            action: currentAction,
            ...fields,
          }),
        });
        if (response.headers.get("Cartquilt-Conflict") === "stale-revision")
          throw Error("The project changed on disk. Reopen it to load the latest scenes.");
        if (!response.ok) throw Error((await response.text()).trim());
        const result = await response.json();
        const next = decode(result);
        if (currentAction === "duplicate") {
          if (
            !next.project.scenes
              .slice(workspace.snapshot.project.scenes.length)
              .some((scene) => scene.id === result.sceneId)
          )
            throw Error(
              "The service did not return the duplicated scene. Reopen the project to inspect it.",
            );
          workspace.acceptSceneAdditions(next);
        } else {
          workspace.acceptSceneAction(next, selected.id, currentAction);
        }
        if (dialog.open) dialog.close();
        changed(
          currentAction,
          currentAction === "duplicate" ? result.sceneId : selected.id,
          selected.surface,
        );
      });
    } catch (error) {
      status.textContent = (error as Error).message;
    } finally {
      pending = false;
      apply.disabled = cancel.disabled = name.disabled = false;
      if (dialog.open) (currentAction === "rename" ? name : cancel).focus();
    }
  }

  for (const item of buttons) {
    item.onclick = () => {
      if (!target) return;
      const scene = workspace.documentFor(target.id).scene;
      hideMenu(true);
      if (item.dataset.sceneColor !== undefined) {
        void save("color", { color: item.dataset.sceneColor });
        return;
      }
      action = item.value as SceneAction;
      if (action === "duplicate") {
        void save(action);
        return;
      }
      title.textContent = action === "rename" ? "Rename scene" : "Delete scene?";
      description.textContent =
        action === "delete"
          ? `Delete “${scene.name}” from the project? Any edits to this scene in this tab will be discarded.`
          : "";
      description.hidden = !description.textContent;
      get("scene-action-name-field").hidden = action !== "rename";
      name.required = action === "rename";
      name.value = scene.name;
      apply.textContent = action === "delete" ? "Delete scene" : "Save";
      apply.classList.toggle("danger", action === "delete");
      message.textContent = "";
      dialog.showModal();
      (action === "rename" ? name : cancel).focus();
      if (action === "rename") name.select();
    };
  }
  form.onsubmit = (event) => {
    event.preventDefault();
    void save(action, action === "rename" ? { name: name.value } : {});
  };
  cancel.onclick = () => dialog.close();
  dialog.oncancel = (event) => {
    if (pending) event.preventDefault();
  };
  return { show, attach };
}
