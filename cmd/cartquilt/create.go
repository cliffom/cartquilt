package main

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

var (
	errInvalidProjectInput = errors.New("invalid project input")
	errProjectExists       = errors.New("project folder already exists")
)

type createInput struct {
	Name string `json:"name" jsonschema:"Display name for the new project"`
	Path string `json:"path" jsonschema:"Absolute local path for a new project folder whose parent already exists"`
}

type savedProject struct {
	Snapshot
	Path string `json:"path" jsonschema:"Absolute path to the saved project.json file"`
}

func createProject(input createInput) (savedProject, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return savedProject{}, fmt.Errorf("%w: enter a project name", errInvalidProjectInput)
	}
	if !filepath.IsAbs(input.Path) {
		return savedProject{}, fmt.Errorf("%w: enter the absolute path to a new project folder", errInvalidProjectInput)
	}

	dir := filepath.Clean(input.Path)
	if err := os.Mkdir(dir, 0700); err != nil {
		if errors.Is(err, os.ErrExist) {
			return savedProject{}, fmt.Errorf("%w: %s", errProjectExists, dir)
		}
		return savedProject{}, fmt.Errorf("create project folder (its parent must exist): %w", err)
	}

	var id [16]byte
	rand.Read(id[:])
	result, err := saveNewProject(dir, Project{
		Version: 1,
		ID:      fmt.Sprintf("project-%x", id),
		Name:    name,
		Scenes:  []Scene{},
	})
	if err != nil {
		_ = os.Remove(dir)
	}
	return result, err
}

func saveNewProject(dir string, project Project) (savedProject, error) {
	data, err := json.MarshalIndent(project, "", "  ")
	if err != nil {
		return savedProject{}, err
	}
	temp, err := os.CreateTemp(dir, ".project-*")
	if err != nil {
		return savedProject{}, err
	}
	defer os.Remove(temp.Name())
	_, writeErr := temp.Write(append(data, '\n'))
	if err := errors.Join(writeErr, temp.Close()); err != nil {
		return savedProject{}, err
	}
	snapshot, err := loadProject(temp.Name())
	if err != nil {
		return savedProject{}, err
	}
	path := filepath.Join(dir, "project.json")
	// Publish a complete file without replacing any file already at the destination.
	if err := os.Link(temp.Name(), path); err != nil {
		return savedProject{}, err
	}
	return savedProject{Snapshot: snapshot, Path: path}, nil
}
