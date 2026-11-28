import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decode, SceneDocument, Workspace } from "../.local/test-js/model.js";
import { sceneMetrics } from "../.local/test-js/scene-metrics.js";

const temp = mkdtempSync(join(tmpdir(), "cartquilt-contract-"));
let response;
try {
  const output = join(temp, "response.json");
  execFileSync("go", ["test", "-count=1", "-run", "^TestSnapshotResponse$", "./internal/editor"], {
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
  w.openScene("willow-bank");
  Object.assign(w.viewportCamera, { x: 31, y: -20, zoom: 2 });
  w.objects.set(w.selected, "courier");
  willow.apply({ type: "moveActor", actor: "courier", axis: "x", value: 81 });
  w.desk = "world";
  w.selected = "loom-yard";
  assert.equal(w.active.dirty, false);
  w.openScene("willow-bank");
  assert.deepEqual(w.viewportCamera, { x: 0, y: 0, zoom: 1 });
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

test("new blank scenes advance the saved revision and preserve the existing draft", () => {
  const snapshot = decode(response);
  const workspace = new Workspace(snapshot);
  const willow = workspace.active;
  willow.apply({ type: "moveActor", actor: "courier", axis: "x", value: 81 });
  workspace.positionFor("willow-bank").x += 8;
  const added = structuredClone(response);
  added.revision = "1".repeat(64);
  added.project.scenes.push({
    id: "dye-garden",
    name: "Dye Garden",
    art: "",
    width: 20,
    height: 18,
    world: { x: 640, y: 0 },
    actors: [],
  });
  workspace.acceptSceneAdditions(decode(added));
  assert.equal(workspace.snapshot.revision, added.revision);
  assert.equal(workspace.active, willow);
  assert.equal(willow.dirty, true);
  assert.equal(workspace.layoutDirty, true);
  assert.equal(workspace.documentFor("dye-garden").scene.art, "");
  added.project.scenes[0].name = "Changed on disk";
  assert.throws(
    () => workspace.acceptSceneAdditions(decode(added)),
    /Existing project data changed/,
  );
  assert.equal(workspace.active, willow);
});

test("sprite tile estimates count shared assets once and hardware sprites per placement", () => {
  const scene = decode(response).project.scenes[0];
  const courier = scene.actors[0];
  scene.actors = Array.from({ length: 6 }, (_, index) => ({
    ...courier,
    id: `actor-${index}`,
  }));
  const metrics = sceneMetrics(scene);
  assert.equal(metrics.actors, 6);
  assert.equal(metrics.spriteTiles, 4);
  assert.deepEqual(metrics.gbc, { hardwareSprites: 24, peakScanline: 12, overBudget: true });
  assert.equal(sceneMetrics({ ...scene, width: 21 }).gbc, undefined);
});

test("scene metadata updates preserve actor undo and redo history", () => {
  const workspace = new Workspace(decode(response));
  const willow = workspace.active;
  willow.apply({ type: "moveActor", actor: "courier", axis: "x", value: 81 });
  const renamed = structuredClone(response);
  renamed.revision = "a".repeat(64);
  renamed.project.scenes[0].name = "Reed Bank";
  workspace.acceptSceneAction(decode(renamed), "willow-bank", "rename");
  assert.equal(workspace.active, willow);
  assert.equal(willow.scene.actors[0].x, 81);
  willow.undo();
  assert.equal(willow.scene.name, "Reed Bank");
  assert.equal(willow.dirty, false);

  renamed.project.scenes[0].color = "#a1b2c3";
  workspace.acceptSceneAction(decode(renamed), "willow-bank", "color");
  willow.redo();
  assert.equal(willow.scene.color, "#a1b2c3");
  assert.equal(willow.scene.actors[0].x, 81);

  workspace.desk = "scene";
  renamed.project.scenes.shift();
  workspace.acceptSceneAction(decode(renamed), "willow-bank", "delete");
  assert.equal(workspace.desk, "world");
  assert.equal(workspace.selected, "loom-yard");
  assert.equal(workspace.documents.has("willow-bank"), false);
});

test("accepting a position save keeps any newer drag and the actor draft", () => {
  const workspace = new Workspace(decode(response));
  workspace.active.apply({ type: "moveActor", actor: "courier", axis: "x", value: 81 });
  const next = structuredClone(response);
  next.revision = "b".repeat(64);
  next.project.scenes[0].world = { x: 16, y: -8 };
  workspace.positions.set("willow-bank", { x: 24, y: -8 });
  workspace.acceptSceneAction(decode(next), "willow-bank", "position");
  assert.equal(workspace.layoutDirty, true);
  assert.equal(workspace.positionFor("willow-bank").x, 24);
  assert.equal(workspace.active.scene.actors[0].x, 81);
  next.project.scenes[0].world.x = 24;
  workspace.acceptSceneAction(decode(next), "willow-bank", "position");
  assert.equal(workspace.layoutDirty, false);
  workspace.active.undo();
  assert.equal(workspace.active.dirty, false);
  assert.deepEqual(workspace.active.scene.world, { x: 24, y: -8 });
});

test("legacy scenes decode with empty connections and linked exits resolve by stable IDs", () => {
  const old = decode(response);
  assert.deepEqual(old.project.scenes[0].entrances, []);
  assert.deepEqual(old.project.scenes[0].exits, []);
  const linked = structuredClone(response);
  linked.project.scenes[1].entrances = [{ id: "west-gate", name: "West gate", x: 0, y: 2 }];
  linked.project.scenes[0].exits = [
    {
      id: "east-gate",
      name: "East gate",
      x: 19,
      y: 2,
      width: 1,
      height: 2,
      destination: { sceneId: "loom-yard", entranceId: "west-gate" },
    },
  ];
  const snapshot = decode(linked);
  assert.equal(sceneMetrics(snapshot.project.scenes[0]).triggers, 1);
  linked.project.scenes[1].entrances = [];
  assert.throws(() => decode(linked), /Invalid destination/);
});

test("scene and actor bounds match the saved project contract", () => {
  const fixture = structuredClone(response);
  const scene = fixture.project.scenes[0];
  scene.width = 1024;
  const actor = scene.actors[0];
  actor.x = 1024 * 8 - actor.width;
  const decoded = decode(fixture);
  assert.equal(decoded.project.scenes[0].actors[0].x, actor.x);
  actor.x++;
  assert.throws(() => decode(fixture), /Invalid coordinate or dimension/);
  actor.x--;
  scene.width++;
  assert.throws(() => decode(fixture), /Invalid coordinate or dimension/);
});

test("a saved entrance survives undo and redo of an actor draft", () => {
  const workspace = new Workspace(decode(response));
  const doc = workspace.active;
  const originalX = doc.scene.actors[0].x;
  doc.apply({ type: "moveActor", actor: "courier", axis: "x", value: originalX + 1 });

  const updated = structuredClone(response);
  const entrance = { id: "west-gate", name: "West gate", x: 2, y: 3 };
  updated.project.scenes[0].entrances = [entrance];
  workspace.acceptSceneAction(decode(updated), doc.scene.id, "connection");
  assert.equal(doc.dirty, true);
  doc.undo();
  assert.equal(doc.dirty, false);
  assert.deepEqual(doc.scene.entrances, [entrance]);
  doc.redo();
  assert.equal(doc.scene.actors[0].x, originalX + 1);
  assert.deepEqual(doc.scene.entrances, [entrance]);
});

test("blockout rejects invalid terrain and preserves independent actor history", () => {
  const workspace = new Workspace(decode(response));
  const document = workspace.active;
  assert.deepEqual(document.scene.blockout, { profile: "top-down", terrain: [], elements: [] });
  const originalX = document.scene.actors[0].x;
  document.apply({ type: "moveActor", actor: "courier", axis: "x", value: originalX + 1 });

  const fixture = structuredClone(response);
  const terrain = { kind: "blocked", x: 2, y: 2, width: 3, height: 2 };
  const blockout = { profile: "platformer", terrain: [terrain] };
  fixture.project.scenes[0].blockout = blockout;
  workspace.acceptSceneAction(decode(fixture), document.scene.id, "blockout");
  document.undo();
  assert.deepEqual(document.scene.blockout.terrain, [terrain]);
  assert.equal(document.scene.actors[0].x, originalX);

  blockout.terrain.push({ ...terrain, kind: "water" });
  assert.throws(() => decode(fixture), /Overlapping blockout terrain/);
});

test("actor drafts and saved blockout edits use the same scene history", async () => {
  const doc = new SceneDocument(decode(response).project.scenes[0]);
  const actorX = doc.scene.actors[0].x;
  const original = doc.baseline.blockout;
  const marked = { ...original, profile: "platformer" };
  const save = async (blockout) => {
    doc.acceptSceneMetadata({ ...doc.baseline, blockout });
  };

  doc.apply({ type: "moveActor", actor: "courier", axis: "x", value: actorX + 1 });
  const finish = doc.beginBlockoutEdit();
  await save(marked);
  finish(original);
  assert.equal(doc.hasBlockoutHistory("undo"), true);
  await assert.rejects(
    doc.restoreBlockoutHistory("undo", async () => {
      throw Error("stale revision");
    }),
    /stale revision/,
  );
  assert.equal(doc.hasBlockoutHistory("undo"), true);
  assert.equal(doc.canRedo, false);

  await doc.restoreBlockoutHistory("undo", save);
  assert.equal(doc.scene.blockout.profile, "top-down");
  assert.equal(doc.scene.actors[0].x, actorX + 1);
  doc.undo();
  assert.equal(doc.scene.actors[0].x, actorX);
  doc.redo();
  await doc.restoreBlockoutHistory("redo", save);
  assert.equal(doc.scene.blockout.profile, "platformer");
  assert.equal(doc.scene.actors[0].x, actorX + 1);

  await doc.restoreBlockoutHistory("undo", save);
  doc.apply({ type: "moveActor", actor: "courier", axis: "x", value: actorX + 2 });
  assert.equal(doc.canRedo, false);
});

test("a later actor edit stays ahead of a pending blockout save in undo history", async () => {
  const doc = new SceneDocument(decode(response).project.scenes[0]);
  const actorX = doc.scene.actors[0].x;
  const original = doc.baseline.blockout;
  const finish = doc.beginBlockoutEdit();
  doc.apply({ type: "moveActor", actor: "courier", axis: "x", value: actorX + 1 });
  const save = async (blockout) => doc.acceptSceneMetadata({ ...doc.baseline, blockout });
  await save({ ...original, profile: "platformer" });
  finish(original);

  doc.undo();
  assert.equal(doc.scene.actors[0].x, actorX);
  assert.equal(doc.scene.blockout.profile, "platformer");
  await doc.restoreBlockoutHistory("undo", save);
  assert.equal(doc.scene.blockout.profile, "top-down");

  doc.beginBlockoutEdit()(original);
  doc.beginBlockoutEdit()();
  assert.equal(doc.canUndo, false);
  assert.equal(doc.canRedo, true);
});

test("the 51st blockout edit trims the oldest blockout step and preserves actor undo", async () => {
  const doc = new SceneDocument(decode(response).project.scenes[0]);
  const save = async (blockout) => doc.acceptSceneMetadata({ ...doc.baseline, blockout });
  const actorX = doc.scene.actors[0].x;
  doc.apply({ type: "moveActor", actor: "courier", axis: "x", value: actorX + 1 });

  const committedEdits = 51;
  for (let x = 0; x < committedEdits; x++) {
    const finish = doc.beginBlockoutEdit();
    const previous = doc.baseline.blockout;
    const marker = {
      kind: "player-spawn",
      id: "spawn",
      x: x % doc.scene.width,
      y: 0,
      width: 1,
      height: 1,
    };
    await save({ ...previous, elements: [marker] });
    finish(previous);
  }

  let undone = 0;
  while (doc.hasBlockoutHistory("undo")) {
    await doc.restoreBlockoutHistory("undo", save);
    undone++;
  }
  assert.equal(undone, 50);
  assert.equal(doc.scene.blockout.elements[0].x, 0);
  assert.equal(doc.scene.actors[0].x, actorX + 1);
  assert.equal(doc.canUndo, true);
  doc.undo();
  assert.equal(doc.scene.actors[0].x, actorX);
  assert.equal(doc.dirty, false);
  assert.equal(doc.canUndo, false);

  doc.redo();
  assert.equal(doc.scene.actors[0].x, actorX + 1);
  while (doc.hasBlockoutHistory("redo")) {
    await doc.restoreBlockoutHistory("redo", save);
  }
  assert.equal(doc.scene.blockout.elements[0].x, (committedEdits - 1) % doc.scene.width);
  assert.equal(doc.canRedo, false);
});
