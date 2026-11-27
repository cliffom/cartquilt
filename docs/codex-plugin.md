# Cartquilt in Codex

The first increment creates empty local projects. M4 adds connected scene authoring, visual review, and revision-aware edits. [Milestones and prerequisites](../ROADMAP.md)

## Create a project

From the repository root, run `go install ./cmd/cartquilt`. Make the installed `cartquilt` executable available on the local Codex process’s `PATH`. Register this checkout with `codex plugin marketplace add .`, then run `codex plugin add cartquilt@cartquilt`.

In a local Codex chat, ask **“Use @cartquilt to create a project named Threadvale Draft at /absolute/path/to/threadvale-draft.”** The `create_project` tool takes `name` and `path`. Choose a new folder inside an existing parent folder. The tool returns the saved `project.json` path, project ID, and revision. Use the returned path in the editor's [Open dialog](../README.md#open-your-own-project).

In a new chat, ask **“Use @cartquilt to open /absolute/path/to/threadvale-draft.”** The read-only `open_project` tool accepts the same project folder or saved JSON path as the editor's **Open** dialog and reports its current saved revision.

## M4 authoring demonstration

> Use @cartquilt to build a world and 4 scenes for a game about a courier bringing a lost pattern home.

1. Select a new project location or inspect the explicitly selected project and revision. Establish whether the request adds four scenes or revises existing ones. Keep the creative brief in the Codex conversation.
2. Propose four named scenes: Willow Bank, Dye Garden, Loom Yard, and Weaver’s Loft. Give each a purpose, a distinct silhouette, an entrance, and a reachable destination. Allocate stable IDs once for the batch so doors can refer to scenes created in the same proposal.
3. Return a world-map preview and a playable placeholder blockout for each scene in its chosen movement profile. Walk the riverbank and jump across the loft. Report marker-to-marker traversal times before proposing finished tiles. Offer the collision view alongside the artwork. Show a summary of additions, changed objects, and validation errors. The creator can move a gate or widen a path before accepting.
4. On acceptance, validate and apply the reviewed batch to its base revision. Reject an unresolved entrance or obstructed required route with its scene and coordinates. A failed commit leaves the prior project intact. Retrying the accepted proposal must not duplicate scenes.
5. Reopen the saved project in the browser. Confirm four scenes, their entrances, and the same collision masks. Click a world connection to open its source trigger. Repeat with an unsaved Courier move in a browser tab and confirm it remains recoverable. Play through their entrances in browser preview. Once M5 lands, repeat on the compiled target.

## Package and installation target

The catalog at `.agents/plugins/marketplace.json` points to `./plugins/cartquilt`. The plugin ships its manifest and icon, and its `mcp.json` launches the installed `cartquilt -mcp` executable over stdio. Bundle skills as the matching workflows ship. [Codex plugin packaging and marketplace reference](https://developers.openai.com/plugins/build/plugins)

Verify these installation paths for the GitHub-backed release:

- **CLI:** register the GitHub marketplace with `codex plugin marketplace add cliffom/cartquilt`, then install its entry with `codex plugin add cartquilt@cartquilt`. Start a fresh chat and invoke `@cartquilt`.
- **Desktop:** from the plugin directory, add the repository marketplace source, choose Cartquilt, and install it. In a new local chat, verify the mention resolves and run the same demonstration. Record the tested client version and actual UI steps at release.

Before publishing, validate the catalog, manifest, relative paths, skill discovery, and MCP startup from the installed package. Test on a clean host for every advertised platform. Cover upgrade from the preceding release, an unavailable service, and a protocol mismatch. Return an actionable diagnostic and preserve the selected project in each failure case.

## MCP responsibilities

| Increment | Tools must let the creator… | Verification |
| --- | --- | --- |
| Create | Name a project and choose a new local folder. | Open the returned snapshot in the editor and verify a duplicate request preserves the saved project. |
| Inspect | Select a project, inspect capabilities, read its revision, enumerate scenes/assets, resolve an ID and its references. | Read-only inspection of Threadvale returns the same Courier and coordinates as the Inspector. |
| Propose and preview | Submit a typed batch, validate bounds and references, render candidate world/scene/collision views, revise or discard it. | Browser and MCP render the same candidate geometry. Discard leaves the saved revision intact. |
| Apply and reconcile | Accept a specific proposal, recheck its revision, commit atomically, and report affected IDs and the new revision. | A stale proposal fails with a comparison. A dirty browser tab retains its local copy and history until the creator reconciles it. |
| Build and diagnose | Build an explicit revision and map limits, build errors, and runtime traces to authorable objects. | The same saved project yields the same diagnostics through either surface. Ship with M5–M8 as capabilities become available. |

## Skills to bundle

Each skill should describe when to use it, which project inputs it needs, what to preview, and how to recognize success. Ship it with the first release that passes its example. Keep validation and writes in the service. [Skill authoring reference](https://developers.openai.com/plugins/build/skills)

| Skill | First usable workflow |
| --- | --- |
| Start or inspect a project | Find the intended project, check capabilities and revision, and open the Courier in context. Bundle with the inspect-only increment. |
| Build a connected world | Translate a game brief into scene purposes, placement, entrances, and exits. Coordinate the four-scene proposal and check all references. |
| Generate and revise a blockout | Convert a scene description into terrain, landmarks, routes, and footprints. Return a playable rough scene and a labeled map. Revise one region, then compare a recorded walk or jump. |
| Review collision and traversal | Trace a required route, identify the object blocking it, preview an overlay, and propose a scoped repair. |
| Author assets and animation | Generate tiles for accepted terrain, preview collision over the rendered scene, then generate sprites and a frame atlas. Inspect frame bounds, scrub animation timing, and preview a walk or jump on its actor. Expand to fonts, UI, music, and sound as M6 tools ship. |
| Script and debug interactions | Attach dialogue and a variable condition to a gate, exercise both branches, and report the source event. Ship with M7. |
| Build and playtest | Run the selected revision, capture the failing scene and hardware budget, and return a reproducible playthrough. Grow with the runtime milestones. |
