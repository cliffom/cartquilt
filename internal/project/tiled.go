package project

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"image/png"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

type tiledRecord map[string]any

func tiledProperties(values ...string) []tiledRecord {
	properties := make([]tiledRecord, 0, len(values)/2)
	for i := 0; i < len(values); i += 2 {
		properties = append(properties, tiledRecord{"name": values[i], "type": "string", "value": values[i+1]})
	}
	return properties
}

func exportAssetPNG(path string, saved Project, web fs.FS, kind, id string) ([]byte, error) {
	for _, asset := range starterArtwork {
		if asset.Kind == kind && asset.ID == id {
			name := id
			if id == starterCourier {
				name = "courier"
			}
			return fs.ReadFile(web, "starter/"+name+".png")
		}
	}
	if asset, ok := findImportedArtwork(saved, id); ok {
		return readArtworkBlob(path, asset.Image)
	}
	if name, ok := strings.CutPrefix(id, kind+":"); ok {
		file, err := OpenArtworkFile(path, kind, name)
		if err != nil {
			return nil, err
		}
		defer file.Close()
		return io.ReadAll(file)
	}
	if !assetPattern.MatchString(id) {
		return nil, fs.ErrNotExist
	}
	root, err := os.OpenRoot(filepath.Dir(path))
	if err != nil {
		return nil, err
	}
	defer root.Close()
	return root.ReadFile(id)
}

func ExportTiledScene(path, id string, web fs.FS) ([]byte, error) {
	saved, err := Load(path)
	if err != nil {
		return nil, err
	}
	for _, scene := range saved.Project.Scenes {
		if scene.ID == id {
			return exportTiledScene(path, saved, scene, web)
		}
	}
	return nil, ErrSceneNotFound
}

func exportTiledScene(path string, saved Snapshot, scene Scene, web fs.FS) ([]byte, error) {
	var output bytes.Buffer
	archive := zip.NewWriter(&output)
	defer archive.Close()
	writeFile := func(name string, data []byte) error {
		entry, err := archive.Create(name)
		if err != nil {
			return err
		}
		_, err = entry.Write(data)
		return err
	}
	writeJSON := func(name string, data any) error {
		encoded, err := json.MarshalIndent(data, "", "  ")
		if err != nil {
			return err
		}
		return writeFile(name, encoded)
	}
	layers := []tiledRecord{}
	addLayer := func(layer tiledRecord) {
		layer["id"] = len(layers) + 1
		layer["x"], layer["y"], layer["opacity"] = 0, 0, 1
		layers = append(layers, layer)
	}
	if scene.Art != "" {
		data, err := exportAssetPNG(path, saved.Project, web, "background", scene.Art)
		if err != nil {
			return nil, fmt.Errorf("export background %s: %w", scene.Art, err)
		}
		if err := writeFile("images/background.png", data); err != nil {
			return nil, err
		}
		addLayer(tiledRecord{"name": "Background", "type": "imagelayer", "visible": true, "image": "images/background.png"})
	}
	tileImages := []tiledRecord{}
	gids := map[string]int{}
	maxWidth, maxHeight := pixelsPerTile, pixelsPerTile
	addAsset := func(kind, id string) (int, error) {
		if gid, ok := gids[id]; ok {
			return gid, nil
		}
		data, err := exportAssetPNG(path, saved.Project, web, kind, id)
		if err != nil {
			return 0, fmt.Errorf("export asset %s: %w", id, err)
		}
		config, err := png.DecodeConfig(bytes.NewReader(data))
		if err != nil {
			return 0, fmt.Errorf("export asset %s: invalid PNG", id)
		}
		index := len(tileImages)
		imagePath := fmt.Sprintf("images/asset-%d.png", index)
		if err := writeFile(imagePath, data); err != nil {
			return 0, err
		}
		tileImages = append(tileImages, tiledRecord{
			"id": index, "image": imagePath, "imagewidth": config.Width, "imageheight": config.Height,
			"properties": tiledProperties("cartquiltAssetId", id),
		})
		maxWidth, maxHeight = max(maxWidth, config.Width), max(maxHeight, config.Height)
		gids[id] = index + 1
		return index + 1, nil
	}
	for _, layer := range scene.TileLayers {
		data := make([]int, scene.Width*scene.Height)
		for _, region := range layer.Tiles {
			gid, err := addAsset("tile", region.Tile)
			if err != nil {
				return nil, err
			}
			for y := region.Y; y < region.Y+region.Height; y++ {
				for x := region.X; x < region.X+region.Width; x++ {
					data[y*scene.Width+x] = gid
				}
			}
		}
		addLayer(tiledRecord{"name": layer.Name, "type": "tilelayer", "visible": !layer.Hidden, "data": data, "width": scene.Width, "height": scene.Height,
			"properties": tiledProperties("cartquiltLayerId", layer.ID)})
	}
	nextObject := 1
	object := func(name, kind string, x, y, width, height int, properties ...string) tiledRecord {
		item := tiledRecord{"id": nextObject, "name": name, "type": kind, "x": x, "y": y, "width": width, "height": height, "rotation": 0, "visible": true,
			"properties": tiledProperties(properties...)}
		nextObject++
		return item
	}
	addObjectLayer := func(name string, visible bool, objects []tiledRecord) {
		if len(objects) > 0 {
			addLayer(tiledRecord{"name": name, "type": "objectgroup", "draworder": "index", "visible": visible, "objects": objects})
		}
	}
	var actors, blockout, connections []tiledRecord
	for _, actor := range scene.Actors {
		gid, err := addAsset("sprite", actor.Sprite)
		if err != nil {
			return nil, err
		}
		item := object(actor.Name, "actor", actor.X, actor.Y, actor.Width, actor.Height, "cartquiltId", actor.ID, "cartquiltSprite", actor.Sprite)
		item["gid"] = gid
		actors = append(actors, item)
	}
	addObjectLayer("Actors", true, actors)
	profile := DefaultMovementProfile
	if scene.Blockout != nil {
		profile = scene.Blockout.Profile
		for _, region := range scene.Blockout.Terrain {
			blockout = append(blockout, object(region.Kind, "terrain", region.X*pixelsPerTile, region.Y*pixelsPerTile, region.Width*pixelsPerTile, region.Height*pixelsPerTile,
				"cartquiltKind", region.Kind))
		}
		for _, marker := range scene.Blockout.Elements {
			blockout = append(blockout, object(marker.Label, "blockout", marker.X*pixelsPerTile, marker.Y*pixelsPerTile, marker.Width*pixelsPerTile, marker.Height*pixelsPerTile,
				"cartquiltId", marker.ID, "cartquiltKind", marker.Kind))
		}
	}
	addObjectLayer("Blockout", scene.Art == "" && len(gids) == 0, blockout)
	for _, entrance := range scene.Entrances {
		item := object(entrance.Name, "entrance", entrance.X*pixelsPerTile, entrance.Y*pixelsPerTile, 0, 0, "cartquiltId", entrance.ID)
		item["point"] = true
		connections = append(connections, item)
	}
	for _, exit := range scene.Exits {
		connections = append(connections, object(exit.Name, "exit", exit.X*pixelsPerTile, exit.Y*pixelsPerTile, exit.Width*pixelsPerTile, exit.Height*pixelsPerTile,
			"cartquiltId", exit.ID, "destinationScene", exit.Destination.SceneID, "destinationEntrance", exit.Destination.EntranceID))
	}
	addObjectLayer("Connections", false, connections)
	tilesets := []tiledRecord{}
	if len(tileImages) > 0 {
		const tilesetPath = "artwork.tsj"
		if err := writeJSON(tilesetPath, tiledRecord{"type": "tileset", "version": "1.10", "name": "Cartquilt artwork", "tilewidth": maxWidth, "tileheight": maxHeight,
			"tilecount": len(tileImages), "columns": 0, "objectalignment": "topleft", "tiles": tileImages}); err != nil {
			return nil, err
		}
		tilesets = append(tilesets, tiledRecord{"firstgid": 1, "source": tilesetPath})
	}
	if err := writeJSON(scene.ID+".tmj", tiledRecord{
		"type": "map", "version": "1.10", "orientation": "orthogonal", "renderorder": "right-down", "infinite": false,
		"width": scene.Width, "height": scene.Height, "tilewidth": pixelsPerTile, "tileheight": pixelsPerTile, "nextlayerid": len(layers) + 1,
		"nextobjectid": nextObject, "layers": layers, "tilesets": tilesets,
		"properties": tiledProperties("cartquiltProjectId", saved.Project.ID, "cartquiltSceneId", scene.ID, "cartquiltSceneName", scene.Name, "cartquiltRevision", saved.Revision, "movementProfile", profile),
	}); err != nil {
		return nil, err
	}
	if err := archive.Close(); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}
