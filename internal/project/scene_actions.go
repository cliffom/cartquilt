package project

import (
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
)

var ErrSceneNotFound = errors.New("scene no longer exists")

type SceneActionInput struct {
	BaseRevision string `json:"baseRevision"`
	Action       string `json:"action"`
	Name         string `json:"name,omitempty"`
	Color        string `json:"color,omitempty"`
	World        *Point `json:"world,omitempty"`
}

func ApplySceneAction(path, id string, input SceneActionInput) (SceneResult, error) {
	name := strings.TrimSpace(input.Name)
	if !idPattern.MatchString(id) || input.BaseRevision == "" {
		return SceneResult{}, fmt.Errorf("%w: a scene ID and project revision are required", ErrInvalidInput)
	}
	switch input.Action {
	case "rename":
		if name == "" {
			return SceneResult{}, fmt.Errorf("%w: enter a scene name", ErrInvalidInput)
		}
	case "color":
		if input.Color != "" && !sceneColorPattern.MatchString(input.Color) {
			return SceneResult{}, fmt.Errorf("%w: choose a six-digit hex color", ErrInvalidInput)
		}
	case "position":
		const maxCoordinate = 1<<53 - 1
		if input.World == nil || int64(input.World.X) < -maxCoordinate || int64(input.World.X) > maxCoordinate ||
			int64(input.World.Y) < -maxCoordinate || int64(input.World.Y) > maxCoordinate {
			return SceneResult{}, fmt.Errorf("%w: enter a valid world position", ErrInvalidInput)
		}
	case "duplicate", "delete":
	default:
		return SceneResult{}, fmt.Errorf("%w: unknown scene action", ErrInvalidInput)
	}

	return writeScenes(path, input.BaseRevision, func(current Project, entries []json.RawMessage) ([]json.RawMessage, string, error) {
		index := slices.IndexFunc(current.Scenes, func(scene Scene) bool { return scene.ID == id })
		if index < 0 {
			return nil, "", ErrSceneNotFound
		}
		if input.Action == "delete" {
			return slices.Delete(entries, index, index+1), id, nil
		}
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(entries[index], &fields); err != nil {
			return nil, "", err
		}
		switch input.Action {
		case "rename":
			fields["name"], _ = json.Marshal(name)
		case "color":
			if input.Color == "" {
				delete(fields, "color")
			} else {
				fields["color"], _ = json.Marshal(strings.ToLower(input.Color))
			}
		case "position":
			fields["world"], _ = json.Marshal(input.World)
		case "duplicate":
			id = newSceneID()
			fields["id"], _ = json.Marshal(id)
			fields["name"], _ = json.Marshal(current.Scenes[index].Name + " copy")
			fields["world"], _ = json.Marshal(nextScenePosition(current))
		}
		entry, err := json.Marshal(fields)
		if input.Action == "duplicate" {
			return append(entries, entry), id, err
		}
		entries[index] = entry
		return entries, id, err
	})
}
