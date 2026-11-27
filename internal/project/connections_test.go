package project

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSceneConnectionsSurviveRenameAndPreventDanglingExits(t *testing.T) {
	saved, err := Create(CreateInput{Name: "Two rooms", Path: filepath.Join(t.TempDir(), "world")})
	if err != nil {
		t.Fatal(err)
	}
	first, err := AddScene(saved.Path, AddSceneInput{BaseRevision: saved.Revision, Name: "Courtyard", Width: 20, Height: 18})
	if err != nil {
		t.Fatal(err)
	}
	second, err := AddScene(saved.Path, AddSceneInput{BaseRevision: first.Revision, Name: "Loom Yard", Width: 20, Height: 18})
	if err != nil {
		t.Fatal(err)
	}
	destination, err := ApplySceneAction(saved.Path, second.SceneID, SceneActionInput{
		BaseRevision: second.Revision, Action: "entrance", Entrance: &Entrance{Name: "West gate", Point: Point{X: 1, Y: 8}},
	})
	if err != nil {
		t.Fatal(err)
	}
	entry := destination.Project.Scenes[1].Entrances[0]
	exit := Exit{
		Name: "East gate", Point: Point{X: 19, Y: 8}, Width: 1, Height: 2,
		Destination: Destination{SceneID: second.SceneID, EntranceID: entry.ID},
	}
	outside := exit
	outside.Width = 2
	_, err = ApplySceneAction(saved.Path, first.SceneID, SceneActionInput{
		BaseRevision: destination.Revision, Action: "exit", Exit: &outside,
	})
	if err == nil {
		t.Fatal("expected an out-of-bounds trigger to fail")
	}
	linked, err := ApplySceneAction(saved.Path, first.SceneID, SceneActionInput{
		BaseRevision: destination.Revision, Action: "exit", Exit: &exit,
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, action := range []SceneActionInput{
		{Action: "entrance", Entrance: &Entrance{Name: "Overlapping entrance", Point: exit.Point}},
		{Action: "exit", Exit: &exit},
	} {
		action.BaseRevision = linked.Revision
		_, err := ApplySceneAction(saved.Path, first.SceneID, action)
		if !errors.Is(err, ErrInvalidInput) || !strings.Contains(err.Error(), "overlaps exit") {
			t.Fatalf("expected overlap error for %s: %v", action.Action, err)
		}
	}
	renamed, err := ApplySceneAction(saved.Path, second.SceneID, SceneActionInput{
		BaseRevision: linked.Revision, Action: "rename", Name: "Loom Workshop",
	})
	if err != nil {
		t.Fatal(err)
	}
	reopened, err := Load(saved.Path)
	if err != nil || reopened.Project.Scenes[0].Exits[0].Destination != exit.Destination ||
		reopened.Project.Scenes[1].Name != "Loom Workshop" {
		t.Fatalf("reopened: %+v (%v)", reopened, err)
	}
	_, err = ApplySceneAction(saved.Path, second.SceneID, SceneActionInput{
		BaseRevision: renamed.Revision, Action: "remove-entrance", Entrance: &entry,
	})
	if err == nil || !strings.Contains(err.Error(), "East gate") {
		t.Fatalf("expected an actionable reference error: %v", err)
	}
	_, err = ApplySceneAction(saved.Path, second.SceneID, SceneActionInput{
		BaseRevision: renamed.Revision, Action: "delete",
	})
	if err == nil || !strings.Contains(err.Error(), "East gate") {
		t.Fatalf("expected the scene with an incoming exit to remain: %v", err)
	}
	unlinked, err := ApplySceneAction(saved.Path, first.SceneID, SceneActionInput{
		BaseRevision: renamed.Revision, Action: "remove-exit", Exit: &reopened.Project.Scenes[0].Exits[0],
	})
	if err != nil || len(unlinked.Project.Scenes[0].Exits) != 0 {
		t.Fatalf("remove exit: %+v (%v)", unlinked, err)
	}
}

func TestConnectionWritesPreserveSavedAnnotationsAndAllowOverlapRepair(t *testing.T) {
	path := filepath.Join(t.TempDir(), "project.json")
	manifest := `{"version":1,"id":"world","name":"Old world","scenes":[{
		"id":"room","name":"Room","width":3,"height":3,"world":{"x":0,"y":0},"actors":[],
		"entrances":[{"id":"north","name":"North","x":0,"y":0,"note":"first"},
		{"id":"south","name":"South","x":0,"y":0,"note":"second"}]
	}]}`
	if err := os.WriteFile(path, []byte(manifest), 0600); err != nil {
		t.Fatal(err)
	}
	saved, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	point := saved.Project.Scenes[0].Entrances[0]
	point.Name = "North gate"
	rename, err := ApplySceneAction(path, "room", SceneActionInput{BaseRevision: saved.Revision, Action: "entrance", Entrance: &point})
	if err != nil {
		t.Fatal(err)
	}
	point.X = 1
	_, err = ApplySceneAction(path, "room", SceneActionInput{BaseRevision: rename.Revision, Action: "entrance", Entrance: &point})
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var raw struct {
		Scenes []struct {
			Entrances []struct {
				Entrance
				Note string `json:"note"`
			} `json:"entrances"`
		} `json:"scenes"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatal(err)
	}
	points := raw.Scenes[0].Entrances
	if len(points) != 2 || points[0].Entrance != point || points[0].Note != "first" || points[1].Note != "second" {
		t.Fatalf("unexpected saved entrances: %+v", points)
	}
}
