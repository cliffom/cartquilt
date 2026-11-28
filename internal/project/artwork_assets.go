package project

import (
	"image/png"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

type ArtworkAsset struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Kind   string `json:"kind"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

var starterArtwork = []ArtworkAsset{
	{"floor", "Floor", "tile", pixelsPerTile, pixelsPerTile},
	{"wall", "Wall", "tile", pixelsPerTile, pixelsPerTile},
	{"doorway", "Doorway", "tile", pixelsPerTile, pixelsPerTile},
	{"rug", "Rug", "tile", pixelsPerTile, pixelsPerTile},
	{starterCourier, "Courier", "sprite", courierWidth, courierHeight},
}

func artworkReference(kind, id string) bool {
	for _, asset := range starterArtwork {
		if asset.Kind == kind && asset.ID == id {
			return true
		}
	}
	name, ok := strings.CutPrefix(id, kind+":")
	return (ok && assetPattern.MatchString(name)) || managedArtworkID(kind, id)
}

func OpenArtworkFile(manifest, kind, name string) (*os.File, error) {
	if (kind != "tile" && kind != "sprite") || !assetPattern.MatchString(name) {
		return nil, fs.ErrNotExist
	}
	root, err := os.OpenRoot(filepath.Dir(manifest))
	if err != nil {
		return nil, err
	}
	defer root.Close()
	path := filepath.Join("assets", kind+"s", name)
	before, err := root.Lstat(path)
	if err != nil || !before.Mode().IsRegular() {
		return nil, fs.ErrNotExist
	}
	file, err := root.Open(path)
	if err != nil {
		return nil, err
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || !os.SameFile(before, info) {
		file.Close()
		return nil, fs.ErrNotExist
	}
	return file, nil
}

func resolveArtworkAsset(manifest string, current Project, kind, id string) (ArtworkAsset, error) {
	if managedArtworkID(kind, id) {
		if asset, ok := findImportedArtwork(current, id); ok {
			if _, err := readArtworkBlob(manifest, asset.Image); err == nil {
				return asset.ArtworkAsset, nil
			}
		}
		return ArtworkAsset{}, artworkError("the imported artwork is unavailable or has changed on disk")
	}
	for _, asset := range starterArtwork {
		if asset.Kind == kind && asset.ID == id {
			return asset, nil
		}
	}
	name, ok := strings.CutPrefix(id, kind+":")
	if !ok {
		return ArtworkAsset{}, artworkError("choose an asset from the project library")
	}
	file, err := OpenArtworkFile(manifest, kind, name)
	if err != nil {
		return ArtworkAsset{}, artworkError("the artwork file is unavailable")
	}
	defer file.Close()
	config, err := png.DecodeConfig(file)
	if err != nil || config.Width < 1 || config.Height < 1 ||
		config.Width > maxSceneTiles*pixelsPerTile || config.Height > maxSceneTiles*pixelsPerTile ||
		(kind == "tile" && (config.Width != pixelsPerTile || config.Height != pixelsPerTile)) {
		return ArtworkAsset{}, artworkError("use an 8×8 PNG for a tile or a PNG within the scene size for a sprite")
	}
	label := strings.NewReplacer("-", " ", "_", " ").Replace(strings.TrimSuffix(name, ".png"))
	return ArtworkAsset{id, label, kind, config.Width, config.Height}, nil
}

func ListArtworkAssets(manifest string) ([]ArtworkAsset, error) {
	current, err := Load(manifest)
	if err != nil {
		return nil, err
	}
	assets := append([]ArtworkAsset(nil), starterArtwork...)
	for _, pack := range current.Project.ArtworkImports {
		for _, asset := range pack.Assets {
			assets = append(assets, asset.ArtworkAsset)
		}
	}
	root, err := os.OpenRoot(filepath.Dir(manifest))
	if err != nil {
		return nil, err
	}
	defer root.Close()
	for _, kind := range []string{"tile", "sprite"} {
		entries, err := fs.ReadDir(root.FS(), filepath.Join("assets", kind+"s"))
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		for _, entry := range entries {
			if entry.Type().IsRegular() && assetPattern.MatchString(entry.Name()) {
				if asset, err := resolveArtworkAsset(manifest, current.Project, kind, kind+":"+entry.Name()); err == nil {
					assets = append(assets, asset)
				}
			}
		}
	}
	return assets, nil
}

func ReadImportedArtwork(path, kind, name string) ([]byte, bool, error) {
	id := kind + ":" + name
	if (kind != "tile" && kind != "sprite") || !managedArtworkID(kind, id) {
		return nil, false, nil
	}
	saved, err := Load(path)
	if err != nil {
		return nil, true, err
	}
	asset, ok := findImportedArtwork(saved.Project, id)
	if !ok {
		return nil, true, fs.ErrNotExist
	}
	data, err := readArtworkBlob(path, asset.Image)
	return data, true, err
}
