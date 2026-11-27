package project

import (
	"fmt"
	"os"
	"path/filepath"
)

type OpenInput struct {
	Path string `json:"path" jsonschema:"Absolute local path to a Cartquilt project folder or its saved JSON file"`
}

func Open(input OpenInput) (Saved, error) {
	if !filepath.IsAbs(input.Path) {
		return Saved{}, fmt.Errorf("%w: enter the absolute path to a project folder or file", ErrInvalidInput)
	}
	path := filepath.Clean(input.Path)
	info, err := os.Stat(path)
	if err != nil {
		return Saved{}, fmt.Errorf("open project: %w", err)
	}
	if info.IsDir() {
		path = filepath.Join(path, "project.json")
		info, err = os.Stat(path)
		if err != nil {
			return Saved{}, fmt.Errorf("open project.json: %w", err)
		}
	}
	if !info.Mode().IsRegular() || filepath.Ext(path) != ".json" {
		return Saved{}, fmt.Errorf("%w: choose a folder containing project.json or a saved JSON file", ErrInvalidInput)
	}
	snapshot, err := Load(path)
	if err != nil {
		return Saved{}, fmt.Errorf("load Cartquilt project: %w", err)
	}
	return Saved{Snapshot: snapshot, Path: path}, nil
}
