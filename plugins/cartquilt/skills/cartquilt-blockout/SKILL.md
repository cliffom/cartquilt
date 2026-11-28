---
name: cartquilt-blockout
description: Plan, preview, and save editable Cartquilt blockouts for top-down and platformer scenes. Use for walkable routes, walls, platforms, hazards, spawn and exit markers, camera guides, or focused tile revisions.
---

Use the Cartquilt plugin's MCP tools for blockout edits. Ask for the project path and target scene when the user has not identified them. Call `open_project` to read the saved revision, dimensions, and scene IDs. Use `create_scene` with that revision when the user requests a new scene.

Translate the brief into tile rectangles and named points that preserve the scene's intended traversal. Arrange a top-down route around blockers and a platformer route around landing surfaces, gaps, and climb regions. Mark a precise spawn, key transitions, and framing where they serve the design. A stage exit marker is a plan annotation. Linked scene exits remain separate scene connections.

Pass the chosen path, `sceneId`, `baseRevision`, and ordered `edits` to `preview_blockout`. Review the proposed terrain and element extents against the brief, then report the affected area and any unverified traversal assumptions. Use `apply_blockout` with the same edits and revision when the user asks to save. If the revision is stale, inspect the latest scene and rebase the proposal before retrying. Use IDs returned by the committed snapshot for later updates.

- `paint` replaces terrain within an `area` of zero-based tile coordinates `{x, y, width, height}`. Kinds are `walkable`, `blocked`, `one-way`, `water`, `pit`, `hazard`, and `climb`.
- `erase` clears terrain inside an area. Unpainted tiles remain unspecified.
- `place` creates a named or unlabeled element. Supply its saved `id` to update it. Placing another player spawn moves the existing spawn. Omit `label` to keep an existing name, or send an empty string to clear it. Player spawn, checkpoint, stage exit, enemy, boss entrance, reward, discoverable, and note use one tile. Patrol, flying approach, detour, boss arena, section, and camera accept rectangles. Use the tool's kind identifiers.
- `remove` removes a single element by ID. `erase-elements` removes whole elements intersecting an area. Use `profile` with `top-down` or `platformer` to change the movement profile.

The preview describes authored geometry. Traversal timing, collision simulation, and playable builds are separate milestones.
