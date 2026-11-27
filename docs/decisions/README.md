# Cartquilt decisions

Use this log for choices that change project compatibility, state ownership, creator interactions, runtime behavior, or distribution. **Accepted** records an established direction. **Proposed** identifies a choice awaiting evidence. A milestone tracks implementation separately. Add a dated entry or a linked record with context, alternatives, choice, consequences, and a verification or revisit condition. When replacing a decision, mark it superseded and link its successor.

### D01 · Local project and browser state

**Accepted · Architecture · 2026-11-26 · M0.** The loopback service owns the saved snapshot and revision. Each scene document owns its baseline, editable copy, and history. The workspace owns camera and selection. Putting all of this into one persisted document would cause viewing the map to look like editing it. Keep camera movement out of save conflicts and make both authored layout and content changes visible. The world → scene → world regression is the check.

### D02 · Shared operations and explicit saves

**Proposed · Architecture · 2026-11-26 · M1.** Direct plugin writes to project JSON would bypass browser validation and race an open draft. Route browser saves and MCP applies through one local project service. Keep UI controls and MCP arguments as adapters over the same typed operations. Go validates and commits against the base revision. The browser can apply operations provisionally for immediate feedback and undo. Shared fixtures catch semantic drift between the two languages.

An apply identifies the exact reviewed proposal. A stale revision requires a fresh comparison. An open dirty tab keeps its draft and original base when another client saves, receives notice of the new revision, and can reconcile explicitly. Test this with two processes and a restarted service before accepting the design. Decide session discovery and draft notification transport during M1/M4.

### D03 · Editable blockouts and collision

**Proposed · Interaction design · 2026-11-26 · M3.** Store a blockout as editable grid regions, placements, and references. A generated bitmap alone would lose the intent behind a bridge or gate. Render art, collisions, triggers, and selections separately. Store authored collision cells and object footprints, then derive effective occupancy with a source reference per blocker. A red overlay is the initial visual treatment. Patterns, labels, and keyboard inspection must also distinguish blocked space.

Prototype one river crossing with a collidable crate. Test moving the crate, changing the artwork, hiding collisions, and navigating the route. Decide directional collisions, actor groups, and tile-level exceptions against movement fixtures before extending the format.

**Accepted direction · Interaction design · 2026-11-26 · M3/M6.** Use the blockout as the base authoring layer for top-down and platformer scenes. Terrain and platforms supply playable geometry. Visual layers supply background, terrain art, and foreground detail. Objects and connections have their own editing controls. Draw order and layer visibility control presentation. Gameplay changes come from edits to geometry, object footprints, or explicit collision overrides.

**Proposed implementation.** Bind platform artwork to the stable ID of its blockout shape, so one move updates both the rendered placement and the collision footprint. Keep derived collision and authored overrides distinguishable in the editor. Use the [scene-layer checks](../../ROADMAP.md#scene-layers) to verify these behaviors before settling the layer schema and Tiled mappings.

### D04 · Repo-backed plugin delivery

**Accepted direction · Distribution · 2026-11-26 · M4.** Publish the marketplace catalog, plugin package, bundled skills, and MCP contract from this repository so the editor and plugin can be tested against the same revision. A separate marketplace repository would require coordinating two releases for this single plugin. Keep plugin version, service protocol version, and project schema version identifiable independently. Clean-install and upgrade tests on both surfaces are the release evidence. [Delivery plan](../codex-plugin.md)

### D05 · Play the layout before producing art

**Accepted direction · Product · 2026-11-26 · M3/M6.** A generated scene must be playable with placeholders. Designers need to discover that a jump is too wide or a walk takes too long while changing the layout is cheap. Treat terrain, object bounds, entrances, movement settings, and collision overrides as authored scene data. Tile bindings and sprite frames supply appearance. Changes to gameplay made during an art pass should appear as explicit edits in the proposal.

**Accepted direction · Architecture · 2026-11-26 · M2/M3/M6.** A world contains one or more scenes and derives its connections from scene exits that reference destination scenes and entrances by stable ID. Each scene owns the layout and gameplay data needed to play its blockout. The project owns a shared asset catalog. Scenes reference tilesets, sprites, and animations by stable ID and own their individual placements and bindings. Verify this by following an exit between two playable blockouts, then binding the same asset in both scenes and previewing a shared asset update in each.

**Proposed implementation.** Use a common scene document and select movement behavior per scene. Top-down movement needs planar speed and footprint tests. The platformer also needs gravity, jump impulse, grounded state, and directional contact handling. Keep shared world references, art bindings, and timing capture independent of these profiles. Exercise both profiles before designing an extension API for additional modes. The first proof is the paired [playable slice](../../ROADMAP.md#the-first-playable-slice).

### D06 · Tiled scene interchange

**Accepted direction · Architecture · 2026-11-26 · M3 and follow-up.** Ship editable Tiled export with the first playable blockouts. Use Tiled JSON as an interchange format over Cartquilt's saved scene model. Native Tiled project storage would require a convention for every Cartquilt runtime and authoring concept before the first playtest. Cartquilt owns scene and object IDs, movement profiles, traversal recordings, actor animation bindings, and entrance-to-exit links. A later Tiled world export can carry map placement while Cartquilt retains the transition graph.

**Proposed implementation.** Use finite orthogonal maps with tile layers for appearance and editable objects or layers for blockout geometry, entrances, exits, and authored collision overrides. Carry stable Cartquilt IDs in custom properties and retain the source scene revision for reimport. Derive effective collision from imported geometry and authored overrides through the same validation path used by native edits. Document the supported mappings before shipping export.

Bring supported reimport changes through the proposal and revision checks in D02. Verify reimport without edits, an art-only edit, and a geometry edit across the top-down and platformer fixtures before releasing import. Use the [roadmap checks](../../ROADMAP.md#tiled-compatibility) to verify replay timing, collision, and reference integrity. Expand the format subset when representative external maps establish what creators need.

### D07 · Create an empty local project

**Accepted · Architecture · 2026-11-26 · M0.** Create a blank project at an explicit absolute folder path and persist a versioned `project.json` with a stable project ID and an empty scene list. The browser and MCP tool use one creation function. Requiring a new folder gives the creator a clear destination and prevents existing files from being replaced. Use the normal project loader for empty projects and examples alike. Exercise both creation paths, reopening the saved file and checking that an existing folder survives a second request.

**Accepted · 2026-11-27.** Use the saved project folder or JSON path to locate a project in the browser and MCP. The saved ID identifies the project and the revision identifies its current content. Readable browser routes belong to one running server. Verify that an independent server and MCP session can load the same saved project by path.

### D08 · Project services and frontend build

**Accepted · Architecture · 2026-11-27 · M0.** Keep saved project data and filesystem operations in `internal/project`. HTTP and MCP packages adapt those operations to their respective transports. The executable wires them together. Vite serves frontend source during development and proxies project requests to the loopback Go service. The production build is served alongside the API by Go. Verify the same project workflow through both frontend entry points and the MCP transport.

`npm run dev` starts Vite and a pinned Air watcher. Air rebuilds the Go service on source changes and retains the same backend port throughout the development session. Vite keeps the browser open during Go restarts so in-tab edits remain available.

### Decisions due before dependent work

| Before | Decide | Evidence needed |
| --- | --- | --- |
| M1 writes | Snapshot/asset revision scope, migration policy, atomic write boundary | Reload v1, simulate an interrupted save and two writers, inspect the recovered project. |
| M3 generation | Blockout vocabulary, region replacement rules, collision precedence | A creator revises one generated area without disturbing a neighboring authored area. |
| M3 Tiled export | Layer and object mappings, coordinate conventions, stable ID and revision metadata | Both blockout exports open in Tiled and match the authored geometry. |
| M4 release | Local runtime discovery, supported hosts, binary packaging and update policy | Install into a fresh profile without a source checkout and diagnose a missing or incompatible runtime. |
| M5 runtime | Compiler/backend, runtime license, build inputs, emulator integration | Build a minimal original two-room ROM, compare collision and transitions, measure output size and frame time. |
| M8 scope | Additional target profiles and extension API stability | Run a representative game per proposed profile and upgrade one original extension. |
