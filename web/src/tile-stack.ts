import type { ArtworkEdit } from "./artwork-model.js";
import { get } from "./dom.js";
import type { Scene } from "./model.js";

function part<T extends Element>(root: ParentNode, selector: string) {
  const element = root.querySelector<T>(selector);
  if (!element) throw Error(`Missing tile stack element: ${selector}`);
  return element;
}

export function setupTileStack(
  select: (id: string) => void,
  save: (sceneId: string, edit: ArtworkEdit) => Promise<boolean>,
) {
  const list = get<HTMLOListElement>("tile-stack-list");
  const template = get<HTMLTemplateElement>("tile-stack-row");
  const empty = get("tile-stack-empty");
  const add = get<HTMLButtonElement>("new-tile-layer");
  const form = get<HTMLFormElement>("add-tile-layer-form");
  const submit = part<HTMLButtonElement>(form, "button");
  const name = get<HTMLInputElement>("tile-layer-name");
  let sceneId: string | undefined;
  let signature = "";
  let dragging: HTMLElement | undefined;
  let drop: HTMLElement | undefined;

  function closeForm() {
    form.hidden = true;
    add.setAttribute("aria-expanded", "false");
  }
  add.onclick = () => {
    if (!form.hidden) return closeForm();
    form.hidden = false;
    add.setAttribute("aria-expanded", "true");
    name.focus();
  };
  form.onkeydown = (event) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    closeForm();
    add.focus();
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    const value = name.value.trim();
    if (!sceneId || !value) return;
    const target = sceneId;
    if (submit.disabled) return;
    submit.disabled = true;
    const saved = await save(target, { op: "add-layer", name: value });
    submit.disabled = false;
    if (saved && target === sceneId && name.value.trim() === value) {
      name.value = "";
      const returnFocus = form.contains(document.activeElement);
      closeForm();
      if (returnFocus) list.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
    }
  };

  function clearDrop() {
    if (drop) delete drop.dataset.drop;
    drop = undefined;
  }
  function endDrag() {
    dragging?.classList.remove("dragging");
    dragging = undefined;
    clearDrop();
  }
  list.ondragleave = (event) => {
    if (!(event.relatedTarget instanceof Node) || !list.contains(event.relatedTarget)) clearDrop();
  };

  function sync(scene: Scene | undefined, selected?: string) {
    if (sceneId !== scene?.id) {
      sceneId = scene?.id;
      name.value = "";
      closeForm();
    }
    const layers = scene?.tileLayers ?? [];
    const next = JSON.stringify([
      sceneId,
      selected,
      layers.map(({ id, name, hidden }) => [id, name, hidden]),
    ]);
    if (signature === next) return;
    signature = next;
    endDrag();
    const focused = document.activeElement;
    const focusedId = focused?.closest("li")?.dataset.layer;
    const control =
      list.contains(focused) && focused instanceof HTMLButtonElement
        ? focused.className
        : undefined;
    empty.hidden = layers.length > 0;
    if (!scene) {
      list.replaceChildren();
      return;
    }
    list.replaceChildren(
      ...layers
        .slice()
        .reverse()
        .map((layer, index, stack) => {
          const row = part<HTMLLIElement>(template.content, "li").cloneNode(true) as HTMLLIElement;
          row.dataset.layer = layer.id;
          const selectButton = part<HTMLButtonElement>(row, ".tile-stack-name");
          const eye = part<HTMLButtonElement>(row, ".tile-stack-eye");
          const remove = part<HTMLButtonElement>(row, ".tile-stack-delete");
          part(selectButton, "span").textContent = layer.name;
          selectButton.setAttribute("aria-pressed", String(layer.id === selected));
          selectButton.title = `${layer.name} · Drag or use Alt + ↑/↓ to reorder`;
          selectButton.onclick = () => select(layer.id);
          row.classList.toggle("layer-hidden", layer.hidden);
          eye.title = `${layer.hidden ? "Show" : "Hide"} ${layer.name} layer`;
          eye.setAttribute("aria-label", eye.title);
          part(eye, "use").setAttribute("href", layer.hidden ? "#icon-eye-off" : "#icon-eye");
          eye.onclick = () => void save(scene.id, { op: "toggle-layer", layerId: layer.id });
          remove.title = `Delete ${layer.name} layer`;
          remove.setAttribute("aria-label", remove.title);
          remove.onclick = () => {
            if (window.confirm(`Delete the “${layer.name}” tile layer?`))
              void save(scene.id, { op: "remove-layer", layerId: layer.id });
          };
          selectButton.onkeydown = (event) => {
            if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
            event.preventDefault();
            const above = event.key === "ArrowUp";
            const neighbor = stack[index + (above ? -1 : 1)];
            if (neighbor && !event.repeat)
              void save(scene.id, {
                op: "reorder-layer",
                layerId: layer.id,
                adjacentLayerId: neighbor.id,
                above,
              });
          };
          selectButton.ondragstart = (event) => {
            if (!event.dataTransfer) return;
            dragging = row;
            row.classList.add("dragging");
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("application/x-cartquilt-tile-layer", layer.id);
          };
          selectButton.ondragend = endDrag;
          const aboveMidpoint = (event: DragEvent) => {
            const bounds = row.getBoundingClientRect();
            return event.clientY < bounds.top + bounds.height / 2;
          };
          row.ondragover = (event) => {
            clearDrop();
            if (!dragging || dragging === row || !event.dataTransfer) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            drop = row;
            row.dataset.drop = aboveMidpoint(event) ? "above" : "below";
          };
          row.ondrop = (event) => {
            if (!dragging || dragging === row) return;
            event.preventDefault();
            const layerId = dragging.dataset.layer;
            if (!layerId) return;
            const above = aboveMidpoint(event);
            endDrag();
            if (stack[index + (above ? -1 : 1)]?.id === layerId) return;
            void save(scene.id, {
              op: "reorder-layer",
              layerId,
              adjacentLayerId: layer.id,
              above,
            });
          };
          return row;
        }),
    );
    if (control && focusedId) {
      const button =
        list.querySelector<HTMLButtonElement>(
          `[data-layer="${CSS.escape(focusedId)}"] .${CSS.escape(control)}`,
        ) ??
        list.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ??
        add;
      button.focus({ preventScroll: true });
    }
  }
  return { sync };
}
