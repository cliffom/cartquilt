package project

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
)

type Entrance struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Point
}

type Destination struct {
	SceneID    string `json:"sceneId"`
	EntranceID string `json:"entranceId"`
}

type Exit struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Width       int         `json:"width"`
	Height      int         `json:"height"`
	Destination Destination `json:"destination"`
	Point
}

type connectionArea struct {
	Point
	width, height int
}

func (e Entrance) area() connectionArea { return connectionArea{e.Point, 1, 1} }
func (e Exit) area() connectionArea     { return connectionArea{e.Point, e.Width, e.Height} }

func (a connectionArea) inBounds(scene Scene) bool {
	return a.X >= 0 && a.Y >= 0 && a.width > 0 && a.height > 0 &&
		a.width <= scene.Width-a.X && a.height <= scene.Height-a.Y
}

func (a connectionArea) overlaps(b connectionArea) bool {
	return a.X < b.X+b.width && b.X < a.X+a.width && a.Y < b.Y+b.height && b.Y < a.Y+a.height
}

// Check changed geometry on write so existing overlapping markers can still be opened and repaired.
func validatePlacement(scene Scene, kind, id string, area connectionArea) error {
	if !area.inBounds(scene) {
		return fmt.Errorf("%w: keep the %s within the scene", ErrInvalidInput, kind)
	}
	var conflict string
	for _, entrance := range scene.Entrances {
		if kind == "entrance" && entrance.ID == id {
			if area == entrance.area() {
				return nil
			}
			continue
		}
		if conflict == "" && area.overlaps(entrance.area()) {
			conflict = fmt.Sprintf("entrance %q", entrance.Name)
		}
	}
	for _, exit := range scene.Exits {
		if kind == "exit" && exit.ID == id {
			if area == exit.area() {
				return nil
			}
			continue
		}
		if conflict == "" && area.overlaps(exit.area()) {
			conflict = fmt.Sprintf("exit %q", exit.Name)
		}
	}
	if conflict != "" {
		return fmt.Errorf("%w: the %s overlaps %s. Choose empty tiles", ErrInvalidInput, kind, conflict)
	}
	return nil
}

func validateConnections(p Project) error {
	entrances := make(map[string]map[string]bool, len(p.Scenes))
	for _, scene := range p.Scenes {
		ids := make(map[string]bool, len(scene.Entrances))
		for _, entrance := range scene.Entrances {
			if !idPattern.MatchString(entrance.ID) || ids[entrance.ID] || strings.TrimSpace(entrance.Name) == "" ||
				!entrance.area().inBounds(scene) {
				return fmt.Errorf("invalid entrance %q in %s", entrance.Name, scene.Name)
			}
			ids[entrance.ID] = true
		}
		entrances[scene.ID] = ids
	}
	for _, scene := range p.Scenes {
		ids := make(map[string]bool, len(scene.Exits))
		for _, exit := range scene.Exits {
			if !idPattern.MatchString(exit.ID) || ids[exit.ID] || strings.TrimSpace(exit.Name) == "" ||
				!exit.area().inBounds(scene) {
				return fmt.Errorf("invalid exit %q in %s", exit.Name, scene.Name)
			}
			ids[exit.ID] = true
			to := exit.Destination
			if to.SceneID == scene.ID || !entrances[to.SceneID][to.EntranceID] {
				return fmt.Errorf("exit %q in %s needs an entrance in another scene. Relink or remove this exit before removing its destination", exit.Name, scene.Name)
			}
		}
	}
	return nil
}

func applyConnectionAction(path, sceneID string, input SceneActionInput) (SceneResult, error) {
	return writeScenes(path, input.BaseRevision, func(current Project, entries []json.RawMessage) ([]json.RawMessage, string, error) {
		index := slices.IndexFunc(current.Scenes, func(s Scene) bool { return s.ID == sceneID })
		if index < 0 {
			return nil, "", ErrSceneNotFound
		}
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(entries[index], &fields); err != nil {
			return nil, "", err
		}
		scene := current.Scenes[index]
		var err error
		switch input.Action {
		case "entrance", "remove-entrance":
			if input.Entrance == nil {
				return nil, "", fmt.Errorf("%w: entrance is required", ErrInvalidInput)
			}
			value := *input.Entrance
			value.Name = strings.TrimSpace(value.Name)
			remove := input.Action == "remove-entrance"
			if !remove {
				if err := validatePlacement(scene, "entrance", value.ID, value.area()); err != nil {
					return nil, "", err
				}
			}
			add := value.ID == "" && !remove
			if add {
				value.ID = newObjectID("entrance")
			}
			fields["entrances"], err = editConnection(fields["entrances"], scene.Entrances, value, value.ID, add, remove, func(e Entrance) string { return e.ID })
		case "exit", "remove-exit":
			if input.Exit == nil {
				return nil, "", fmt.Errorf("%w: exit is required", ErrInvalidInput)
			}
			value := *input.Exit
			value.Name = strings.TrimSpace(value.Name)
			remove := input.Action == "remove-exit"
			if !remove {
				if err := validatePlacement(scene, "exit", value.ID, value.area()); err != nil {
					return nil, "", err
				}
			}
			add := value.ID == "" && !remove
			if add {
				value.ID = newObjectID("exit")
			}
			fields["exits"], err = editConnection(fields["exits"], scene.Exits, value, value.ID, add, remove, func(e Exit) string { return e.ID })
		}
		if err != nil {
			return nil, "", err
		}
		entry, err := json.Marshal(fields)
		entries[index] = entry
		return entries, sceneID, err
	})
}

func editConnection[T Entrance | Exit](raw json.RawMessage, points []T, value T, id string, add, remove bool, getID func(T) string) (json.RawMessage, error) {
	var entries []json.RawMessage
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &entries); err != nil {
			return nil, err
		}
	}
	index := slices.IndexFunc(points, func(item T) bool { return getID(item) == id })
	if !add && index < 0 {
		return nil, fmt.Errorf("%w: connection point no longer exists", ErrInvalidInput)
	}
	if remove {
		return json.Marshal(slices.Delete(entries, index, index+1))
	}
	entry, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	if add {
		return json.Marshal(append(entries, entry))
	}
	// Merge the authored fields over the saved record, keeping extra manifest fields.
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(entries[index], &fields); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(entry, &fields); err != nil {
		return nil, err
	}
	entries[index], err = json.Marshal(fields)
	if err != nil {
		return nil, err
	}
	return json.Marshal(entries)
}
