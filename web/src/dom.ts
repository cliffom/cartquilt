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
