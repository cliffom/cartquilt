# Cartquilt in Codex

**Planned delivery, M4.** A creator should be able to start in Codex, describe a world, inspect the proposed scenes visually, and open any object in the browser for fine editing. The project stays local. The first installable increment can inspect Threadvale while generation, persistence, and preview are developed. [Milestones and prerequisites](../ROADMAP.md)

## First release demonstration

> Use @cartquilt to build a world and 4 scenes for a game about a courier bringing a lost pattern home.

1. Select a new project location or inspect the explicitly selected project and revision. Establish whether the request adds four scenes or revises existing ones. Keep the creative brief in the Codex conversation.
2. Propose four named scenes: Willow Bank, Dye Garden, Loom Yard, and Weaver’s Loft. Give each a purpose, a distinct silhouette, an entrance, and a reachable destination. Allocate stable IDs once for the batch so doors can refer to scenes created in the same proposal.
3. Return a world-map preview and a labeled top-down blockout for each scene. Offer the collision view alongside the artwork. Show a summary of additions, changed objects, and validation errors. The creator can move a gate or widen a path before accepting.
4. On acceptance, validate and apply the reviewed batch to its base revision. Reject an unresolved entrance or obstructed required route with its scene and coordinates. A failed commit leaves the prior project intact. Retrying the accepted proposal must not duplicate scenes.
5. Reopen the saved project in the browser. Confirm four scenes, their entrances, and the same collision masks. Click a world connection to open its source trigger. Repeat with an unsaved Courier move in a browser tab and confirm it remains recoverable. Once M5 lands, play through all four scenes.

## Package and installation target

Keep the catalog at `.agents/plugins/marketplace.json`, with a marketplace named `cartquilt` and a plugin entry pointing to `./plugins/cartquilt`. Under that folder, plan for a versioned `plugin.json`, `mcp.json` for the local server connection, `skills/<name>/SKILL.md`, and the approved icon. Resolve packaged resources relative to the installed plugin. Select the creator’s project separately. [Codex plugin packaging and marketplace reference](https://developers.openai.com/plugins/build/plugins)

Test these installation paths **when a package exists**:

- **CLI:** register the GitHub marketplace with `codex plugin marketplace add cliffom/cartquilt`, then install its entry with `codex plugin add cartquilt@cartquilt`. Start a fresh chat and invoke `@cartquilt`.
- **Desktop:** from the plugin directory, add the repository marketplace source, choose Cartquilt, and install it. In a new local chat, verify the mention resolves and run the same demonstration. Record the tested client version and actual UI steps at release.

Before publishing, validate the catalog, manifest, relative paths, skill discovery, and MCP startup from the installed package. Test on a clean host for every advertised platform. Cover upgrade from the preceding release, an unavailable service, and a protocol mismatch. Return an actionable diagnostic and preserve the selected project in each failure case.

## MCP responsibilities

| Increment | Tools must let the creator… | Verification |
| --- | --- | --- |
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
| Generate and revise a blockout | Convert a scene description into terrain, landmarks, routes, and footprints. Return a legended preview and revise one region. |
| Review collision and traversal | Trace a required route, identify the object blocking it, preview an overlay, and propose a scoped repair. |
| Author assets and animation | Follow a scene selection to its asset, edit a palette or walk cycle, and preview in context. Expand to fonts, UI, music, and sound as M6 tools ship. |
| Script and debug interactions | Attach dialogue and a variable condition to a gate, exercise both branches, and report the source event. Ship with M7. |
| Build and playtest | Run the selected revision, capture the failing scene and hardware budget, and return a reproducible playthrough. Grow with the runtime milestones. |
