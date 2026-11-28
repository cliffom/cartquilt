package project

import (
	"errors"
	"path/filepath"
	"slices"
	"testing"
)

func TestBlockoutPreviewPaintAndErase(t *testing.T) {
	saved, err := Create(CreateInput{Name: "Weaver's loft", Path: filepath.Join(t.TempDir(), "loft")})
	if err != nil {
		t.Fatal(err)
	}
	scene, err := AddScene(saved.Path, AddSceneInput{BaseRevision: saved.Revision, Name: "Loft", Width: 6, Height: 5})
	if err != nil {
		t.Fatal(err)
	}
	cameraLabel := "Loft entry"
	batch := []BlockoutEdit{
		{Op: "profile", Profile: "platformer"},
		{Op: "paint", Kind: "walkable", Area: &TileArea{Point{0, 0}, 6, 5}},
		{Op: "paint", Kind: "blocked", Area: &TileArea{Point{1, 1}, 3, 2}},
		{Op: "erase", Area: &TileArea{Point{2, 1}, 1, 1}},
		{Op: "place", Kind: "player-spawn", Area: &TileArea{Point{2, 1}, 1, 1}},
		{Op: "place", Kind: "camera", Label: &cameraLabel, Area: &TileArea{Point{0, 0}, 4, 3}},
	}
	preview, err := PreviewBlockout(saved.Path, scene.SceneID, scene.Revision, batch)
	if err != nil {
		t.Fatal(err)
	}
	ground := func(layer Blockout, x, y int) string {
		for _, region := range layer.Terrain {
			if region.overlaps(TileArea{Point{x, y}, 1, 1}) {
				return region.Kind
			}
		}
		return ""
	}
	if preview.Blockout.Profile != "platformer" || ground(preview.Blockout, 0, 0) != "walkable" ||
		ground(preview.Blockout, 3, 2) != "blocked" || ground(preview.Blockout, 2, 1) != "" {
		t.Fatalf("unexpected preview: %+v", preview)
	}
	before, err := Load(saved.Path)
	if err != nil || before.Revision != scene.Revision || before.Project.Scenes[0].Blockout != nil {
		t.Fatalf("preview changed the saved scene: %+v, %v", before, err)
	}
	committed, err := ApplySceneAction(saved.Path, scene.SceneID, SceneActionInput{BaseRevision: scene.Revision, Action: "blockout", Blockout: batch})
	if err != nil {
		t.Fatal(err)
	}
	reopened, err := Load(saved.Path)
	if err != nil {
		t.Fatal(err)
	}
	layer := reopened.Project.Scenes[0].Blockout
	if layer == nil || ground(*layer, 3, 2) != "blocked" || len(layer.Elements) != 2 || layer.Elements[1].Label != "Loft entry" {
		t.Fatalf("unexpected saved layer: %+v", layer)
	}
	invalid := []BlockoutEdit{
		{Op: "erase-elements", Area: &TileArea{Point{0, 0}, 6, 5}},
		{Op: "paint", Kind: "blocked", Area: &TileArea{Point{5, 4}, 2, 1}},
	}
	if _, err := ApplySceneAction(saved.Path, scene.SceneID, SceneActionInput{BaseRevision: committed.Revision, Action: "blockout", Blockout: invalid}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("invalid batch: %v", err)
	}
	after, err := Load(saved.Path)
	if err != nil || after.Revision != committed.Revision {
		t.Fatalf("invalid batch changed the committed revision: %v", err)
	}
	if _, err := PreviewBlockout(saved.Path, scene.SceneID, scene.Revision, batch); !errors.Is(err, ErrStaleRevision) {
		t.Fatalf("stale preview: %v", err)
	}
	restore := RestoreBlockoutInput{BaseRevision: scene.Revision, Blockout: &Blockout{Profile: DefaultMovementProfile}}
	if _, err := RestoreBlockout(saved.Path, scene.SceneID, restore); !errors.Is(err, ErrStaleRevision) {
		t.Fatalf("stale restore: %v", err)
	}
	restore.BaseRevision = after.Revision
	undone, err := RestoreBlockout(saved.Path, scene.SceneID, restore)
	if err != nil || len(undone.Project.Scenes[0].Blockout.Terrain) != 0 {
		t.Fatalf("undo saved blockout: %+v, %v", undone, err)
	}
	redone, err := RestoreBlockout(saved.Path, scene.SceneID, RestoreBlockoutInput{BaseRevision: undone.Revision, Blockout: layer})
	if err != nil || redone.Project.Scenes[0].Blockout.Elements[0].ID != layer.Elements[0].ID {
		t.Fatalf("redo saved blockout: %+v, %v", redone, err)
	}
}

func TestBlockoutElementsCanBeUpdatedAndRemoved(t *testing.T) {
	area := TileArea{Point{1, 1}, 1, 1}
	scene := Scene{Width: 5, Height: 4}
	kinds := []string{"enemy", "patrol", "flying-approach", "reward", "discoverable", "detour", "player-spawn", "checkpoint", "boss-entrance", "boss-arena", "stage-exit", "section", "note", "camera"}
	var batch []BlockoutEdit
	spawnLabel := "Courier start"
	for _, kind := range kinds {
		edit := BlockoutEdit{Op: "place", Kind: kind, Area: &area}
		if kind == "player-spawn" {
			edit.Label = &spawnLabel
		}
		batch = append(batch, edit)
	}
	layer, err := changedBlockout(scene, batch)
	if err != nil || len(layer.Elements) != len(kinds) {
		t.Fatalf("catalog placement: %+v, %v", layer, err)
	}
	scene.Blockout = &layer
	note := layer.Elements[len(layer.Elements)-2]
	camera := layer.Elements[len(layer.Elements)-1]
	noteLabel := "Camera reveal"
	updated, err := changedBlockout(scene, []BlockoutEdit{
		{Op: "place", Kind: "note", ID: note.ID, Label: &noteLabel, Area: &TileArea{Point{2, 1}, 1, 1}},
		{Op: "remove", ID: camera.ID},
		{Op: "place", Kind: "player-spawn", Area: &TileArea{Point{3, 1}, 1, 1}},
	})
	if err != nil || len(updated.Elements) != len(kinds)-1 {
		t.Fatalf("update and removal: %+v, %v", updated, err)
	}
	last := updated.Elements[len(updated.Elements)-1]
	if last.ID != note.ID || last.X != 2 || last.Label != "Camera reveal" || note.Label != "" {
		t.Fatalf("unexpected updated note: %+v", last)
	}
	for i, element := range layer.Elements {
		if element.Kind == "player-spawn" && (updated.Elements[i].ID != element.ID ||
			updated.Elements[i].X != 3 || updated.Elements[i].Label != spawnLabel) {
			t.Fatalf("spawn did not retain its ID and label when moved: %+v", updated.Elements[i])
		}
	}
	clearLabel := ""
	scene.Blockout = &updated
	cleared, err := changedBlockout(scene, []BlockoutEdit{
		{Op: "place", Kind: "player-spawn", Area: &area, Label: &clearLabel},
	})
	if err != nil || slices.ContainsFunc(cleared.Elements, func(element BlockoutElement) bool {
		return element.Kind == "player-spawn" && element.Label != ""
	}) {
		t.Fatalf("could not clear the spawn label: %+v, %v", cleared, err)
	}
}

func TestBlockoutRepaintingSameTerrainKeepsTheSavedRegions(t *testing.T) {
	scene := Scene{Width: 4, Height: 4}
	row := TileArea{Point{0, 0}, 2, 1}
	extraTile := TileArea{Point{0, 1}, 1, 1}
	column := TileArea{Point{0, 0}, 1, 2}
	saved, err := changedBlockout(scene, []BlockoutEdit{
		{Op: "paint", Kind: "walkable", Area: &row},
		{Op: "paint", Kind: "walkable", Area: &extraTile},
	})
	if err != nil {
		t.Fatal(err)
	}
	scene.Blockout = &saved
	repainted, err := changedBlockout(scene, []BlockoutEdit{{Op: "paint", Kind: "walkable", Area: &column}})
	if err != nil || !slices.Equal(repainted.Terrain, saved.Terrain) {
		t.Fatalf("identical paint changed terrain regions: %+v, %v", repainted.Terrain, err)
	}
}

func TestBlockoutErasingUnpaintedTerrainKeepsTheSavedRegions(t *testing.T) {
	scene := Scene{Width: 4, Height: 4}
	saved, err := changedBlockout(scene, []BlockoutEdit{
		{Op: "paint", Kind: "walkable", Area: &TileArea{Point{0, 0}, 1, 3}},
		{Op: "paint", Kind: "walkable", Area: &TileArea{Point{1, 0}, 1, 1}},
		{Op: "paint", Kind: "walkable", Area: &TileArea{Point{1, 1}, 1, 2}},
	})
	if err != nil || len(saved.Terrain) != 2 {
		t.Fatalf("expected two adjacent saved rectangles: %+v, %v", saved.Terrain, err)
	}
	scene.Blockout = &saved
	erased, err := changedBlockout(scene, []BlockoutEdit{{Op: "erase", Area: &TileArea{Point{3, 3}, 1, 1}}})
	if err != nil || !slices.Equal(erased.Terrain, saved.Terrain) {
		t.Fatalf("erasing an unpainted tile changed the terrain: %+v, %v", erased.Terrain, err)
	}
}
