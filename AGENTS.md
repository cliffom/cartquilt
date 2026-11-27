# Working on Cartquilt

- Keep Go service code and its tests in `cmd/cartquilt/`. Run the service from the repository root so relative project and web asset paths resolve consistently.
- Keep the Go service on loopback. It owns saved data and revision identity. Load examples through the ordinary project loader.
- Keep scene baselines, working copies, operation validation, and undo/redo in SceneDocument. Keep navigation, object selection, card layout, and camera in Workspace. Browser views dispatch operations. Future plugin edits must use the same semantics.
- Change the Go contract, TypeScript decoder, and contract tests together. Use stable IDs and validate before attaching a project to the UI.
- Use shared CSS tokens and nearest-neighbor artwork. Preserve keyboard equivalents, visible focus, field-level feedback, and text draft indicators. Keep branding outside scene artwork.
- Use original examples and project terminology. Run `npm run format` after editing Go or TypeScript, then `npm run check` before handing off a change. Exercise desk navigation in a browser when changing interaction or layout.
