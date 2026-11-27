import type { Scene } from "./model.js";

export const gbcSpriteLimits = {
  onscreen: 40,
  perScanline: 10,
};

export function sceneMetrics(scene: Scene) {
  const tilesBySprite = new Map<string, number>();
  const singleScreen = scene.width <= 20 && scene.height <= 18;
  const rows = new Int32Array(singleScreen ? scene.height * 8 + 1 : 0);
  let hardwareSprites = 0;
  for (const actor of scene.actors) {
    const columns = Math.ceil(actor.width / 8);
    const height = Math.ceil(actor.height / 8);
    const tiles = columns * height;
    tilesBySprite.set(actor.sprite, Math.max(tilesBySprite.get(actor.sprite) ?? 0, tiles));
    if (singleScreen) {
      hardwareSprites += tiles;
      rows[actor.y] += columns;
      rows[Math.min(actor.y + height * 8, rows.length - 1)] -= columns;
    }
  }
  let scanline = 0;
  let peakScanline = 0;
  for (const change of rows) {
    scanline += change;
    peakScanline = Math.max(peakScanline, scanline);
  }
  return {
    actors: scene.actors.length,
    spriteTiles: [...tilesBySprite.values()].reduce((sum, tiles) => sum + tiles, 0),
    triggers: 0,
    gbc: singleScreen
      ? {
          hardwareSprites,
          peakScanline,
          overBudget:
            hardwareSprites > gbcSpriteLimits.onscreen ||
            peakScanline > gbcSpriteLimits.perScanline,
        }
      : undefined,
  };
}
