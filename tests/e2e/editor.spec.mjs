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
