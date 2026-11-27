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

type AddedScene struct {
	Snapshot
	SceneID string `json:"sceneId"`
}

func AddScene(path string, input AddSceneInput) (AddedScene, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" || input.Width < 1 || input.Width > 1024 || input.Height < 1 || input.Height > 1024 || input.BaseRevision == "" {
		return AddedScene{}, fmt.Errorf("%w: enter a scene name and dimensions from 1 to 1024 tiles", ErrInvalidInput)
	}

	path, err := filepath.EvalSymlinks(path)
	if err != nil {
		return AddedScene{}, err
	}
	dir := filepath.Dir(path)
	// Keep the lock on a separate inode so it remains valid when the manifest is replaced.
	lock := flock.New(filepath.Join(dir, "."+filepath.Base(path)+".lock"), flock.SetPermissions(0600))
	defer lock.Close()
	locked, err := lock.TryLock()
	if err != nil {
		return AddedScene{}, err
	}
	if !locked {
		return AddedScene{}, ErrProjectBusy
	}

	info, err := os.Stat(path)
	if err != nil {
		return AddedScene{}, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return AddedScene{}, err
	}
	current, err := decodeSnapshot(data)
	if err != nil {
		return AddedScene{}, err
	}
	if current.Revision != input.BaseRevision {
		return AddedScene{}, ErrStaleRevision
	}

	last := -280
	for _, scene := range current.Project.Scenes {
		last = max(last, scene.World.X)
	}
	var id [16]byte
	rand.Read(id[:])
	scene := Scene{
		ID:   fmt.Sprintf("scene-%x", id),
		Name: name, Width: input.Width, Height: input.Height,
		World: Point{X: last + 280}, Actors: []Actor{},
	}
	updated, err := appendScene(data, scene)
	if err != nil {
		return AddedScene{}, err
	}
	next, err := decodeSnapshot(updated)
	if err != nil {
		return AddedScene{}, err
	}
	temp, err := writeCandidate(dir, updated, info.Mode().Perm())
	if err != nil {
		return AddedScene{}, err
	}
	defer os.Remove(temp)
	latest, err := Load(path)
	if err != nil {
		return AddedScene{}, err
	}
	if latest.Revision != current.Revision {
		return AddedScene{}, ErrStaleRevision
	}
	if err := os.Rename(temp, path); err != nil {
		return AddedScene{}, err
	}
	return AddedScene{Snapshot: next, SceneID: scene.ID}, nil
}

func appendScene(data []byte, scene Scene) ([]byte, error) {
	// Preserve additional manifest fields and the full JSON of existing scenes.
	var manifest map[string]json.RawMessage
	if err := json.Unmarshal(data, &manifest); err != nil {
		return nil, err
	}
	var scenes []json.RawMessage
	if err := json.Unmarshal(manifest["scenes"], &scenes); err != nil {
		return nil, err
	}
	entry, err := json.Marshal(scene)
	if err != nil {
		return nil, err
	}
	manifest["scenes"], err = json.Marshal(append(scenes, entry))
	if err != nil {
		return nil, err
	}
	updated, err := json.MarshalIndent(manifest, "", "  ")
	return append(updated, '\n'), err
}
