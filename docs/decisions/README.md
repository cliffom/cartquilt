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

### D04 · Repo-backed plugin delivery

**Accepted direction · Distribution · 2026-11-26 · M4.** Publish the marketplace catalog, plugin package, bundled skills, and MCP contract from this repository so the editor and plugin can be tested against the same revision. A separate marketplace repository would require coordinating two releases for this single plugin. Keep plugin version, service protocol version, and project schema version identifiable independently. Clean-install and upgrade tests on both surfaces are the release evidence. [Delivery plan](../codex-plugin.md)

### Decisions due before dependent work

| Before | Decide | Evidence needed |
| --- | --- | --- |
| M1 writes | Snapshot/asset revision scope, migration policy, atomic write boundary | Reload v1, simulate an interrupted save and two writers, inspect the recovered project. |
| M3 generation | Blockout vocabulary, region replacement rules, collision precedence | A creator revises one generated area without disturbing a neighboring authored area. |
| M4 release | Local runtime discovery, supported hosts, binary packaging and update policy | Install into a fresh profile without a source checkout and diagnose a missing or incompatible runtime. |
| M5 runtime | Compiler/backend, runtime license, build inputs, emulator integration | Build a minimal original two-room ROM, compare collision and transitions, measure output size and frame time. |
| M8 scope | Additional target profiles and extension API stability | Run a representative game per proposed profile and upgrade one original extension. |
