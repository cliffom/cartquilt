package project

import (
	"errors"
	"path/filepath"
	"testing"
)

func TestArtworkPersistsLayersAndPlacedCourier(t *testing.T) {
	created, err := Create(CreateInput{Name: "Room demo", Path: filepath.Join(t.TempDir(), "room")})
	if err != nil {
		t.Fatal(err)
	}
	room, err := AddScene(created.Path, AddSceneInput{BaseRevision: created.Revision, Name: "Room", Width: 6, Height: 5})
	if err != nil {
		t.Fatal(err)
	}
	initial := room.Revision
	apply := func(edit ArtworkEdit) Scene {
		t.Helper()
		updated, err := ApplySceneAction(created.Path, room.SceneID, SceneActionInput{BaseRevision: room.Revision, Action: "artwork", Artwork: &edit})
		if err != nil {
			t.Fatal(err)
		}
		room = updated
		return room.Project.Scenes[0]
	}
	ground := apply(ArtworkEdit{Op: "add-layer", Name: "Ground"}).TileLayers[0].ID
	apply(ArtworkEdit{Op: "paint", LayerID: ground, Tile: "floor", Area: &TileArea{Point{1, 1}, 4, 3}})
	apply(ArtworkEdit{Op: "paint", LayerID: ground, Tile: "doorway", Area: &TileArea{Point{2, 1}, 1, 1}})
	props := apply(ArtworkEdit{Op: "add-layer", Name: "Props"}).TileLayers[1].ID
	apply(ArtworkEdit{Op: "paint", LayerID: props, Tile: "rug", Area: &TileArea{Point{2, 1}, 1, 1}})
	apply(ArtworkEdit{Op: "lower-layer", LayerID: props})
	apply(ArtworkEdit{Op: "toggle-layer", LayerID: props})
	apply(ArtworkEdit{Op: "place-sprite", Sprite: starterCourier, Area: &TileArea{Point{2, 2}, 1, 1}})

	for _, attempt := range []struct {
		revision string
		edit     ArtworkEdit
		want     error
	}{
		{initial, ArtworkEdit{Op: "remove-layer", LayerID: ground}, ErrStaleRevision},
		{room.Revision, ArtworkEdit{Op: "place-sprite", Sprite: starterCourier, Area: &TileArea{Point{5, 4}, 1, 1}}, ErrInvalidInput},
		{room.Revision, ArtworkEdit{Op: "paint", LayerID: props, Tile: "floor", Area: &TileArea{Point{1, 1}, 1, 1}}, ErrInvalidInput},
	} {
		_, err := ApplySceneAction(created.Path, room.SceneID, SceneActionInput{BaseRevision: attempt.revision, Action: "artwork", Artwork: &attempt.edit})
		if !errors.Is(err, attempt.want) {
			t.Fatalf("apply %s: got %v, want %v", attempt.edit.Op, err, attempt.want)
		}
	}
	snapshot, err := Load(created.Path)
	if err != nil {
		t.Fatal(err)
	}
	scene := snapshot.Project.Scenes[0]
	if snapshot.Revision != room.Revision || scene.Blockout != nil || len(scene.TileLayers) != 2 {
		t.Fatalf("unexpected saved room: %+v", scene)
	}
	if layer := scene.TileLayers[0]; layer.ID != props || !layer.Hidden || len(layer.Tiles) != 1 {
		t.Fatalf("unexpected overlay: %+v", layer)
	}
	if layer := scene.TileLayers[1]; layer.ID != ground || layer.Tiles[len(layer.Tiles)-1].Tile != "doorway" {
		t.Fatalf("unexpected ground: %+v", layer)
	}
	if len(scene.Actors) != 1 || scene.Actors[0].Sprite != starterCourier || scene.Actors[0].Point != (Point{16, 16}) {
		t.Fatalf("unexpected actors: %+v", scene.Actors)
	}
	id := scene.Actors[0].ID
	if actor := apply(ArtworkEdit{Op: "move-actor", ActorID: id, Position: &Point{4, 8}}).Actors[0]; actor.Point != (Point{4, 8}) {
		t.Fatalf("unexpected actor position: %+v", actor)
	}
	if got := apply(ArtworkEdit{Op: "remove-actor", ActorID: id}); len(got.Actors) != 0 || len(got.TileLayers) != 2 {
		t.Fatalf("unexpected scene after removing actor: %+v", got)
	}
}

func TestArtworkMoveKeepsOtherRegionsAndRejectsOverlap(t *testing.T) {
	original := PaintedTile{Tile: "floor", TileArea: TileArea{Point{1, 1}, 2, 1}}
	wall := PaintedTile{Tile: "wall", TileArea: TileArea{Point{4, 1}, 1, 1}}
	scene := Scene{Width: 6, Height: 4, TileLayers: []TileLayer{{ID: "room", Tiles: []PaintedTile{original, wall}}}}
	edit := ArtworkEdit{Op: "move-tile", LayerID: "room", Tile: "floor", Area: &original.TileArea, Position: &Point{3, 1}}
	if _, err := editTileLayers("", Project{}, scene, edit); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected overlapping move to fail: %v", err)
	}
	edit.Position = &Point{5, 2}
	if _, err := editTileLayers("", Project{}, scene, edit); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected out-of-bounds move to fail: %v", err)
	}
	edit.Position = &Point{2, 1}
	layers, err := editTileLayers("", Project{}, scene, edit)
	if err != nil || layers[0].Tiles[0].Point != *edit.Position ||
		layers[0].Tiles[0].Width != original.Width || layers[0].Tiles[1] != wall {
		t.Fatalf("unexpected moved layer: %+v, %v", layers, err)
	}
}
