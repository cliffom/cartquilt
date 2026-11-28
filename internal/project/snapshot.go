package project

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
)

type Point struct {
	X int `json:"x"`
	Y int `json:"y"`
}
type Actor struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Sprite string `json:"sprite"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Point
}
type Scene struct {
	ID         string      `json:"id"`
	Name       string      `json:"name"`
	Art        string      `json:"art"`
	Color      string      `json:"color,omitempty"`
	Width      int         `json:"width"`
	Height     int         `json:"height"`
	World      Point       `json:"world"`
	Actors     []Actor     `json:"actors"`
	Entrances  []Entrance  `json:"entrances,omitempty"`
	Exits      []Exit      `json:"exits,omitempty"`
	Blockout   *Blockout   `json:"blockout,omitempty"`
	TileLayers []TileLayer `json:"tileLayers,omitempty"`
}
type Project struct {
	Version        int             `json:"version"`
	ID             string          `json:"id"`
	Name           string          `json:"name"`
	Scenes         []Scene         `json:"scenes"`
	ArtworkImports []ArtworkImport `json:"artworkImports,omitempty"`
}
type Snapshot struct {
	Revision string  `json:"revision"`
	Project  Project `json:"project"`
}

var idPattern = regexp.MustCompile(`^[a-z][a-z0-9-]*$`)
var sceneColorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
var assetPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]+\.png$`)

func Load(path string) (Snapshot, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Snapshot{}, err
	}
	return decodeSnapshot(data)
}

func decodeSnapshot(data []byte) (Snapshot, error) {
	var p Project
	if err := json.Unmarshal(data, &p); err != nil {
		return Snapshot{}, err
	}
	if p.Version != projectVersion || !idPattern.MatchString(p.ID) || p.Name == "" || p.Scenes == nil {
		return Snapshot{}, fmt.Errorf("invalid project header")
	}
	if err := validateArtworkImports(p.ArtworkImports); err != nil {
		return Snapshot{}, err
	}
	importedIDs := map[string]bool{}
	for _, pack := range p.ArtworkImports {
		for _, asset := range pack.Assets {
			importedIDs[asset.ID] = true
		}
	}
	ids := map[string]bool{}
	for _, s := range p.Scenes {
		if ids[s.ID] || !idPattern.MatchString(s.ID) || s.Name == "" ||
			(s.Art != "" && !assetPattern.MatchString(s.Art)) || (s.Color != "" && !sceneColorPattern.MatchString(s.Color)) ||
			!validSceneDimensions(s.Width, s.Height) || s.Actors == nil {
			return Snapshot{}, fmt.Errorf("invalid scene %q", s.ID)
		}
		if s.Blockout != nil {
			if err := validateBlockout(s, *s.Blockout); err != nil {
				return Snapshot{}, fmt.Errorf("scene %q: %w", s.Name, err)
			}
		}
		if err := validateTileLayers(s); err != nil {
			return Snapshot{}, fmt.Errorf("scene %q: %w", s.Name, err)
		}
		for _, layer := range s.TileLayers {
			for _, region := range layer.Tiles {
				if managedArtworkID("tile", region.Tile) && !importedIDs[region.Tile] {
					return Snapshot{}, fmt.Errorf("unknown imported tile %q in scene %q", region.Tile, s.Name)
				}
			}
		}
		ids[s.ID] = true
		actors := map[string]bool{}
		for _, a := range s.Actors {
			if actors[a.ID] || !idPattern.MatchString(a.ID) || a.Name == "" ||
				(!artworkReference("sprite", a.Sprite) && !assetPattern.MatchString(a.Sprite)) ||
				(managedArtworkID("sprite", a.Sprite) && !importedIDs[a.Sprite]) ||
				a.Width < 1 || a.Height < 1 || a.X < 0 || a.Y < 0 ||
				a.Width > s.Width*pixelsPerTile-a.X || a.Height > s.Height*pixelsPerTile-a.Y {
				return Snapshot{}, fmt.Errorf("invalid actor %q in %s", a.ID, s.ID)
			}
			actors[a.ID] = true
		}
	}
	if err := validateConnections(p); err != nil {
		return Snapshot{}, err
	}
	return Snapshot{fmt.Sprintf("%x", sha256.Sum256(data)), p}, nil
}
