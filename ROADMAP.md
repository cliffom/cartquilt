# Cartquilt roadmap

**Next deliverable:** save one Courier move, reopen the project, and prove that a second editor cannot overwrite it with an older revision. That same save path will eventually accept a reviewed four-scene proposal from Codex.

**Destination:** a creator can start with an empty project, sketch a world, connect and script its scenes, replace the sketch with finished assets, debug it, and ship a playable Game Boy Color game. Measure progress by workflows completed in original example projects. Keep the browser useful on its own and the Codex plugin useful in a local chat.

## Milestone tracker

Check a box when the demonstration passes on a clean checkout. Link the implementing PR and its test, fixture, or playthrough in the same change. When splitting a milestone into issues, use its ID in the title and link the issues here. Engineering, interaction, and release choices belong in the [decision log](docs/decisions/README.md).

- [x] **M0 · Navigate and edit in one tab.** Threadvale loads from a versioned JSON file through a loopback Go service. Move the Courier, visit Loom Yard, then return to the same camera, selection, thumbnail, and undo history. The service hashes the project JSON at startup. Scene edits and world placement live in the tab. [Try it](README.md#try-your-first-edit) · [Contract and history tests](tests/model.test.mjs)
- [ ] **M1 · Save a reviewed change.** Start here. Deliver the contracts and conflict tests below.
- [ ] **M2 · Build and trace a world.** After M1. Create, rename, duplicate, arrange, and remove scenes. Add named entrances, rectangular exit triggers, and destinations with stable IDs. Derive map connections from their source events. **Pass:** connect a gate to another scene, select its map edge to reopen the exact trigger, rename the destination, then repair a deleted entrance using a diagnostic.
- [ ] **M3 · Block out a level and inspect movement.** After M2. Add editable terrain, object footprints, collision, and the visual blockout generator described below. **Pass:** review and revise a river crossing, verify the walkable route, save it, and reopen its layers.
- [ ] **M4 · Author four scenes through Codex.** Start marketplace packaging and read-only inspection after M1. Release authoring after M3. **Pass:** install through both supported surfaces, generate a connected world, review it visually, and apply it without losing a browser draft. [Plugin delivery and skill plan](docs/codex-plugin.md)
- [ ] **M5 · Play the first gate on target.** Prototype the build backend after M2. Integrate M3 geometry, a player start, top-down movement, actor interaction, simple dialogue, and scene changes. Pin the compiler/runtime inputs and map build errors back to scene objects. **Pass:** walk the same route in editor preview and an emulator running the generated ROM. Check a wall, cross the bridge, talk to the Courier, enter the gate, and return at the named entrance.
- [ ] **M6 · Replace blockouts with production assets.** Start the asset catalog after M1 and tile composition after M3. Use M5 to verify compiled output. **Pass:** finish the art, animation, interface, and sound workflows in the coverage table, then swap a shared asset and inspect every affected scene.
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
| Playtest and export | Planned | M5, M8. Launch at a selected scene without moving the saved player start. Export and replay the ROM and web build, including touch controls. |
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

Use “a riverbank with a single bridge, a gate to the east, and room for the Courier” as the fixture. Turn the description into proposed grid dimensions, terrain regions, landmarks, actor footprints, walkable routes, and named entrances. Render a labeled top-down plan with a legend and tile coordinates. Let the creator widen the bridge, move the gate, and regenerate a selected region while preserving edits elsewhere. Replacing placeholder art must preserve trigger IDs, entrances, and collision.

Provide a **Collision** layer with paint, erase, undo, and visibility controls. Start with passable and solid cells plus collidable object footprints. Show blockers with translucent red hatching, outlined footprints, and a text legend. Selecting a blocked cell identifies the terrain or object responsible. Preview movement uses the same occupancy rules as validation. Hiding the overlay changes visibility only. Test a reachable entrance, a blocked bridge, and a moved object that reopens a route. See [the scene-layer decision](docs/decisions/README.md#d03--editable-blockouts-and-collision).

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
