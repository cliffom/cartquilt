package project

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/gofrs/flock"
)

var (
	ErrStaleRevision = errors.New("project changed on disk")
	ErrProjectBusy   = errors.New("another operation is saving this project; try again")
)

type AddSceneInput struct {
	BaseRevision string `json:"baseRevision"`
	Name         string `json:"name"`
	Width        int    `json:"width"`
	Height       int    `json:"height"`
}

type SceneResult struct {
	Snapshot
	SceneID string `json:"sceneId"`
}

func AddScene(path string, input AddSceneInput) (SceneResult, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" || !validSceneDimensions(input.Width, input.Height) || input.BaseRevision == "" {
		return SceneResult{}, fmt.Errorf("%w: enter a scene name and dimensions from %d to %d tiles", ErrInvalidInput, minSceneTiles, maxSceneTiles)
	}

	return writeScenes(path, input.BaseRevision, func(current Project, entries []json.RawMessage) ([]json.RawMessage, string, error) {
		scene := Scene{
			ID:   newObjectID("scene"),
			Name: name, Width: input.Width, Height: input.Height,
			World: nextScenePosition(current), Actors: []Actor{},
		}
		entry, err := json.Marshal(scene)
		return append(entries, entry), scene.ID, err
	})
}

func nextScenePosition(current Project) Point {
	last := -newSceneSpacing
	for _, scene := range current.Scenes {
		last = max(last, scene.World.X)
	}
	return Point{X: last + newSceneSpacing}
}

func newObjectID(kind string) string {
	var id [objectIDBytes]byte
	rand.Read(id[:])
	return fmt.Sprintf("%s-%x", kind, id)
}

func writeScenes(path, baseRevision string, edit func(Project, []json.RawMessage) ([]json.RawMessage, string, error)) (SceneResult, error) {
	path, err := filepath.EvalSymlinks(path)
	if err != nil {
		return SceneResult{}, err
	}
	dir := filepath.Dir(path)
	// Keep the lock on a separate inode so it remains valid when the manifest is replaced.
	lock := flock.New(filepath.Join(dir, "."+filepath.Base(path)+".lock"), flock.SetPermissions(privateFileMode))
	defer lock.Close()
	locked, err := lock.TryLock()
	if err != nil {
		return SceneResult{}, err
	}
	if !locked {
		return SceneResult{}, ErrProjectBusy
	}

	info, err := os.Stat(path)
	if err != nil {
		return SceneResult{}, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return SceneResult{}, err
	}
	current, err := decodeSnapshot(data)
	if err != nil {
		return SceneResult{}, err
	}
	if current.Revision != baseRevision {
		return SceneResult{}, ErrStaleRevision
	}

	// Preserve additional manifest fields and the full JSON of unchanged scenes.
	var manifest map[string]json.RawMessage
	if err := json.Unmarshal(data, &manifest); err != nil {
		return SceneResult{}, err
	}
	var entries []json.RawMessage
	if err := json.Unmarshal(manifest["scenes"], &entries); err != nil {
		return SceneResult{}, err
	}
	entries, id, err := edit(current.Project, entries)
	if err != nil {
		return SceneResult{}, err
	}
	manifest["scenes"], err = json.Marshal(entries)
	if err != nil {
		return SceneResult{}, err
	}
	updated, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return SceneResult{}, err
	}
	updated = append(updated, '\n')

	next, err := decodeSnapshot(updated)
	if err != nil {
		return SceneResult{}, err
	}
	temp, err := writeCandidate(dir, updated, info.Mode().Perm())
	if err != nil {
		return SceneResult{}, err
	}
	defer os.Remove(temp)
	latest, err := Load(path)
	if err != nil {
		return SceneResult{}, err
	}
	if latest.Revision != current.Revision {
		return SceneResult{}, ErrStaleRevision
	}
	if err := os.Rename(temp, path); err != nil {
		return SceneResult{}, err
	}
	return SceneResult{Snapshot: next, SceneID: id}, nil
}
