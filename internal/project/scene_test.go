package project

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
)

func TestSceneCreationAllowsOneWriterPerRevision(t *testing.T) {
	saved, err := Create(CreateInput{Name: "Loom Yard", Path: filepath.Join(t.TempDir(), "world")})
	if err != nil {
		t.Fatal(err)
	}
	var writers sync.WaitGroup
	results := make(chan error, 2)
	start := make(chan struct{})
	for _, name := range []string{"Riverbank", "Loft"} {
		writers.Go(func() {
			<-start
			_, err := AddScene(saved.Path, AddSceneInput{
				BaseRevision: saved.Revision, Name: name, Width: 20, Height: 18,
			})
			results <- err
		})
	}
	close(start)
	writers.Wait()
	close(results)
	writes := 0
	for err := range results {
		switch {
		case err == nil:
			writes++
		case errors.Is(err, ErrStaleRevision), errors.Is(err, ErrProjectBusy):
		default:
			t.Fatal(err)
		}
	}
	latest, err := Load(saved.Path)
	if err != nil || writes != 1 || len(latest.Project.Scenes) != 1 {
		t.Fatalf("expected one scene saved: %d writes, %+v (%v)", writes, latest, err)
	}
}

func TestSceneActionsPersistUnderRevisionChecks(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "examples", "threadvale", "project.json"))
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "project.json")
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	initial, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	id := initial.Project.Scenes[0].ID
	apply := func(revision, target, action, name, color string) SceneResult {
		t.Helper()
		result, err := ApplySceneAction(path, target, SceneActionInput{
			BaseRevision: revision, Action: action, Name: name, Color: color,
		})
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	renamed := apply(initial.Revision, id, "rename", " Reed Bank ", "")
	if renamed.Project.Scenes[0].Name != "Reed Bank" || renamed.SceneID != id {
		t.Fatalf("rename: %+v", renamed)
	}
	_, err = ApplySceneAction(path, id, SceneActionInput{
		BaseRevision: initial.Revision, Action: "delete",
	})
	if !errors.Is(err, ErrStaleRevision) {
		t.Fatalf("stale delete: %v", err)
	}
	colored := apply(renamed.Revision, id, "color", "", "#9ABDEF")
	if colored.Project.Scenes[0].Color != "#9abdef" {
		t.Fatalf("color: %+v", colored.Project.Scenes[0])
	}
	duplicated := apply(colored.Revision, id, "duplicate", "", "")
	source := duplicated.Project.Scenes[0]
	copy := duplicated.Project.Scenes[2]
	if duplicated.SceneID != copy.ID || copy.ID == id || copy.Name != "Reed Bank copy" || copy.Color != source.Color ||
		copy.World == source.World || copy.Art != source.Art || !reflect.DeepEqual(copy.Actors, source.Actors) {
		t.Fatalf("duplicate: %+v", copy)
	}
	reset := apply(duplicated.Revision, copy.ID, "color", "", "")
	if reset.Project.Scenes[2].Color != "" || reset.Project.Scenes[0].Color != source.Color {
		t.Fatal("reset color affected the wrong scene")
	}
	deleted := apply(reset.Revision, copy.ID, "delete", "", "")
	deleted = apply(deleted.Revision, id, "delete", "", "")
	deleted = apply(deleted.Revision, deleted.Project.Scenes[0].ID, "delete", "", "")
	loaded, err := Load(path)
	if err != nil || loaded.Revision != deleted.Revision || len(loaded.Project.Scenes) != 0 {
		t.Fatalf("reopen after deleting all scenes: %+v (%v)", loaded, err)
	}
}
