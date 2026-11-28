# ![Cartquilt](docs/assets/cartquilt-hero.png)

[![Pull request checks](https://github.com/cliffom/cartquilt/actions/workflows/pr-checks.yml/badge.svg?event=pull_request)](https://github.com/cliffom/cartquilt/actions/workflows/pr-checks.yml)

Cartquilt is a local-first Game Boy Color world and scene editor designed for developers, creators, and coding agents. Arrange scenes on a world map, open one to move an actor, and see the change in its map thumbnail. The editor runs in your browser, with a Go service on your computer that reads the project and its artwork.

## Get started

Install Go 1.25 or later and Node.js 20.19+ on the Node 20 line, or Node.js 22.12+ with npm. From the repository root, run:

```sh
npm ci
npm start
```

Open [Cartquilt on your computer](http://127.0.0.1:4173) and choose **New project** or **Open project**. Keep the terminal open while editing. Press Ctrl+C there to stop the service.

**Actor edits stay in the current tab.** You can move between scenes and keep your actor drafts and undo history. Cartquilt saves scene positions when you drop a card or use Shift+arrow. It asks the browser to warn you if you leave with unsaved edits.

## Try your first edit

Choose **Open project** and select the included `examples/threadvale` folder to try the two-scene sample.

1. Drag **Willow Bank** to a new spot on the map, then double-click its card or select **Open scene** in the Inspector.
2. Select the **Courier** on the canvas or in the Navigator. In the Inspector, change **X** from **73** to **81**. The Courier moves one tile to the right.
3. Choose **← World map**. Willow Bank is where you placed it, and its thumbnail shows the Courier’s new position. **Draft** marks the scene you edited.
4. Visit **Loom Yard**, then reopen Willow Bank. Choose **Undo** to move the Courier back and clear the draft. **Redo** restores the move.

**Map controls.** Drag a scene by its header to move and save it. Drag the background to pan, scroll to zoom around the pointer, or use the **Fit view** icon to bring all scenes into view. With the map focused, use the arrow keys to pan and + or − to zoom. Tab to a card, then press Enter to open it or Shift+arrow to move it. On narrow screens, the **Navigator** and **Inspector** buttons sit beneath the toolbar.

## Open your own project

Choose **New project** in the launcher or the editor’s **Project** menu. Enter a name. On macOS, click **Browse** to select an existing parent folder in the system dialog. Cartquilt suggests the full path using your project name. You can edit the path or enter it directly. Choose **Create project** to write `project.json` and open the empty world in the current tab. If the current tab has unsaved edits, Cartquilt offers a new-tab link to keep your draft open. To start with scenes and artwork, copy the [Threadvale example folder](examples/threadvale/) instead.

After a restart, choose a project in **Recent projects** to reopen it in the same browser on the same port. You can also choose **Open project** and select its folder or enter the path to its saved JSON file. Give the plugin the same path to load the same project. The editor's readable project URL is assigned for the current server session.

You can also start the service with a specific saved file:

```sh
npm run build
go run ./cmd/cartquilt -project path/to/project.json
```

Keep referenced PNGs beside `project.json`. Scene dimensions are in 8-pixel tiles. Actor positions and sizes are in pixels, measured from the scene’s top-left corner. You can also [create a project from Codex](docs/codex-plugin.md#create-a-project).

In the Navigator, choose **+** next to **Scenes**, enter a name and dimensions in tiles, and select **Create scene**. Cartquilt saves the blank scene and selects its card on the world map. Double-click the card or choose **Open scene** in the Inspector to see the grid. Use the search icon next to **Scenes** to filter the list by name.

Right-click a scene in the Navigator or its header on the world map to rename it, duplicate its saved contents, change its border color, or delete it. The Navigator’s **⋯** button and **Shift+F10** open the same menu. Cartquilt asks for confirmation before deleting a scene. Middle-drag anywhere on the world map to pan.

## Connect two scenes

1. Right-click an empty tile in the destination scene’s editor or world map preview. Choose **+ Entrance**, name the spawn point, and save.
2. In the source scene, drag across empty tiles to select the trigger area. Right-click inside the selection, choose **+ Exit**, and select the destination scene and entrance. You can also right-click a single tile and enter the trigger’s dimensions in the form.
3. On the world map, select the arrow to open the source exit for inspection or editing. The Inspector lists the connections for the selected scene.

For keyboard placement, use **Shift+F10** on a world map card and choose **Connections…**. In the scene editor, activate a placement tool and press **Enter** to enter coordinates.

Relink or remove incoming exits before deleting their destination entrance or scene.

## Paint a scene blockout

Open a scene and choose **Blockout**. Pick a brush, then click a tile or drag across the grid to paint a rectangle. To work from an existing selection, use **Select tiles**, drag or Shift-click the corners, then choose a brush and **Apply to selection**. Open **Setup** to change the movement profile or enter a rectangle by tile coordinates.

Scenes open centered at 100%, which fits the full scene in the canvas. Scroll to zoom around the pointer, middle-drag to pan, or use the controls below the canvas. **Fit view** or **F** returns to the centered view.

Use **Erase terrain** to clear terrain inside an area. **Erase markers and guides** removes the whole marker or guide when any part of it crosses the area. The **Markers and guides** list lets you remove one by name. Edits save immediately, including changes made with the scene toolbar’s **Undo** and **Redo** controls. The editor keeps up to 50 saved blockout edits per scene in the current tab’s undo history. If a save fails, the warning names the affected scene and stays visible until dismissed or the project is reopened. **Show layer** toggles the blockout on the scene canvas and in its Inspector preview.

For agent-assisted authoring, use the bundled [Cartquilt blockout skill](docs/codex-plugin.md#author-a-blockout). This first pass saves layout and planning data for later playtesting.

## Paint a room and place the Courier

1. Open a blank scene, choose **Artwork**, enter a layer name such as **Room**, and select **Add layer**.
2. Select **Choose asset**, find **Floor** in the **Tiles** library, and choose **Use tile**. Drag a rectangle. Choose **Wall** for one edge and **Doorway** to mark the opening.
3. Add a **Decor** layer and paint a **Rug** over the floor. Use the layer controls to change the draw order, hide a layer, or remove it. The list shows the top layer first.
4. In the asset library, choose **Sprites**, select **Courier**, and choose **Use sprite**. Click inside the room. Select the placed actor to save a new position or remove it from the scene. Use **Coordinates** for keyboard placement.
5. Turn off **Show artwork** to reveal the blockout. Tile artwork and the Courier placement save as you work. Reopen the scene to review the saved layer order and placements.

Paint walkable and blocked tiles separately with **Blockout**. Changing the visual doorway leaves the authored terrain intact. Use **Erase tile** to clear paint on the selected layer.

Use **Select & move** in Artwork and click a painted tile region on the active layer, then drag it or nudge it with the arrow keys. The Coordinates panel can select a region by tile position. Sprites and painted regions snap their upper-left corner to the 8 × 8 pixel grid. Use the Inspector for exact sprite coordinates in pixels. Tile regions need free space on their own layer.

**Undo** and **Redo** follow the order of artwork and blockout edits in the scene. Each paint or erase stroke, asset placement, and drag is one step. The editor saves the resulting artwork as you undo or redo.

### Import artwork

Open **Asset library** from the project menu or **Choose asset** from a scene’s Artwork tools. Choose **Import assets**, then select **PNG tilesheet** to split a PNG into 8×8 cells, **PNG sprite** for one sprite image, or **GBC Atlas pack** for a PNG and its matching v1 `.atlas.json`. The library previews the image, reports validation errors in the form, and shows the imported assets after saving. Cartquilt copies the images into the project. Atlas sprite regions are usable as individual frames. Cartquilt preserves the atlas metadata for future animation workflows.

Existing loose PNGs in `assets/tiles/` and `assets/sprites/` still appear in the library. Keep the project folder together when moving or sharing it.

### Export a scene to Tiled

Open a scene and choose **Export scene to Tiled** from the project menu. Extract the ZIP and open the `.tmj` file in Tiled with the adjacent `.tsj` and `images/` folder. The bundle contains the saved artwork layers, actors, blockout, and connection objects. Turn on the **Blockout** and **Connections** layers in Tiled to inspect the authored geometry and destination IDs. Cartquilt continues saving native edits to `project.json`.

## Development and roadmap

For local development, run `npm run dev` from the repository root and open [the Vite editor](http://127.0.0.1:5173). It starts Air and Vite in the same terminal. Press Ctrl+C to stop both. The first run downloads the pinned Air version and may fetch its Go toolchain.

### Tests

Keep project validation and persistence tests with their Go packages. Use TypeScript tests for decoder, workspace, and undo behavior. Use Playwright for workflows that need the browser and service together.

- `npm run check` builds the editor and runs formatting, linting, Go tests, and TypeScript tests. Run `npm run test:go` or `npm run test:ts` for a narrower pass. The TypeScript suite uses Go to capture an actual HTTP response for the shared contract tests.
- Run `npx playwright install chromium` once, then `npm run test:e2e` for browser flows. The suite starts Cartquilt on an available loopback port and uses disposable project folders. Pull request checks run `npm run check` and the browser suite. Failed browser traces are saved under `.local/playwright-results/` locally.

Air rebuilds and restarts Go on source changes behind the same Vite address. A successful Go rebuild leaves the page open. Reopen a project from **Recent projects** if refreshing after a rebuild invalidates its session URL. CSS updates in place, and TypeScript or HTML changes reload the page and clear tab-only edits.

Pass `npm run dev -- -project examples/threadvale/project.json` to start with the sample. Set `CARTQUILT_SERVICE_PORT` when running `npm run dev` to use an existing Go service with its own lifecycle.

Use `npm start` for a single-server setup. It builds the frontend into `web/dist/` and serves it from Go alongside the project API.

The Go executable lives in [cmd/cartquilt](cmd/cartquilt/). [internal/project](internal/project/) owns the project format, validation, and file operations. The [HTTP editor](internal/editor/) and [MCP server](internal/mcpserver/) share that package.

From the repository root, run `npm run format` to apply gofmt to Go code and Biome to TypeScript and JavaScript source, tests, and tooling. Use `npm run format:check` for a read-only formatting check.

Run `npm run lint` for Go vet, Biome’s recommended lint rules, and strict TypeScript checking. Before handing off a change, run `npm run check` to verify formatting, lint, and tests together.

Run `npm test` to build the TypeScript client and check the Go service, the project data exchanged with the browser, and scene undo/redo. The [engineering guide](AGENTS.md) describes how the service, scene documents, and workspace share responsibility.

Saving edits to disk, building playable output, and authoring through a revision-aware Codex plugin are planned. Follow the [milestone roadmap](ROADMAP.md), [plugin delivery plan](docs/codex-plugin.md), and [decision log](docs/decisions/README.md) for the next deliverables and how to verify them.
