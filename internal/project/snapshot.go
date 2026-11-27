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
	ID     string  `json:"id"`
	Name   string  `json:"name"`
	Art    string  `json:"art"`
	Width  int     `json:"width"`
	Height int     `json:"height"`
	World  Point   `json:"world"`
	Actors []Actor `json:"actors"`
}
type Project struct {
	Version int     `json:"version"`
	ID      string  `json:"id"`
	Name    string  `json:"name"`
	Scenes  []Scene `json:"scenes"`
}
type Snapshot struct {
	Revision string  `json:"revision"`
	Project  Project `json:"project"`
}

var idPattern = regexp.MustCompile(`^[a-z][a-z0-9-]*$`)
var assetPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]+\.png$`)

func Load(path string) (Snapshot, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Snapshot{}, err
	}
	var p Project
	if err = json.Unmarshal(data, &p); err != nil {
		return Snapshot{}, err
	}
	if p.Version != 1 || !idPattern.MatchString(p.ID) || p.Name == "" || p.Scenes == nil {
		return Snapshot{}, fmt.Errorf("invalid project header")
	}
	ids := map[string]bool{}
	for _, s := range p.Scenes {
		if ids[s.ID] || !idPattern.MatchString(s.ID) || s.Name == "" || !assetPattern.MatchString(s.Art) || s.Width < 1 || s.Height < 1 || s.Width > 1024 || s.Height > 1024 || s.Actors == nil {
			return Snapshot{}, fmt.Errorf("invalid scene %q", s.ID)
		}
		ids[s.ID] = true
		actors := map[string]bool{}
		for _, a := range s.Actors {
			if actors[a.ID] || !idPattern.MatchString(a.ID) || a.Name == "" || !assetPattern.MatchString(a.Sprite) || a.Width < 1 || a.Height < 1 || a.X < 0 || a.Y < 0 || a.Width > s.Width*8-a.X || a.Height > s.Height*8-a.Y {
				return Snapshot{}, fmt.Errorf("invalid actor %q in %s", a.ID, s.ID)
			}
			actors[a.ID] = true
		}
	}
	return Snapshot{fmt.Sprintf("%x", sha256.Sum256(data)), p}, nil
}
