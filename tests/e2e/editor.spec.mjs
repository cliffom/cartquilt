import { join } from "node:path";
import { expect, openExample, test } from "./fixtures.mjs";

const exampleGrid = { columns: 20, rows: 14 };

async function tileCenter(card, x, y) {
  const bounds = await card.locator(".art").boundingBox();
  if (!bounds) throw Error("Scene grid is outside the viewport");
  return [
    bounds.x + (bounds.width * (x + 0.5)) / exampleGrid.columns,
    bounds.y + (bounds.height * (y + 0.5)) / exampleGrid.rows,
  ];
}

test("creates a project and scene, then reopens it from recents", async ({ page, workspace }) => {
  await page.goto(workspace.origin);
  await page.getByRole("button", { name: "New project", exact: true }).click();
  const project = page.getByRole("dialog", { name: "New project" });
  await project.getByLabel("Project name").fill("Fern Garden");
  await project.getByLabel("Project folder").fill(join(workspace.folder, "fern-garden"));
  await project.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveTitle("Fern Garden · Cartquilt");

  await page.getByRole("button", { name: "New scene" }).click();
  const scene = page.getByRole("dialog", { name: "New scene" });
  await expect(scene.getByLabel("Width in tiles")).toHaveValue("20");
  await expect(scene.getByLabel("Height in tiles")).toHaveValue("18");
  await scene.getByLabel("Scene name").fill("Greenhouse");
  await scene.getByRole("button", { name: "Create scene" }).click();
  const canvas = page.getByLabel("World map canvas");
  await expect(canvas.getByRole("button", { name: "Greenhouse" })).toBeVisible();

  await page.locator("#project-menu summary").click();
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Close project?" })
    .getByRole("button", { name: "Close project" })
    .click();
  await expect(page).toHaveURL(`${workspace.origin}/`);
  await page
    .getByRole("region", { name: "Recent projects" })
    .getByRole("button", { name: /^Fern Garden/ })
    .click();
  await expect(canvas.getByRole("button", { name: "Greenhouse" })).toBeVisible();
});

test("links a multi-tile exit to a named entrance from the world map", async ({
  page,
  workspace,
}) => {
  await openExample(page, workspace);
  const canvas = page.getByLabel("World map canvas");
  const loom = canvas.getByRole("button", { name: "Loom Yard", exact: true });
  const willow = canvas.getByRole("button", { name: "Willow Bank", exact: true });
  const menu = page.getByRole("menu", { name: "Scene connection actions" });
  await page.mouse.click(...(await tileCenter(loom, 2, 8)), { button: "right" });
  await menu.getByRole("menuitem", { name: "Entrance" }).click();
  const entrance = page.getByRole("dialog", { name: "Add entrance" });
  await expect(entrance.getByLabel("Tile X")).toHaveValue("2");
  await expect(entrance.getByLabel("Tile Y")).toHaveValue("8");
  await entrance.getByLabel("Name", { exact: true }).fill("West gate");
  await entrance.getByRole("button", { name: "Save" }).click();
  await expect(loom.locator(".scene-marker-entrance")).toBeVisible();

  await page.mouse.move(...(await tileCenter(willow, 15, 8)));
  await page.mouse.down();
  await page.mouse.move(...(await tileCenter(willow, 13, 6)), { steps: 4 });
  await page.mouse.up();
  await expect(willow.locator(".scene-tile-selection")).toBeVisible();
  await page.mouse.move(...(await tileCenter(willow, 14, 7)));
  await expect(willow.locator(".scene-cell-hover")).toBeHidden();
  await page.mouse.click(...(await tileCenter(willow, 14, 7)), { button: "right" });
  await expect(menu.getByRole("menuitem", { name: "Entrance" })).toBeHidden();
  await menu.getByRole("menuitem", { name: "Exit" }).click();
  const exit = page.getByRole("dialog", { name: "Add exit" });
  await expect(exit.getByLabel("Tile X")).toHaveValue("13");
  await expect(exit.getByLabel("Tile Y")).toHaveValue("6");
  await expect(exit.getByLabel("Width in tiles")).toHaveValue("3");
  await expect(exit.getByLabel("Height in tiles")).toHaveValue("3");
  await exit.getByLabel("Name", { exact: true }).fill("East gate");
  await exit.getByLabel("Destination scene").selectOption({ label: "Loom Yard" });
  await exit.getByLabel("Destination entrance").selectOption({ label: "West gate" });
  await exit.getByRole("button", { name: "Save" }).click();
  await expect(willow.locator(".scene-marker-exit")).toBeVisible();

  await page.reload();
  await expect(willow.locator(".scene-marker-exit")).toBeVisible();
  await canvas
    .getByRole("button", { name: "Willow Bank · East gate → Loom Yard · West gate" })
    .click();
  const edit = page.getByRole("dialog", { name: "Edit exit" });
  await expect(edit.getByLabel("Name", { exact: true })).toHaveValue("East gate");
  await expect(edit.getByLabel("Width in tiles")).toHaveValue("3");
});

test("middle-drag pans over a card while header drag saves the card position", async ({
  page,
  workspace,
}) => {
  await openExample(page, workspace);
  const card = page
    .getByLabel("World map canvas")
    .getByRole("button", { name: "Willow Bank", exact: true });
  const plane = page.locator("#plane");
  const camera = await plane.evaluate((el) => getComputedStyle(el).transform);
  const initialLayout = await card.evaluate((el) => el.style.left);
  const [x, y] = await tileCenter(card, 5, 5);
  await page.mouse.move(x, y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(x + 28, y + 20, { steps: 4 });
  await page.mouse.up({ button: "middle" });
  await expect(plane).not.toHaveCSS("transform", camera);
  await expect(card).toHaveCSS("left", initialLayout);

  const header = await card.locator(".scene-card-header").boundingBox();
  if (!header) throw Error("Scene card header is outside the viewport");
  const start = { x: header.x + header.width / 2, y: header.y + header.height / 2 };
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/scenes/willow-bank/actions"),
  );
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 40, start.y + 24, { steps: 4 });
  await page.mouse.up();
  expect((await saved).ok()).toBe(true);
  await expect(page.locator("#status")).toHaveText("No unsaved scene edits");
  const updatedLayout = await card.evaluate((el) => el.style.left);
  expect(updatedLayout).not.toBe(initialLayout);
  await page.reload();
  await expect(card).toHaveCSS("left", updatedLayout);
});

test("paints, erases, and reopens a saved scene blockout", async ({ page, workspace }) => {
  await openExample(page, workspace);
  const card = page.getByLabel("World map canvas").getByRole("button", { name: "Willow Bank" });
  await card.dblclick();
  const canvas = page.getByLabel("Willow Bank scene canvas");
  await page.getByRole("button", { name: "Blockout", exact: true }).click();
  const tools = page.getByRole("region", { name: "Blockout tools" });
  const saved = page.locator("#blockout-status");
  const brush = tools.getByLabel("Brush");
  const setup = tools.getByText("Setup", { exact: true });
  await setup.click();
  const movement = tools.getByLabel("Movement");
  await movement.focus();
  await movement.selectOption("platformer");
  await expect(saved).toHaveText("Blockout saved.");
  await expect(movement).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(tools.getByLabel("Movement")).toBeHidden();

  await brush.selectOption("walkable");
  await page.mouse.click(...(await tileCenter(canvas, 2, 2)));
  const ground = canvas.locator('[data-terrain="walkable"]');
  await expect(ground).toHaveCount(1);
  await expect(ground).toHaveAttribute("style", /left: 10%;/);

  await brush.selectOption("select");
  await page.mouse.click(...(await tileCenter(canvas, 2, 2)));
  await page.keyboard.down("Shift");
  await page.mouse.click(...(await tileCenter(canvas, 3, 3)));
  await page.keyboard.up("Shift");
  await expect(tools.locator("#blockout-selection-info")).toHaveText(
    "2×2 tiles · Walkable, Unpainted",
  );

  await brush.selectOption("blocked");
  await page.mouse.move(...(await tileCenter(canvas, 5, 4)));
  await page.mouse.down();
  await page.mouse.move(...(await tileCenter(canvas, 7, 5)), { steps: 4 });
  await page.mouse.up();
  const wall = canvas.locator('[data-terrain="blocked"]');
  await expect(wall).toHaveCount(1);
  await expect(wall).toHaveAttribute("style", /width: 15%;/);

  await brush.selectOption("player-spawn");
  await tools.getByLabel("Label").fill("Courier start");
  await page.mouse.click(...(await tileCenter(canvas, 5, 4)));
  await expect(canvas.locator('[data-element="player-spawn"]')).toHaveCount(1);

  await brush.selectOption("select");
  await page.mouse.click(...(await tileCenter(canvas, 5, 4)));
  await page.keyboard.down("Shift");
  await page.mouse.click(...(await tileCenter(canvas, 7, 5)));
  await page.keyboard.up("Shift");
  await expect(canvas.locator(".scene-tile-selection")).toBeVisible();
  await brush.selectOption("erase");
  await tools.getByRole("button", { name: "Apply to selection" }).click();
  await expect(wall).toHaveCount(0);
  await expect(ground).toHaveCount(1);
  await expect(canvas.locator('[data-element="player-spawn"]')).toHaveCount(1);

  const undo = page.getByRole("button", { name: "Undo", exact: true });
  const redo = page.getByRole("button", { name: "Redo", exact: true });
  await undo.click();
  await expect(wall).toHaveCount(1);
  const snapshotURL = new URL("./api/project", page.url()).href;
  const restored = await page.request.get(snapshotURL);
  const scene = (await restored.json()).project.scenes.find((item) => item.id === "willow-bank");
  expect(scene.blockout.terrain.some((region) => region.kind === "blocked")).toBe(true);
  await redo.click();
  await expect(wall).toHaveCount(0);
  await expect(canvas.locator('[data-element="player-spawn"]')).toHaveCount(1);

  await brush.selectOption("one-way");
  await setup.click();
  await tools.getByLabel("Tile X", { exact: true }).fill("10");
  await tools.getByLabel("Tile Y", { exact: true }).fill("7");
  await tools.getByLabel("Width in tiles").fill("4");
  await tools.getByRole("button", { name: "Apply brush" }).click();
  await expect(canvas.locator('[data-terrain="one-way"]')).toHaveAttribute("style", /width: 20%;/);
  await page.keyboard.press("Escape");
  let releaseStroke;
  const heldStroke = new Promise((resolve) => {
    releaseStroke = resolve;
  });
  await page.route(
    "**/api/project/scenes/*/actions",
    async (route) => {
      await heldStroke;
      await route.continue();
    },
    { times: 1 },
  );
  await brush.selectOption("water");
  try {
    await page.mouse.click(...(await tileCenter(canvas, 1, 10)));
    await page.mouse.click(...(await tileCenter(canvas, 3, 10)));
    await expect(page.locator("#status")).toHaveText("Saving blockout…");
    expect(
      await page.evaluate(() => {
        const event = new Event("beforeunload", { cancelable: true });
        return !window.dispatchEvent(event);
      }),
    ).toBe(true);
    await page.locator("#project-menu summary").click();
    await page.getByRole("button", { name: "Close project", exact: true }).click();
    const close = page.getByRole("dialog", { name: "Close project?" });
    await expect(close).toContainText("Unsaved edits in this tab will be discarded.");
    await close.getByRole("button", { name: "Cancel" }).click();
  } finally {
    releaseStroke();
  }
  await expect(canvas.locator('[data-terrain="water"]')).toHaveCount(2);
  await expect(page.locator("#status")).toHaveText("No unsaved scene edits");
  await expect(undo).toBeEnabled();
  await canvas.press("Control+z");
  await expect(canvas.locator('[data-terrain="water"]')).toHaveCount(1);
  await expect(redo).toBeEnabled();
  await canvas.press("Control+Shift+z");
  await expect(canvas.locator('[data-terrain="water"]')).toHaveCount(2);
  await tools.getByLabel("Show layer").uncheck();
  await expect(canvas.locator(".blockout-layer")).toHaveCount(0);
  await tools.getByLabel("Show layer").check();
  await expect(ground).toBeVisible();

  await page.reload();
  await card.dblclick();
  await expect(ground).toBeVisible();
  await expect(wall).toHaveCount(0);
  await expect(canvas.locator('[data-terrain="one-way"]')).toHaveCount(1);
  await expect(canvas.locator('[data-element="player-spawn"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Blockout", exact: true }).click();
  await setup.click();
  await expect(tools.getByLabel("Movement")).toHaveValue("platformer");
  await tools.getByText("Markers and guides", { exact: true }).click();
  await expect(tools.getByLabel("Movement")).toBeHidden();
  await expect(tools.getByText("Courier start · 5, 4")).toBeVisible();
});

test("reports a failed blockout save after opening another scene", async ({ page, workspace }) => {
  await openExample(page, workspace);
  const world = page.getByLabel("World map canvas");
  const willow = world.getByRole("button", { name: "Willow Bank", exact: true });
  const back = page.getByRole("button", { name: "← World map" });
  await willow.dblclick();
  const canvas = page.getByLabel("Willow Bank scene canvas");
  await page.getByRole("button", { name: "Blockout", exact: true }).click();
  await page.getByLabel("Brush").selectOption("walkable");

  let releaseSave;
  const held = new Promise((resolve) => {
    releaseSave = resolve;
  });
  await page.route(
    "**/api/project/scenes/willow-bank/actions",
    async (route) => {
      await held;
      await route.fulfill({ status: 409, headers: { "Cartquilt-Conflict": "stale-revision" } });
    },
    { times: 1 },
  );
  try {
    await page.mouse.click(...(await tileCenter(canvas, 2, 2)));
    await expect(page.locator("#status")).toHaveText("Saving blockout…");
    await back.click();
    await world.getByRole("button", { name: "Loom Yard", exact: true }).dblclick();
  } finally {
    releaseSave();
  }

  const saveError = page
    .getByRole("alert")
    .filter({ hasText: "Could not save blockout for Willow Bank" });
  await expect(saveError).toBeVisible();
  await expect(saveError).toContainText("Reopen it to load the latest blockout.");
  await expect(page.locator("#status")).toHaveText("Blockout save failed");
  await back.click();
  await willow.dblclick();
  await expect(saveError).toBeVisible();
  await expect(canvas.locator('[data-terrain="walkable"]')).toHaveCount(0);
});

test("zooms and fits the scene while keeping blockout strokes aligned", async ({
  page,
  workspace,
}) => {
  await openExample(page, workspace);
  const zoom = page.getByRole("group", { name: "Zoom controls" });
  const percentage = zoom.locator("#percentage");
  const fit = zoom.getByRole("button", { name: "Fit view" });
  await expect(fit.locator("svg")).toBeVisible();
  await expect(fit).toHaveText("");
  await zoom.getByRole("button", { name: "Zoom in" }).click();
  const worldZoom = await percentage.textContent();
  const world = page.getByLabel("World map canvas");
  await world.getByRole("button", { name: "Willow Bank", exact: true }).dblclick();
  const canvas = page.getByLabel("Willow Bank scene canvas");
  const art = canvas.locator(".art");
  await page.getByRole("button", { name: "Blockout", exact: true }).click();
  await page.getByLabel("Brush").selectOption("walkable");
  await expect(percentage).toHaveText("100%");

  const xTile = 8;
  const yTile = 6;
  const [x, y] = await tileCenter(canvas, xTile, yTile);
  const before = await art.boundingBox();
  if (!before) throw Error("Expected the fitted artwork to be visible");
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, -240);
  await expect(percentage).not.toHaveText("100%");
  const zoomed = await art.boundingBox();
  if (!zoomed) throw Error("Expected the zoomed artwork to be visible");
  expect(zoomed.width).toBeGreaterThan(before.width);
  const [zoomedX, zoomedY] = await tileCenter(canvas, xTile, yTile);
  expect(Math.abs(zoomedX - x)).toBeLessThan(1);
  expect(Math.abs(zoomedY - y)).toBeLessThan(1);

  await page.mouse.click(x, y);
  const paint = canvas.locator('[data-terrain="walkable"]');
  await expect(paint).toHaveAttribute("style", /left: 40%;/);
  await page.mouse.move(x, y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(x + 36, y + 18, { steps: 4 });
  await page.mouse.up({ button: "middle" });
  const panned = await art.boundingBox();
  if (!panned) throw Error("Expected the panned artwork to be visible");
  expect(panned.x - zoomed.x).toBeCloseTo(36, 0);
  expect(panned.y - zoomed.y).toBeCloseTo(18, 0);

  await page.getByRole("button", { name: "← World map" }).click();
  await expect(percentage).toHaveText(worldZoom);
  await world.getByRole("button", { name: "Willow Bank", exact: true }).dblclick();
  await expect(percentage).toHaveText("100%");
  const fitted = await art.boundingBox();
  const viewport = await canvas.boundingBox();
  if (!fitted || !viewport) throw Error("Expected the artwork to fit within the canvas");
  expect(fitted.x + fitted.width / 2).toBeCloseTo(viewport.x + viewport.width / 2, 0);
  expect(fitted.y + fitted.height / 2).toBeCloseTo(viewport.y + viewport.height / 2, 0);

  await canvas.press("=");
  await expect(percentage).toHaveText("120%");
  await fit.click();
  await expect(percentage).toHaveText("100%");
  await canvas.press("=");
  await expect(percentage).toHaveText("120%");
  await canvas.press("f");
  await expect(percentage).toHaveText("100%");
});
