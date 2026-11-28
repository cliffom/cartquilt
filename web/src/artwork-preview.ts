import { artworkImage, type ArtworkAsset } from "./artwork-model.js";
import { el, positionTileArea } from "./dom.js";
import { footprintSize, type TileArea } from "./grid-geometry.js";
import type { Point } from "./model.js";
import { pixelsPerTile } from "./project-constants.js";

export function fitsScene(
  asset: ArtworkAsset,
  point: Point,
  scene: Pick<TileArea, "width" | "height">,
) {
  const area = { ...point, ...footprintSize(asset, pixelsPerTile) };
  return (
    area.x >= 0 &&
    area.y >= 0 &&
    area.x + area.width <= scene.width &&
    area.y + area.height <= scene.height
  );
}

export function setupArtworkPreview() {
  const outline = el("span", "artwork-placement-preview");
  outline.setAttribute("aria-hidden", "true");
  const ghost = el("img");
  ghost.alt = "";
  outline.append(ghost);
  return {
    clear: () => outline.remove(),
    show(
      art: HTMLElement,
      scene: Pick<TileArea, "width" | "height">,
      asset: ArtworkAsset,
      point: Point,
    ) {
      const area = { ...point, ...footprintSize(asset, pixelsPerTile) };
      positionTileArea(outline, area, scene);
      outline.classList.toggle("blocked", !fitsScene(asset, point, scene));
      outline.style.backgroundSize = `${100 / area.width}% ${100 / area.height}%`;
      if (outline.dataset.asset !== asset.id) {
        outline.dataset.asset = asset.id;
        ghost.src = artworkImage(asset.kind, asset.id);
        ghost.style.width = `${(100 * asset.width) / (area.width * pixelsPerTile)}%`;
        ghost.style.height = `${(100 * asset.height) / (area.height * pixelsPerTile)}%`;
      }
      if (outline.parentElement !== art) art.append(outline);
    },
  };
}
