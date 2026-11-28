package project

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
)

func TestImportsAndExportsTiledScene(t *testing.T) {
	created, err := Create(CreateInput{Name: "Imports", Path: filepath.Join(t.TempDir(), "room")})
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile("../../tests/fixtures/atlas/room.png")
	if err != nil {
		t.Fatal(err)
	}
	metadata, err := os.ReadFile("../../tests/fixtures/atlas/room.atlas.json")
	if err != nil {
		t.Fatal(err)
	}
	plain, err := ImportArtwork(created.Path, ImportArtworkInput{BaseRevision: created.Revision, Kind: "tiles", PNGName: "plain.png", PNG: data})
	if err != nil || len(plain.Project.ArtworkImports) != 1 || len(plain.Project.ArtworkImports[0].Assets) != 4 {
		t.Fatalf("unexpected PNG import: %+v, %v", plain, err)
	}
	atlasInput := ImportArtworkInput{BaseRevision: created.Revision, Kind: "gbc-atlas", PNGName: "room.png", PNG: data, Manifest: metadata}
	if _, err := ImportArtwork(created.Path, atlasInput); !errors.Is(err, ErrStaleRevision) {
		t.Fatalf("stale import: %v", err)
	}
	atlasInput.BaseRevision = plain.Revision
	atlasInput.PNGName = "wrong.png"
	if _, err := ImportArtwork(created.Path, atlasInput); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("filename mismatch: %v", err)
	}
	atlasInput.PNGName = "room.png"
	imported, err := ImportArtwork(created.Path, atlasInput)
	if err != nil {
		t.Fatal(err)
	}
	pack := imported.Project.ArtworkImports[1]
	if len(pack.Assets) != 3 || pack.Assets[2].Kind != "sprite" || !bytes.Contains(pack.Atlas, []byte(`"duration_ms"`)) {
		t.Fatalf("unexpected imported atlas: %+v", pack)
	}
	sprite, err := ImportArtwork(created.Path, ImportArtworkInput{BaseRevision: imported.Revision, Kind: "sprite", PNGName: "sprite.png", PNG: data})
	if err != nil || len(sprite.Project.ArtworkImports) != 3 || len(sprite.Project.ArtworkImports[2].Assets) != 1 {
		t.Fatalf("unexpected sprite import: %+v, %v", sprite, err)
	}
	standalone := sprite.Project.ArtworkImports[2].Assets[0]
	blob, managed, err := ReadImportedArtwork(created.Path, "sprite", strings.TrimPrefix(standalone.ID, "sprite:"))
	if err != nil || !managed || !bytes.Equal(blob, data) {
		t.Fatalf("the standalone sprite did not retain its source PNG: %v", err)
	}
	room, err := AddScene(created.Path, AddSceneInput{BaseRevision: sprite.Revision, Name: "Room", Width: 4, Height: 4})
	if err != nil {
		t.Fatal(err)
	}
	apply := func(edit ArtworkEdit) Scene {
		t.Helper()
		updated, err := ApplySceneAction(created.Path, room.SceneID, SceneActionInput{BaseRevision: room.Revision, Action: "artwork", Artwork: &edit})
		if err != nil {
			t.Fatal(err)
		}
		room = updated
		return room.Project.Scenes[0]
	}
	layer := apply(ArtworkEdit{Op: "add-layer", Name: "Floor"}).TileLayers[0]
	apply(ArtworkEdit{Op: "paint", LayerID: layer.ID, Tile: pack.Assets[0].ID, Area: &TileArea{Point{0, 0}, 2, 1}})
	actor := apply(ArtworkEdit{Op: "place-sprite", Sprite: pack.Assets[2].ID, Area: &TileArea{Point{1, 1}, 1, 1}}).Actors[0]
	exported, err := ExportTiledScene(created.Path, room.SceneID, fstest.MapFS{})
	if err != nil {
		t.Fatal(err)
	}
	archive, err := zip.NewReader(bytes.NewReader(exported), int64(len(exported)))
	if err != nil {
		t.Fatal(err)
	}
	read := func(name string) []byte {
		t.Helper()
		data, err := fs.ReadFile(archive, name)
		if err != nil {
			t.Fatal(err)
		}
		return data
	}
	var level struct {
		Layers []struct {
			Data    []int `json:"data"`
			Objects []struct {
				GID int `json:"gid"`
				X   int `json:"x"`
				Y   int `json:"y"`
			} `json:"objects"`
		} `json:"layers"`
		Tilesets []struct {
			Source string `json:"source"`
		} `json:"tilesets"`
	}
	if err := json.Unmarshal(read(room.SceneID+".tmj"), &level); err != nil {
		t.Fatal(err)
	}
	if len(level.Layers) != 2 || len(level.Layers[0].Data) != 16 || level.Layers[0].Data[1] != 1 ||
		len(level.Layers[1].Objects) != 1 || level.Layers[1].Objects[0].GID != 2 ||
		level.Layers[1].Objects[0].X != actor.X || level.Layers[1].Objects[0].Y != actor.Y {
		t.Fatalf("unexpected export map: %+v", level)
	}
	tileset := read(level.Tilesets[0].Source)
	if !bytes.Contains(tileset, []byte(pack.Assets[2].ID)) {
		t.Fatalf("expected asset identity in the tileset: %s", tileset)
	}
	for _, name := range []string{"images/asset-0.png", "images/asset-1.png"} {
		if !strings.HasPrefix(string(read(name)), "\x89PNG") {
			t.Fatalf("missing PNG contents in %s", name)
		}
	}
}
