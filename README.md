# ![Cartquilt](docs/assets/cartquilt-hero.png)

[![Pull request checks](https://github.com/cliffom/cartquilt/actions/workflows/pr-checks.yml/badge.svg?event=pull_request)](https://github.com/cliffom/cartquilt/actions/workflows/pr-checks.yml)

Cartquilt is a local-first Game Boy Color world and scene editor designed for developers, creators, and coding agents. Arrange scenes on a world map, open one to move an actor, and see the change in its map thumbnail. The editor runs in your browser, with a Go service on your computer that reads the project and its artwork.

## Get started

Install Go 1.22 or later and Node.js 20 or later with npm. From the repository root, run:

```sh
npm ci
npm start
```

Open [Cartquilt on your computer](http://127.0.0.1:4173). You’ll see the world map for **Threadvale**, the included two-scene project. Keep the terminal open while editing. Press Ctrl+C there to stop the service.

**Edits last for the current tab.** You can move between scenes and keep your drafts, map layout, and undo history. Closing or reloading the tab discards them. Cartquilt asks the browser to warn you if you’ve edited a scene or moved a scene card.

## Try your first edit

1. Drag **Willow Bank** to a new spot on the map, then double-click its card or select **Open scene** in the Inspector.
2. Select the **Courier** on the canvas or in the Navigator. In the Inspector, change **X** from **73** to **81**. The Courier moves one tile to the right.
3. Choose **← World map**. Willow Bank is where you placed it, and its thumbnail shows the Courier’s new position. **Draft** marks the scene you edited.
4. Visit **Loom Yard**, then reopen Willow Bank. Choose **Undo** to move the Courier back and clear the draft. **Redo** restores the move.

**Map controls.** Drag the background to pan, scroll to zoom around the pointer, or choose **Fit** to bring all scenes into view. With the map focused, use the arrow keys to pan and + or − to zoom. Tab to a card, then press Enter to open it or Shift+arrow to move it. On narrow screens, the **Navigator** and **Inspector** buttons sit beneath the toolbar.

## Open your own project

Copy the [Threadvale example folder](examples/threadvale/) as a starting point. Its `project.json` names the scenes, their positions on the map, and their actors. Keep referenced PNGs beside the JSON file. Scene dimensions are in 8-pixel tiles. Actor positions and sizes are in pixels, measured from the scene’s top-left corner.

Stop the running service, then start it with the path to your copy:

```sh
npm run build
go run ./cmd/cartquilt -project path/to/project.json
```

## Development and roadmap

From the repository root, run `npm run format` to apply gofmt to Go code and Biome to TypeScript and JavaScript source, tests, and tooling. Use `npm run format:check` for a read-only formatting check.

Run `npm run lint` for Go vet, Biome’s recommended lint rules, and strict TypeScript checking. Before handing off a change, run `npm run check` to verify formatting, lint, and tests together.

Run `npm test` to build the TypeScript client and check the Go service, the project data exchanged with the browser, and scene undo/redo. The [engineering guide](AGENTS.md) describes how the service, scene documents, and workspace share responsibility.

Saving edits to disk, building playable output, and authoring through a revision-aware Codex plugin are planned. Follow the [milestone roadmap](ROADMAP.md), [plugin delivery plan](docs/codex-plugin.md), and [decision log](docs/decisions/README.md) for the next deliverables and how to verify them.
