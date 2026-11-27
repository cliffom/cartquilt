package main

import (
	"fmt"
	"os"
	"path/filepath"
)

type openInput struct {
	Path string `json:"path" jsonschema:"Absolute local path to a Cartquilt project folder or its saved JSON file"`
}

func openProject(input openInput) (savedProject, error) {
	if !filepath.IsAbs(input.Path) {
		return savedProject{}, fmt.Errorf("%w: enter the absolute path to a project folder or file", errInvalidProjectInput)
	}
	path := filepath.Clean(input.Path)
	info, err := os.Stat(path)
	if err != nil {
		return savedProject{}, fmt.Errorf("open project: %w", err)
	}
	if info.IsDir() {
		path = filepath.Join(path, "project.json")
		info, err = os.Stat(path)
		if err != nil {
			return savedProject{}, fmt.Errorf("open project.json: %w", err)
		}
	}
	if !info.Mode().IsRegular() || filepath.Ext(path) != ".json" {
		return savedProject{}, fmt.Errorf("%w: choose a folder containing project.json or a saved JSON file", errInvalidProjectInput)
	}
	snapshot, err := loadProject(path)
	if err != nil {
		return savedProject{}, fmt.Errorf("load Cartquilt project: %w", err)
	}
	return savedProject{Snapshot: snapshot, Path: path}, nil
}
