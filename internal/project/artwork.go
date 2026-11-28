package project

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
)

const (
	starterCourier = "starter:courier"
	courierWidth   = 12
	courierHeight  = 16
)

type PaintedTile struct {
	Tile string `json:"tile"`
	TileArea
}

type TileLayer struct {
	ID     string        `json:"id"`
	Name   string        `json:"name"`
	Hidden bool          `json:"hidden,omitempty"`
	Tiles  []PaintedTile `json:"tiles"`
}

type ArtworkEdit struct {
	Op            string    `json:"op"`
	LayerID       string    `json:"layerId,omitempty"`
	Tile          string    `json:"tile,omitempty"`
	Sprite        string    `json:"sprite,omitempty"`
	ActorID       string    `json:"actorId,omitempty"`
	Position      *Point    `json:"position,omitempty"`
	Area          *TileArea `json:"area,omitempty"`
	Name          string    `json:"name,omitempty"`
	ActorRecord   string    `json:"actorRecord,omitempty"`
	ActorIndex    *int      `json:"actorIndex,omitempty"`
	restoreLayers []TileLayer
}

type RestoreArtworkInput struct {
	BaseRevision string       `json:"baseRevision"`
	Layers       []TileLayer  `json:"layers,omitempty"`
	Actor        *ArtworkEdit `json:"actor,omitempty"`
}

func artworkError(message string) error {
	return fmt.Errorf("%w: %s", ErrInvalidInput, message)
}

func validateTileLayers(scene Scene) error {
	layerIDs := make(map[string]bool, len(scene.TileLayers))
	for _, layer := range scene.TileLayers {
		if !idPattern.MatchString(layer.ID) || layerIDs[layer.ID] || strings.TrimSpace(layer.Name) == "" || layer.Tiles == nil {
			return artworkError("invalid tile layer")
		}
		layerIDs[layer.ID] = true
		if len(layer.Tiles) == 0 {
			continue
		}
		occupied := make([]bool, scene.Width*scene.Height)
		for _, region := range layer.Tiles {
			if !artworkReference("tile", region.Tile) || !region.inBounds(scene) {
				return artworkError("invalid artwork tile region")
			}
			for y := region.Y; y < region.Y+region.Height; y++ {
				for x := region.X; x < region.X+region.Width; x++ {
					i := y*scene.Width + x
					if occupied[i] {
						return artworkError("artwork tile regions overlap within a layer")
					}
					occupied[i] = true
				}
			}
		}
	}
	return nil
}

func editTileLayers(path string, current Project, scene Scene, edit ArtworkEdit) ([]TileLayer, error) {
	if edit.Op == "restore-layers" {
		if edit.restoreLayers == nil {
			return nil, artworkError("provide the tile layers to restore")
		}
		scene.TileLayers = edit.restoreLayers
		return scene.TileLayers, validateTileLayers(scene)
	}
	layers := scene.TileLayers
	if edit.Op == "add-layer" {
		name := strings.TrimSpace(edit.Name)
		if name == "" {
			return nil, artworkError("enter a tile layer name")
		}
		return append(layers, TileLayer{ID: newObjectID("layer"), Name: name, Tiles: []PaintedTile{}}), nil
	}
	index := slices.IndexFunc(layers, func(layer TileLayer) bool { return layer.ID == edit.LayerID })
	if index < 0 {
		return nil, artworkError("the tile layer no longer exists")
	}
	layer := &layers[index]
	switch edit.Op {
	case "remove-layer":
		return slices.Delete(layers, index, index+1), nil
	case "toggle-layer":
		layer.Hidden = !layer.Hidden
	case "raise-layer":
		if index+1 < len(layers) {
			layers[index], layers[index+1] = layers[index+1], layers[index]
		}
	case "lower-layer":
		if index > 0 {
			layers[index], layers[index-1] = layers[index-1], layers[index]
		}
	case "move-tile":
		if edit.Area == nil || edit.Position == nil {
			return nil, artworkError("select a painted tile region and its destination")
		}
		index := slices.IndexFunc(layer.Tiles, func(tile PaintedTile) bool {
			return tile.Tile == edit.Tile && tile.TileArea == *edit.Area
		})
		if index < 0 {
			return nil, artworkError("the selected tile region has changed")
		}
		moved := layer.Tiles[index]
		moved.Point = *edit.Position
		if !moved.inBounds(scene) {
			return nil, artworkError("keep the full tile region inside the scene")
		}
		for i, other := range layer.Tiles {
			if i != index && moved.overlaps(other.TileArea) {
				return nil, artworkError("the destination overlaps another tile region on this layer")
			}
		}
		layer.Tiles[index] = moved
	case "paint", "erase":
		if edit.Area == nil || !edit.Area.inBounds(scene) {
			return nil, artworkError("keep the artwork rectangle inside the scene")
		}
		if layer.Hidden {
			return nil, artworkError("show the tile layer before editing it")
		}
		if edit.Op == "paint" {
			if _, err := resolveArtworkAsset(path, current, "tile", edit.Tile); err != nil {
				return nil, err
			}
		}
		area := *edit.Area
		if edit.Op == "paint" {
			covered := 0
			for _, region := range layer.Tiles {
				if region.Tile == edit.Tile {
					covered += region.overlapTiles(area)
				}
			}
			if covered == area.Width*area.Height {
				return layers, nil
			}
		}
		tiles := make([]PaintedTile, 0, len(layer.Tiles)+1)
		for _, region := range layer.Tiles {
			for _, piece := range region.subtract(area) {
				tiles = append(tiles, PaintedTile{Tile: region.Tile, TileArea: piece})
			}
		}
		if edit.Op == "paint" {
			tiles = append(tiles, PaintedTile{Tile: edit.Tile, TileArea: area})
		}
		layer.Tiles = tiles
	default:
		return nil, artworkError("unknown artwork operation")
	}
	return layers, nil
}

func editSceneActors(path string, current Project, scene Scene, saved json.RawMessage, edit ArtworkEdit) ([]byte, error) {
	var actors []json.RawMessage
	if err := json.Unmarshal(saved, &actors); err != nil {
		return nil, err
	}
	if edit.Op == "place-sprite" {
		if edit.Area == nil || edit.Area.Width != 1 || edit.Area.Height != 1 || !edit.Area.inBounds(scene) {
			return nil, artworkError("place the sprite on one tile")
		}
		asset, err := resolveArtworkAsset(path, current, "sprite", edit.Sprite)
		if err != nil {
			return nil, err
		}
		position := Point{edit.Area.X * pixelsPerTile, edit.Area.Y * pixelsPerTile}
		if !spriteFits(scene, position, asset.Width, asset.Height) {
			return nil, artworkError("the sprite needs room for its full image inside the scene")
		}
		actor := Actor{ID: newObjectID("actor"), Name: asset.Name, Sprite: asset.ID, Width: asset.Width, Height: asset.Height, Point: position}
		raw, _ := json.Marshal(actor)
		return json.Marshal(append(actors, raw))
	}
	if edit.Op == "restore-actor" {
		record := json.RawMessage(edit.ActorRecord)
		if edit.ActorIndex == nil || *edit.ActorIndex < 0 || *edit.ActorIndex > len(actors) ||
			!json.Valid(record) {
			return nil, artworkError("provide the actor record and its original position in the actor list")
		}
		return json.Marshal(slices.Insert(actors, *edit.ActorIndex, record))
	}
	index := slices.IndexFunc(scene.Actors, func(actor Actor) bool { return actor.ID == edit.ActorID })
	if index < 0 {
		return nil, artworkError("the actor no longer exists")
	}
	if edit.Op == "remove-actor" {
		return json.Marshal(slices.Delete(actors, index, index+1))
	}
	actor := scene.Actors[index]
	if edit.Position == nil || !spriteFits(scene, *edit.Position, actor.Width, actor.Height) {
		return nil, artworkError("keep the full sprite inside the scene")
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(actors[index], &fields); err != nil {
		return nil, err
	}
	fields["x"], _ = json.Marshal(edit.Position.X)
	fields["y"], _ = json.Marshal(edit.Position.Y)
	actors[index], _ = json.Marshal(fields)
	return json.Marshal(actors)
}

func spriteFits(scene Scene, pos Point, width, height int) bool {
	return pos.X >= 0 && pos.Y >= 0 &&
		pos.X <= scene.Width*pixelsPerTile-width && pos.Y <= scene.Height*pixelsPerTile-height
}

func applyArtwork(path, id, revision string, edit ArtworkEdit) (SceneResult, error) {
	var removedActor string
	result, err := writeScenes(path, revision, func(current Project, entries []json.RawMessage) ([]json.RawMessage, string, error) {
		index := slices.IndexFunc(current.Scenes, func(scene Scene) bool { return scene.ID == id })
		if index < 0 {
			return nil, "", ErrSceneNotFound
		}
		scene := current.Scenes[index]
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(entries[index], &fields); err != nil {
			return nil, "", err
		}
		switch edit.Op {
		case "place-sprite", "remove-actor", "move-actor", "restore-actor":
			actors, err := editSceneActors(path, current, scene, fields["actors"], edit)
			if err != nil {
				return nil, "", err
			}
			if edit.Op == "remove-actor" {
				var previous []json.RawMessage
				if err := json.Unmarshal(fields["actors"], &previous); err != nil {
					return nil, "", err
				}
				index := slices.IndexFunc(scene.Actors, func(actor Actor) bool { return actor.ID == edit.ActorID })
				// Keep the record opaque to the browser so unknown numeric fields retain their precision.
				removedActor = string(previous[index])
			}
			fields["actors"] = actors
		default:
			layers, err := editTileLayers(path, current, scene, edit)
			if err != nil {
				return nil, "", err
			}
			fields["tileLayers"], _ = json.Marshal(layers)
		}
		entry, err := json.Marshal(fields)
		entries[index] = entry
		return entries, id, err
	})
	result.RemovedActor = removedActor
	return result, err
}

func RestoreArtwork(path, id string, input RestoreArtworkInput) (SceneResult, error) {
	if !idPattern.MatchString(id) || input.BaseRevision == "" {
		return SceneResult{}, artworkError("provide a scene and project revision")
	}
	if input.Actor != nil && input.Actor.Op == "restore-actor" && input.Layers == nil {
		return applyArtwork(path, id, input.BaseRevision, *input.Actor)
	}
	if input.Actor == nil && input.Layers != nil {
		return applyArtwork(path, id, input.BaseRevision, ArtworkEdit{Op: "restore-layers", restoreLayers: input.Layers})
	}
	return SceneResult{}, artworkError("provide tile layers or an actor to restore")
}
