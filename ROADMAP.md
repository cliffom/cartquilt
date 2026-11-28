# Cartquilt roadmap

**Product goal:** describe a scene, play a rough version to tune traversal and timing, then generate tiles and sprites for the layout you choose to keep. The blockout and finished scene share geometry, entrances, and collision. Top-down 2D and platformer scenes are the first two movement profiles.

**Next foundation:** save one Courier move and detect a conflicting save. **First product test:** use the slice below to decide whether this authoring loop is worth expanding. The playable blockout, generation tools, and asset workflows are planned.

## Worlds, scenes, and assets

- A **world** contains one or more scenes. An exit connects its scene to a named entrance in another scene, so the world map can show how the player travels between them.
- A **scene** is a playable area with its own layout, collision, actors, entrances, exits, and movement rules. Use placeholder shapes to play and revise the blockout before adding artwork.
- An **asset** is reusable content such as a tileset, sprite, or animation. Scenes reference shared assets, so the same tileset can render different layouts and the same sprite animation can appear in multiple scenes.

See [the scene and asset decision](docs/decisions/README.md#d05--play-the-layout-before-producing-art).

## The first playable slice

Build this slice across milestones. Use M1's proposal and save path, the scene IDs and entrance pair from M2, a minimal M3 simulator, and a small M6 tileset pass. The complete world editor, marketplace release, and ROM compiler can follow the first browser playtest.

| Step | Creator action | Acceptance check |
| --- | --- | --- |
| Describe | In Codex, describe the space, movement profile, spawn, destination, and desired pace. Generate an editable blockout of terrain, obstacles, exits, and actor markers. | Open the candidate visually. Move one obstacle by hand and regenerate a selected region. The edit outside that region survives. |
| Play | Start at a named entrance with placeholder shapes and a controllable player. Restart immediately after a layout or movement edit. | Record input against a fixed simulation step. Show elapsed time between named markers and the scene revision and movement settings used. Replay the run to compare iterations. |
| Render | Generate a small tileset for the accepted blockout, map terrain kinds to tile variants, and preview the scene with those bindings. | Switch between blockout and artwork at the same camera position. Replay the same input with the same movement settings. Contacts, arrival tick, and destination match. |
| Inspect collision | Generate a collision map from the blockout's terrain and placed objects. Preview it over rough geometry or finished art, select a blocker, and paint an override. | Hatching and labels distinguish solids, one-way platforms, and passable cells. Moving a crate updates its footprint. A tileset change preserves the authored override. |
| Navigate the world | Follow an exit into a second scene, return to its source trigger from the world map, and reopen the scene where editing stopped. | Preserve camera, selection, drafts, and stable entrance IDs across the round trip. A renamed scene still receives the player at the intended entrance. |

Run two fixtures before expanding the generator:

- **River crossing, top-down.** Describe a winding bank, one bridge, and an east gate. Walk the route. Move the bridge two tiles east, replay or record a new traversal, and compare entrance-to-gate time. A disconnected bridge should produce a visible failed route.
- **Loom loft, platformer.** Describe a run-up, a gap, and a one-way landing. Run and jump with a visible player hitbox. Record takeoff, apex, and landing ticks. Widen the gap until the recorded jump misses, shorten it to restore the landing, and repeat with the rendered tiles. A connected tile path alone cannot establish jump feasibility.

Use the first art pass to prove that artwork can change safely. Extend it to a real asset workflow in M6: generate sprite frames and an atlas, preview the packed sheet with frame bounds and pivots, then scrub or loop a named animation at its authored timing. Preview the actor in the scene at native scale. Repack the atlas and verify existing actors still resolve the same frames by ID.

## Milestone tracker

Check a box when the demonstration passes on a clean checkout. Link the implementing PR and its test, fixture, or playthrough in the same change. When splitting a milestone into issues, use its ID in the title and link the issues here. Engineering, interaction, and release choices belong in the [decision log](docs/decisions/README.md).

- [x] **M0 · Navigate and edit in one tab.** Threadvale loads from a versioned JSON file through a loopback Go service. Move the Courier, visit Loom Yard, then return to the same camera, selection, thumbnail, and undo history. The service hashes the project JSON at startup. Scene edits and world placement live in the tab. [Try it](README.md#try-your-first-edit) · [Contract and history tests](tests/model.test.mjs)
- [x] **M0 · Create a local project.** Create an empty project by name and folder in the browser or through the plugin’s MCP tool. Open the saved file and verify a second request for the same folder preserves the first project. [HTTP tests](internal/editor/workspace_test.go) · [MCP tests](internal/mcpserver/server_test.go) · [Plugin setup](docs/codex-plugin.md#create-a-project)
- [ ] **M1 · Save a reviewed change.** Blank scene creation uses a revision check and a serialized manifest write. Deliver the remaining contracts and actor-edit conflict tests below.
- [ ] **M2 · Build and trace a world.** The editor can create, rename, duplicate, color, move, and delete saved scenes. Named entrances and rectangular exits use stable destination IDs, and world arrows open their source triggers. **Pass:** connect a gate to another scene, select its map edge to reopen the exact trigger, rename the destination, then relink the exit after a diagnostic identifies the entrance it uses. [Scene operation tests](internal/project/scene_test.go) · [Connection tests](internal/project/connections_test.go)
- [ ] **M3 · Block out a level and inspect movement.** Start with M1 and the entrance/scene subset of M2. Generate geometry, play the two movement fixtures above in the browser, and inspect their collision layers. **Pass:** measure and revise a route and a jump before generating art, then save, replay, and open both scene exports in Tiled.
- [ ] **M4 · Author four scenes through Codex.** Start marketplace packaging and read-only inspection after M1. Release authoring after M3. **Pass:** install through both supported surfaces, generate a connected world, review it visually, and apply it without losing a browser draft. [Plugin delivery and skill plan](docs/codex-plugin.md)
- [ ] **M5 · Play the first gate on target.** Prototype the build backend after M2. Integrate M3 geometry, a player start, top-down movement, actor interaction, simple dialogue, and scene changes. Pin the compiler/runtime inputs and map build errors back to scene objects. **Pass:** walk the same route in editor preview and an emulator running the generated ROM. Check a wall, cross the bridge, talk to the Courier, enter the gate, and return at the named entrance. Compare a recorded loft jump with target playback and document any timing differences.
- [ ] **M6 · Replace blockouts with production assets.** Start the asset catalog after M1 and exercise a first tile replacement as soon as the M3 fixtures play. Use M5 to verify compiled output. **Pass:** finish the art, animation, interface, and sound workflows in the coverage table, then swap a shared asset and inspect every affected scene.
- [ ] **M7 · Author and debug behavior.** Extend M5 events with expressions, variables and scopes, conditions, choices, input, timers, reusable scripts with parameters, and actor/trigger prefabs with overrides. Track source IDs through compilation. **Pass:** a key unlocks a gate in two scenes through one script. Break at the condition, inspect its inputs, step both branches, and follow the running event back to the editor.
- [ ] **M8 · Ship and verify complete games.** After M5–M7. Cover the scene types, runtime limits, project settings, extensions, and exports below. Run the four-scene world through both authoring surfaces again. **Pass:** a fresh project can be built, debugged, exported, and played from start to finish using documented tools and original assets. Record the tested ROM, target, build report, and remaining workflow gaps.

## How to track parity

The comparison baseline is the published 4.3.2 release, reviewed 2026-11-26. Cartquilt's first target is the Game Boy Color creator workflow. Track wider device and export compatibility separately. File-format compatibility is a separate product decision.

| Workflow | Cartquilt today | Milestone and acceptance evidence |
| --- | --- | --- |
| World and scene authoring | Partial. Arrange existing scenes and move an existing actor in a tab. | M1–M3. Create scenes, place actors and triggers, save, reopen, and trace a transition to its source. |
| Collision and gameplay modes | Planned | M3, M5, M8. Compare authored collision with player and actor behavior on target. Exercise directional edges, ladders, and movement rules in the applicable scene types. |
| Visual assets and audio | Partial. Render supplied backgrounds and sprites. | M6. Complete the asset workflows below and verify their output in a running scene. |
| Event authoring and debugging | Planned | M5–M7. Map each event family to a fixture, including scene/actor/trigger lifecycles, input, movement, camera, dialogue, variables, math, timers, audio, persistence, and script calls. Record expected state and observe it in the debugger. |
| Playtest and export | Planned | M3 browser playtest, M5 target runtime, M8 export. Launch at a selected scene without moving the saved player start. Export and replay the ROM and web build, including touch controls. |
| Project reuse and extensions | Planned | M7–M8. Exercise prefab overrides, script parameters, template migration, and an original custom event end to end. |
| Additional device and export profiles | Scope open | M8 decision. Assess monochrome fallback, border-equipped hardware, and device-specific export independently. Record supported, deferred, or excluded with rationale and a device fixture for each supported profile. |

Use **verified** only when a linked test or playthrough demonstrates the named outcome. Before closing M6–M8, expand the relevant families into individual subworkflows, record omissions and target-specific exceptions, and rerun the fixtures against the pinned baseline. An aggregate parity percentage would be premature while that inventory is incomplete.

Track generated visual blockouts, the repo-backed Codex marketplace, and revision-aware agent proposals as Cartquilt-specific milestones. They have their own acceptance tests. Collision painting and collision visibility are part of the core editor comparison.

## M1 implementation order

1. Extract service-side project validation and the actor-move operation from HTTP handling. Define a versioned operation envelope with project ID, base revision, stable target IDs, and edits. Run valid, invalid, and out-of-bounds examples through both the Go authority and TypeScript draft model.
2. Add a proposal path that returns the affected objects, candidate document, and diagnostics. Test that preview and discard leave the saved bytes and revision untouched.
3. Add explicit apply/save with a revision check against current disk state, serialized writes, atomic replacement, and retry handling. Test two writers from one base, an external file edit, a duplicate request, and a failed write. Keep the last valid project readable. Define revision coverage for referenced assets before M6 allows asset writes.
4. Wire **Save** to the scene document. Advance its baseline only after success. Show the affected objects on conflict and let the creator keep, compare, and reapply the draft. Include world card placement in deliberate saves while keeping pan, zoom, and selection local. Verify old Threadvale projects still open when the schema evolves.

**Exit test:** tab A saves X = 81 and a fresh service reads 81. Tab B, still based on X = 73, attempts a different move. Its draft survives the conflict and A’s saved move survives on disk. Repeat with a proposal acting as the second writer.

## M3 blockout and collision workflow

The first authoring slice saves terrain paint and erasure, marker and guide placement, and movement profiles. The editor's tile selection and the MCP preview/apply workflow share the same saved scene layer. Keep M3 open until traversal, collision inspection, and Tiled export pass both fixtures.

Use “a riverbank with a single bridge, a gate to the east, and room for the Courier” as the fixture. Turn the description into proposed grid dimensions, terrain regions, landmarks, actor footprints, walkable routes, and named entrances. Render a labeled top-down plan with a legend and tile coordinates. Let the creator widen the bridge, move the gate, and regenerate a selected region while preserving edits elsewhere. Replacing placeholder art must preserve trigger IDs, entrances, and collision.

Provide a **Collision** layer with paint, erase, undo, and visibility controls. Start with passable and solid cells plus collidable object footprints. Show blockers with translucent red hatching, outlined footprints, and a text legend. Selecting a blocked cell identifies the terrain or object responsible. Preview movement uses the same occupancy rules as validation. Hiding the overlay changes visibility only. Test a reachable entrance, a blocked bridge, and a moved object that reopens a route. See [the scene-layer decision](docs/decisions/README.md#d03--editable-blockouts-and-collision).

### Scene layers

| Layer or view | What the creator edits |
| --- | --- |
| Blockout | The base layout. Draw walkable ground, walls, gaps, and platforms using placeholder shapes. A one-way platform is an editable blockout element with its own collision behavior. |
| Background, terrain art, and foreground | Add scenery behind the play area, bind artwork to terrain and platforms, and place details in front of the play area. |
| Objects and connections | Place props, actors, entrances, and exit triggers. Give collidable objects a footprint. |
| Collision | Inspect effective collision from the layout and object footprints, then paint explicit overrides. |

Start in M3 with the blockout, object and connection editing, and collision inspection. Exercise visual layers in the first M6 art pass. Verify that moving the loft platform moves its collision footprint and attached artwork. Toggle or replace its artwork and replay the same jump. Confirm identical collision contacts and landing tick.

## Tiled compatibility

- [ ] **Export with the first playable blockout (M3).** Export each fixture as a finite orthogonal Tiled JSON map (`.tmj`), with relative references to JSON tilesets (`.tsj`) and PNGs for tile layers, including placeholders where needed. Open both exports in Tiled and verify the grid, editable blockout geometry, named entrances, exits, and collision overrides. Compare the exported coordinates and object identities with the saved scenes.
- [ ] **Import after export, gated on both fixtures.** Prototype reimport of Cartquilt exports as a reviewed edit against the exported scene revision. Reimport each untouched fixture and verify equivalent geometry, collision, references, and replay. Repaint the river crossing in Tiled and verify the replay reaches the same destination on the same tick. Move the loft's one-way platform one tile and verify its collision footprint moves with it and the jump replay reflects the edit. Check that entrance IDs and actor asset bindings resolve in all cases. Show unsupported content and revision conflicts before applying a change. Release import after these checks pass.

Scope the first import to Cartquilt's documented export subset. Evaluate a real Scene Forge export before expanding support to maps authored elsewhere. Consider a whole-world `.world` export once scene interchange works. See [the Tiled decision](docs/decisions/README.md#d06--tiled-scene-interchange).

## Workflow coverage for the later milestones

| Area | Completion evidence |
| --- | --- |
| Scene composition and navigation · M2–M6 | Paint a tile layer over a background, place actors and triggers, set draw order, scroll a larger scene with camera bounds and parallax, and reach a destination from its source trigger. |
| Visual assets · M6 | Import and edit backgrounds, tilesets, palettes and sprites. Assemble frames into directional animation states, change timing, preview in context, and return to the same actor from its asset. Update a font, portrait, dialogue frame and menu cursor in a running scene. |
| Audio · M6 | Compose or edit a looping multi-channel song, create a sound effect, audition both, trigger them from events, and compare playback in an exported build. |
| Tiles and palettes · M6 | Import a background and reusable tileset, edit a tile and its palette, paint it into two scenes, and inspect the revisions and budget impact in both. |
| Sprites and UI · M6 | Arrange sprite frames into facing directions and animation states. Slow the Courier’s walk, preview the timing on the bridge, and return to the same actor. Assign a font, dialogue frame, and menu cursor, then check them in a running scene. |
| Music and sound · M6 | Compose a short looping pattern, edit its instruments, cue the track on scene entry, and trigger a sound effect on interaction. Audition both together and verify timing and channel use on target. |
| Events and debugging · M5–M7 | Edit, group, copy, and reuse events for scenes, actors and triggers. Inspect live variables, call stacks, breakpoints and graphics memory. Save game progress, restart the ROM, and resume at the expected state. |
| Movement and scene types · M8 | Supply small playable fixtures for grid movement, free movement, platforming, cursor interaction, scrolling shooter, and title screens. Exercise input, collisions, camera behavior, and a transition for each. |
| Hardware constraints and export · M5–M8 | Report tile, palette, sprite, ROM-bank, and frame-time budgets against the chosen target where the creator edits them. Deliberately exceed a limit, follow the error to its asset, fix it, and export a ROM and web-playable build. Smoke-test on physical color hardware. |
| Project lifecycle and extensions · M8 | Create from a template, migrate an older saved project, configure controls and build settings, register a custom event or scene behavior, and reproduce the build on a second machine. Record additional hardware profiles as separate targets with their own tests. |
