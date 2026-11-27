export const pointerButton = { primary: 0, middle: 1 } as const;
export const pressedPointerButton = { primary: 1, middle: 4 } as const;
const contextMenuViewportInsetPx = 8;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") {
  const node = document.createElement(tag);
  node.className = cls;
  node.textContent = text;
  return node;
}
export function get<T extends HTMLElement = HTMLElement>(id: string | undefined) {
  const node = id && document.getElementById(id);
  if (!node) throw Error(`Missing editor element: ${id}`);
  return node as T;
}
export function button(label: string, act: () => void, cls = "") {
  const node = el("button", cls, label);
  node.onclick = act;
  return node;
}

export function tileAt(
  art: Element,
  pointer: Pick<MouseEvent, "clientX" | "clientY">,
  columns: number,
  rows: number,
  clamp = false,
) {
  const bounds = art.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const x = Math.floor(((pointer.clientX - bounds.left) * columns) / bounds.width);
  const y = Math.floor(((pointer.clientY - bounds.top) * rows) / bounds.height);
  if (!clamp) return x >= 0 && x < columns && y >= 0 && y < rows ? { x, y } : undefined;
  return {
    x: Math.max(0, Math.min(x, columns - 1)),
    y: Math.max(0, Math.min(y, rows - 1)),
  };
}

export function positionContextMenu(menu: HTMLElement, x: number, y: number) {
  menu.hidden = false;
  menu.style.left = `${Math.max(contextMenuViewportInsetPx, Math.min(x, innerWidth - menu.offsetWidth - contextMenuViewportInsetPx))}px`;
  menu.style.top = `${Math.max(contextMenuViewportInsetPx, Math.min(y, innerHeight - menu.offsetHeight - contextMenuViewportInsetPx))}px`;
}
