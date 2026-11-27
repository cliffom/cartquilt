import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decode, SceneDocument, Workspace } from "../web/public/js/model.js";

const temp = mkdtempSync(join(tmpdir(), "cartquilt-contract-"));
let response;
try {
  const output = join(temp, "response.json");
  execFileSync("go", ["test", "-count=1", "-run", "^TestSnapshotResponse$", "./cmd/cartquilt"], {
    env: { ...process.env, CARTQUILT_CONTRACT_OUTPUT: output },
  });
  response = JSON.parse(readFileSync(output, "utf8"));
} finally {
  rmSync(temp, { recursive: true, force: true });
}

test("service snapshot decodes with stable scene and actor IDs", () => {
  const snapshot = decode(response);
  assert.deepEqual(
    snapshot.project.scenes.map((s) => s.id),
    ["willow-bank", "loom-yard"],
  );
  assert.equal(snapshot.project.scenes[0].actors[0].id, "courier");
});
test("reject malformed and ambiguous responses before attaching views", () => {
  for (const mutate of [
    (v) => v.project.scenes.push(v.project.scenes[0]),
    (v) => (v.project.scenes[0].actors[0].x = 149),
    (v) => (v.project.scenes[0].world = null),
    (v) => (v.project.scenes[0].art = "../other.png"),
    (v) => (v.project.version = 2),
    (v) => delete v.revision,
  ]) {
    const bad = structuredClone(response);
    mutate(bad);
    assert.throws(() => decode(bad));
  }
});
test("coordinate edits group during typing, undo to baseline and branch after redo", () => {
  const scene = decode(response).project.scenes[0],
    doc = new SceneDocument(scene);
  const move = (value, group) =>
    doc.apply({ type: "moveActor", actor: "courier", axis: "x", value }, group);
  const group = Symbol(),
    initial = scene.actors[0].x;
  move(8, group);
  move(initial + 8, group);
  assert.equal(doc.dirty, true);
  assert.equal(scene.actors[0].x, initial);
  assert.throws(() => move(999));
  assert.equal(doc.scene.actors[0].x, initial + 8);
  doc.undo();
  assert.equal(doc.dirty, false);
  assert.equal(doc.canUndo, false);
  doc.redo();
  assert.equal(doc.scene.actors[0].x, initial + 8);
  doc.undo();
  move(initial + 1);
  assert.equal(doc.canRedo, false);
  move(initial);
  assert.equal(doc.dirty, false);
});
test("changing desk and scene preserves selection, placement, camera and history", () => {
  const w = new Workspace(decode(response));
  w.camera.x += 23;
  assert.equal(w.layoutDirty, false);
  w.positions.get("willow-bank").x += 8;
  assert.equal(w.layoutDirty, true);
  const willow = w.active;
  w.desk = "scene";
  w.objects.set(w.selected, "courier");
  willow.apply({ type: "moveActor", actor: "courier", axis: "x", value: 81 });
  w.desk = "world";
  w.selected = "loom-yard";
  assert.equal(w.active.dirty, false);
  w.selected = "willow-bank";
  assert.equal(w.objects.get(w.selected), "courier");
  assert.equal(w.active.scene.actors[0].x, 81);
  w.active.undo();
  assert.equal(w.active.dirty, false);
  assert.equal(w.camera.x, 23);
  assert.equal(w.positions.get(w.selected).x, 8);
});
test("an empty saved project opens on the world desk", () => {
  const empty = structuredClone(response);
  empty.project.scenes = [];
  const workspace = new Workspace(decode(empty));
  assert.equal(workspace.desk, "world");
  assert.equal(workspace.selected, undefined);
  assert.equal(workspace.documents.size, 0);
  assert.equal(workspace.layoutDirty, false);
});
