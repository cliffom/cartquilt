import { button, el, get } from "./dom.js";
import type { Scene } from "./model.js";

const layers = ["artwork", "blockout", "connections"] as const;
type SceneLayer = (typeof layers)[number];

export function setupSceneLayers(changed: () => void) {
  const section = get("scene-layers");
  const list = get("layer-list");
  const overlays = get("overlay-list");
  const switcher = get<HTMLDetailsElement>("layer-switcher");
  const heading = get("editing-target");
  let sceneId: string | undefined;
  let active: SceneLayer = "blockout";
  const hidden = new Set<SceneLayer>();

  function select(layer: SceneLayer) {
    if (active === layer && !hidden.has(layer)) return;
    active = layer;
    hidden.delete(layer);
    changed();
  }

  const rows = layers.map((layer) => {
    const name = layer[0].toUpperCase() + layer.slice(1);
    const panel = get(`${layer}-tools`);
    const edit = button(
      name,
      () => {
        select(layer);
        switcher.open = false;
        heading.focus();
      },
      "layer-name",
    );
    edit.setAttribute("aria-controls", panel.id);
    const eye = button(
      "",
      () => {
        if (hidden.has(layer)) hidden.delete(layer);
        else hidden.add(layer);
        changed();
      },
      "layer-eye",
    );
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.classList.add("icon");
    icon.setAttribute("aria-hidden", "true");
    const use = document.createElementNS(icon.namespaceURI, "use");
    icon.append(use);
    eye.append(icon);
    const row = el("div", "layer-row");
    row.append(edit, eye);
    (layer === "connections" ? overlays : list).append(row);
    return { layer, name, edit, eye, use, panel };
  });

  function sync(scene?: Scene) {
    if (scene?.id !== sceneId) {
      sceneId = scene?.id;
      hidden.clear();
      switcher.open = false;
      active =
        scene && (scene.art || scene.tileLayers.length || scene.actors.length)
          ? "artwork"
          : "blockout";
    }
    section.hidden = !scene;
    for (const { layer, name, edit, eye, use, panel } of rows) {
      const visible = !hidden.has(layer);
      edit.setAttribute("aria-pressed", String(active === layer));
      eye.setAttribute("aria-label", `Show ${layer}`);
      eye.setAttribute("aria-pressed", String(visible));
      eye.title = `${visible ? "Hide" : "Show"} ${name}`;
      use.setAttribute("href", visible ? "#icon-eye" : "#icon-eye-off");
      panel.hidden = !scene || active !== layer || !visible;
      if (layer === active) heading.textContent = visible ? `Editing ${layer}` : `${name} hidden`;
    }
  }

  return {
    sync,
    select,
    visible: (layer: SceneLayer) => !hidden.has(layer),
    editing: (layer: SceneLayer) => !!sceneId && active === layer && !hidden.has(layer),
  };
}
