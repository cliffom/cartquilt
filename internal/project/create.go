package project

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

var (
	ErrInvalidInput = errors.New("invalid project input")
	ErrExists       = errors.New("project folder already exists")
)

type CreateInput struct {
	Name string `json:"name" jsonschema:"Display name for the new project"`
	Path string `json:"path" jsonschema:"Absolute local path for a new project folder whose parent already exists"`
}

type Saved struct {
	Snapshot
	Path string `json:"path" jsonschema:"Absolute path to the saved project.json file"`
}

func Create(input CreateInput) (Saved, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return Saved{}, fmt.Errorf("%w: enter a project name", ErrInvalidInput)
	}
	if !filepath.IsAbs(input.Path) {
		return Saved{}, fmt.Errorf("%w: enter the absolute path to a new project folder", ErrInvalidInput)
	}

	dir := filepath.Clean(input.Path)
	if err := os.Mkdir(dir, privateFolderMode); err != nil {
		if errors.Is(err, os.ErrExist) {
			return Saved{}, fmt.Errorf("%w: %s", ErrExists, dir)
		}
		return Saved{}, fmt.Errorf("create project folder (its parent must exist): %w", err)
	}

	result, err := saveNewProject(dir, Project{
		Version: projectVersion,
		ID:      newObjectID("project"),
		Name:    name,
		Scenes:  []Scene{},
	})
	if err != nil {
		_ = os.Remove(dir)
	}
	return result, err
}

func saveNewProject(dir string, project Project) (Saved, error) {
	data, err := json.MarshalIndent(project, "", "  ")
	if err != nil {
		return Saved{}, err
	}
	data = append(data, '\n')
	snapshot, err := decodeSnapshot(data)
	if err != nil {
		return Saved{}, err
	}
	temp, err := writeCandidate(dir, data, privateFileMode)
	if err != nil {
		return Saved{}, err
	}
	defer os.Remove(temp)
	path := filepath.Join(dir, manifestFilename)
	// Publish a complete file without replacing any file already at the destination.
	if err := os.Link(temp, path); err != nil {
		return Saved{}, err
	}
	return Saved{Snapshot: snapshot, Path: path}, nil
}

func writeCandidate(dir string, data []byte, mode os.FileMode) (string, error) {
	file, err := os.CreateTemp(dir, ".project-*")
	if err != nil {
		return "", err
	}
	_, writeErr := file.Write(data)
	err = errors.Join(writeErr, file.Chmod(mode), file.Sync(), file.Close())
	if err != nil {
		_ = os.Remove(file.Name())
		return "", err
	}
	return file.Name(), nil
}
