package project

import (
	"errors"
	"path/filepath"
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
