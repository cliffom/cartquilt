package project

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
)

const (
	DefaultMovementProfile = "top-down"
	maxBlockoutEdits       = 128
	maxBlockoutEntries     = 4096
)

type BlockoutTerrain struct {
	Kind string `json:"kind"`
	TileArea
}

type BlockoutElement struct {
	ID    string `json:"id"`
	Kind  string `json:"kind"`
	Label string `json:"label,omitempty"`
	TileArea
}

type Blockout struct {
	Profile  string            `json:"profile"`
	Terrain  []BlockoutTerrain `json:"terrain,omitempty"`
	Elements []BlockoutElement `json:"elements,omitempty"`
}

type BlockoutEdit struct {
	Op      string    `json:"op" jsonschema:"paint, erase, place, remove, erase-elements, or profile"`
	Kind    string    `json:"kind,omitempty" jsonschema:"Terrain or element kind for paint or place"`
	Area    *TileArea `json:"area,omitempty" jsonschema:"Zero-based scene-local tile rectangle for paint, erase, place, or erase-elements"`
	ID      string    `json:"id,omitempty" jsonschema:"Saved element ID to remove or update"`
	Label   *string   `json:"label,omitempty" jsonschema:"Element label. Omit to preserve an existing label or pass an empty string to clear it."`
	Profile string    `json:"profile,omitempty" jsonschema:"top-down or platformer"`
}

type BlockoutPreview struct {
	Revision string   `json:"revision"`
	SceneID  string   `json:"sceneId"`
	Blockout Blockout `json:"blockout"`
}

func terrainKind(kind string) bool {
	switch kind {
	case "walkable", "blocked", "one-way", "water", "pit", "hazard", "climb":
		return true
	}
	return false
}

func elementKind(kind string) (valid, point bool) {
	switch kind {
	case "enemy", "reward", "discoverable", "player-spawn", "checkpoint", "boss-entrance", "stage-exit", "note":
		return true, true
	case "patrol", "flying-approach", "detour", "boss-arena", "section", "camera":
		return true, false
	}
	return false, false
}

func blockoutError(message string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalidInput, fmt.Sprintf(message, args...))
}

func validateBlockout(scene Scene, layer Blockout) error {
	if layer.Profile != DefaultMovementProfile && layer.Profile != "platformer" {
		return blockoutError("choose a top-down or platformer movement profile")
	}
	if len(layer.Terrain) > maxBlockoutEntries || len(layer.Elements) > maxBlockoutEntries {
		return blockoutError("a blockout supports up to %d terrain regions and %d elements", maxBlockoutEntries, maxBlockoutEntries)
	}
	if len(layer.Terrain) > 0 {
		occupied := make([]bool, scene.Width*scene.Height)
		for _, region := range layer.Terrain {
			if !terrainKind(region.Kind) || !region.inBounds(scene) {
				return blockoutError("invalid terrain region %q", region.Kind)
			}
			for y := region.Y; y < region.Y+region.Height; y++ {
				for x := region.X; x < region.X+region.Width; x++ {
					i := y*scene.Width + x
					if occupied[i] {
						return blockoutError("terrain regions overlap at tile %d,%d", x, y)
					}
					occupied[i] = true
				}
			}
		}
	}
	ids := make(map[string]bool, len(layer.Elements))
	hasSpawn := false
	for _, element := range layer.Elements {
		valid, point := elementKind(element.Kind)
		if !valid || !element.inBounds(scene) || !idPattern.MatchString(element.ID) || ids[element.ID] ||
			(point && (element.Width != 1 || element.Height != 1)) {
			return blockoutError("invalid blockout element %q", element.Kind)
		}
		if element.Kind == "player-spawn" {
			if hasSpawn {
				return blockoutError("a scene can have one player spawn")
			}
			hasSpawn = true
		}
		ids[element.ID] = true
	}
	return nil
}

func changedBlockout(scene Scene, edits []BlockoutEdit) (Blockout, error) {
	if len(edits) == 0 || len(edits) > maxBlockoutEdits {
		return Blockout{}, blockoutError("provide between 1 and %d blockout edits", maxBlockoutEdits)
	}
	layer := Blockout{Profile: DefaultMovementProfile}
	if scene.Blockout != nil {
		layer = *scene.Blockout
		layer.Terrain = slices.Clone(layer.Terrain)
		layer.Elements = slices.Clone(layer.Elements)
	}
	for index, edit := range edits {
		if err := editBlockout(scene, &layer, edit); err != nil {
			return Blockout{}, fmt.Errorf("blockout edit %d: %w", index+1, err)
		}
		if len(layer.Terrain) > maxBlockoutEntries || len(layer.Elements) > maxBlockoutEntries {
			return Blockout{}, blockoutError("reduce the number of blockout regions or elements")
		}
	}
	return layer, validateBlockout(scene, layer)
}

func editBlockout(scene Scene, layer *Blockout, edit BlockoutEdit) error {
	switch edit.Op {
	case "profile":
		if edit.Profile != DefaultMovementProfile && edit.Profile != "platformer" {
			return blockoutError("choose a top-down or platformer movement profile")
		}
		layer.Profile = edit.Profile
		return nil
	case "remove":
		index := slices.IndexFunc(layer.Elements, func(element BlockoutElement) bool { return element.ID == edit.ID })
		if index < 0 {
			return blockoutError("blockout element %q no longer exists", edit.ID)
		}
		layer.Elements = slices.Delete(layer.Elements, index, index+1)
		return nil
	case "paint", "erase", "place", "erase-elements":
		if edit.Area == nil || !edit.Area.inBounds(scene) {
			return blockoutError("keep the tile rectangle inside the scene")
		}
	default:
		return blockoutError("unknown blockout operation %q", edit.Op)
	}
	area := *edit.Area
	switch edit.Op {
	case "place":
		valid, point := elementKind(edit.Kind)
		if !valid || (point && (area.Width != 1 || area.Height != 1)) {
			return blockoutError("use a valid element kind and place point markers on one tile")
		}
		index := -1
		if edit.ID != "" {
			index = slices.IndexFunc(layer.Elements, func(element BlockoutElement) bool { return element.ID == edit.ID })
			if index < 0 {
				return blockoutError("blockout element %q no longer exists", edit.ID)
			}
		} else if edit.Kind == "player-spawn" {
			index = slices.IndexFunc(layer.Elements, func(element BlockoutElement) bool { return element.Kind == edit.Kind })
		}
		entry := BlockoutElement{Kind: edit.Kind, TileArea: area}
		if index >= 0 {
			entry.ID = layer.Elements[index].ID
			entry.Label = layer.Elements[index].Label
		}
		if edit.Label != nil {
			entry.Label = strings.TrimSpace(*edit.Label)
		}
		if index >= 0 {
			layer.Elements[index] = entry
		} else {
			entry.ID = newObjectID("element")
			layer.Elements = append(layer.Elements, entry)
		}
	case "erase-elements":
		layer.Elements = slices.DeleteFunc(layer.Elements, func(element BlockoutElement) bool { return element.overlaps(area) })
	case "paint", "erase":
		if edit.Op == "paint" {
			if !terrainKind(edit.Kind) {
				return blockoutError("unknown terrain kind %q", edit.Kind)
			}
			covered := 0
			for _, existing := range layer.Terrain {
				if existing.Kind == edit.Kind {
					covered += existing.overlapTiles(area)
				}
			}
			if covered == area.Width*area.Height {
				return nil
			}
		} else if !slices.ContainsFunc(layer.Terrain, func(region BlockoutTerrain) bool {
			return region.overlaps(area)
		}) {
			return nil
		}
		terrain := make([]BlockoutTerrain, 0, len(layer.Terrain)+1)
		for _, existing := range layer.Terrain {
			for _, piece := range existing.subtract(area) {
				terrain = append(terrain, BlockoutTerrain{existing.Kind, piece})
			}
		}
		if edit.Op == "paint" {
			terrain = append(terrain, BlockoutTerrain{edit.Kind, area})
		}
		layer.Terrain = mergeTerrain(mergeTerrain(terrain, false), true)
	}
	return nil
}

// Merge adjacent regions of the same kind that share a full edge.
func mergeTerrain(regions []BlockoutTerrain, vertical bool) []BlockoutTerrain {
	axes := func(r BlockoutTerrain) (line, span, start, length int) {
		if vertical {
			return r.X, r.Width, r.Y, r.Height
		}
		return r.Y, r.Height, r.X, r.Width
	}
	slices.SortFunc(regions, func(a, b BlockoutTerrain) int {
		if kind := strings.Compare(a.Kind, b.Kind); kind != 0 {
			return kind
		}
		lineA, spanA, startA, _ := axes(a)
		lineB, spanB, startB, _ := axes(b)
		if lineA != lineB {
			return lineA - lineB
		}
		if spanA != spanB {
			return spanA - spanB
		}
		return startA - startB
	})
	merged := regions[:0]
	for _, region := range regions {
		if len(merged) > 0 {
			last := &merged[len(merged)-1]
			line, span, start, _ := axes(region)
			prevLine, prevSpan, prevStart, prevLength := axes(*last)
			if region.Kind == last.Kind && line == prevLine && span == prevSpan && start == prevStart+prevLength {
				if vertical {
					last.Height += region.Height
				} else {
					last.Width += region.Width
				}
				continue
			}
		}
		merged = append(merged, region)
	}
	return merged
}

func PreviewBlockout(path, sceneID, revision string, edits []BlockoutEdit) (BlockoutPreview, error) {
	snapshot, err := Load(path)
	if err != nil {
		return BlockoutPreview{}, err
	}
	if snapshot.Revision != revision {
		return BlockoutPreview{}, ErrStaleRevision
	}
	for _, scene := range snapshot.Project.Scenes {
		if scene.ID == sceneID {
			blockout, err := changedBlockout(scene, edits)
			return BlockoutPreview{snapshot.Revision, sceneID, blockout}, err
		}
	}
	return BlockoutPreview{}, ErrSceneNotFound
}

func applyBlockout(path, sceneID, revision string, edits []BlockoutEdit) (SceneResult, error) {
	return writeBlockout(path, sceneID, revision, func(scene Scene) (Blockout, error) {
		return changedBlockout(scene, edits)
	})
}

type RestoreBlockoutInput struct {
	BaseRevision string    `json:"baseRevision"`
	Blockout     *Blockout `json:"blockout"`
}

func RestoreBlockout(path, sceneID string, input RestoreBlockoutInput) (SceneResult, error) {
	if !idPattern.MatchString(sceneID) || input.BaseRevision == "" || input.Blockout == nil {
		return SceneResult{}, blockoutError("a scene ID, current revision, and blockout are required")
	}
	return writeBlockout(path, sceneID, input.BaseRevision, func(scene Scene) (Blockout, error) {
		layer := *input.Blockout
		return layer, validateBlockout(scene, layer)
	})
}

func writeBlockout(path, sceneID, revision string, update func(Scene) (Blockout, error)) (SceneResult, error) {
	return writeScenes(path, revision, func(current Project, entries []json.RawMessage) ([]json.RawMessage, string, error) {
		for index, scene := range current.Scenes {
			if scene.ID != sceneID {
				continue
			}
			layer, err := update(scene)
			if err != nil {
				return nil, "", err
			}
			var fields map[string]json.RawMessage
			if err := json.Unmarshal(entries[index], &fields); err != nil {
				return nil, "", err
			}
			fields["blockout"], err = json.Marshal(layer)
			if err != nil {
				return nil, "", err
			}
			entries[index], err = json.Marshal(fields)
			return entries, sceneID, err
		}
		return nil, "", ErrSceneNotFound
	})
}
