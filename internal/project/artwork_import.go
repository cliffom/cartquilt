package project

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

const (
	maxImportedPixels = 16 * 1024 * 1024
	maxImportedTiles  = 4096
	artworkBlobDir    = "assets/imports"
)

var pngDigest = regexp.MustCompile("^[a-f0-9]{64}$")
var importedArtworkID = regexp.MustCompile(fmt.Sprintf("^asset-[a-f0-9]{%d}$", 2*objectIDBytes))

type ArtworkImport struct {
	ID     string            `json:"id"`
	Name   string            `json:"name"`
	Source string            `json:"source"`
	Atlas  json.RawMessage   `json:"gbcAtlas,omitempty"`
	Assets []ImportedArtwork `json:"assets"`
}

type ImportedArtwork struct {
	ArtworkAsset
	Image  string `json:"image"`
	Region string `json:"region,omitempty"`
}

type ImportArtworkInput struct {
	BaseRevision string
	Kind         string
	PNGName      string
	PNG          []byte
	Manifest     []byte
}

type artworkCut struct {
	name   string
	kind   string
	bounds image.Rectangle
	region string
}

func managedArtworkID(kind, id string) bool {
	name, ok := strings.CutPrefix(id, kind+":")
	return ok && importedArtworkID.MatchString(name)
}

func validateArtworkImports(imports []ArtworkImport) error {
	ids := map[string]bool{}
	for _, pack := range imports {
		if !idPattern.MatchString(pack.ID) || ids[pack.ID] || pack.Name == "" || !pngDigest.MatchString(pack.Source) || len(pack.Assets) == 0 {
			return artworkError("invalid artwork import")
		}
		ids[pack.ID] = true
		for _, asset := range pack.Assets {
			if (asset.Kind != "tile" && asset.Kind != "sprite") || !managedArtworkID(asset.Kind, asset.ID) ||
				ids[asset.ID] || !pngDigest.MatchString(asset.Image) || asset.Name == "" ||
				asset.Width < 1 || asset.Height < 1 || asset.Width > maxSceneTiles*pixelsPerTile || asset.Height > maxSceneTiles*pixelsPerTile ||
				(asset.Kind == "tile" && (asset.Width != pixelsPerTile || asset.Height != pixelsPerTile)) {
				return artworkError("invalid imported artwork entry")
			}
			ids[asset.ID] = true
		}
	}
	return nil
}

func findImportedArtwork(project Project, id string) (ImportedArtwork, bool) {
	for _, pack := range project.ArtworkImports {
		for _, asset := range pack.Assets {
			if asset.ID == id {
				return asset, true
			}
		}
	}
	return ImportedArtwork{}, false
}

func artworkDigest(data []byte) string { return fmt.Sprintf("%x", sha256.Sum256(data)) }

func readArtworkBlob(path, digest string) ([]byte, error) {
	if !pngDigest.MatchString(digest) {
		return nil, fs.ErrNotExist
	}
	path, err := filepath.EvalSymlinks(path)
	if err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(filepath.Dir(path))
	if err != nil {
		return nil, err
	}
	defer root.Close()
	data, err := root.ReadFile(artworkBlobDir + "/" + digest + ".png")
	if err != nil {
		return nil, err
	}
	if artworkDigest(data) != digest {
		return nil, artworkError("the imported artwork file changed on disk")
	}
	return data, nil
}

func writeArtworkBlobs(path string, blobs map[string][]byte) error {
	root, err := os.OpenRoot(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer root.Close()
	if err := root.MkdirAll(artworkBlobDir, privateFolderMode); err != nil {
		return err
	}
	for digest, data := range blobs {
		target := artworkBlobDir + "/" + digest + ".png"
		saved, err := root.ReadFile(target)
		if err == nil {
			if artworkDigest(saved) != digest {
				return artworkError("an imported artwork file changed on disk")
			}
			continue
		}
		if !os.IsNotExist(err) {
			return err
		}
		temp := artworkBlobDir + "/" + newObjectID("pending")
		file, err := root.OpenFile(temp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, privateFileMode)
		if err != nil {
			return err
		}
		_, writeErr := file.Write(data)
		closeErr := file.Close()
		if writeErr != nil || closeErr != nil {
			root.Remove(temp)
			if writeErr != nil {
				return writeErr
			}
			return closeErr
		}
		if err := root.Rename(temp, target); err != nil {
			root.Remove(temp)
			return err
		}
	}
	return nil
}

func ImportArtwork(path string, input ImportArtworkInput) (Snapshot, error) {
	config, err := png.DecodeConfig(bytes.NewReader(input.PNG))
	if err != nil || config.Width < 1 || config.Height < 1 ||
		config.Width > maxSceneTiles*pixelsPerTile || config.Height > maxSceneTiles*pixelsPerTile ||
		config.Width > maxImportedPixels/config.Height {
		return Snapshot{}, artworkError("choose a valid PNG within the import size limit")
	}
	img, err := png.Decode(bytes.NewReader(input.PNG))
	if err != nil {
		return Snapshot{}, artworkError("could not decode the PNG")
	}
	name := strings.TrimSpace(strings.TrimSuffix(filepath.Base(input.PNGName), filepath.Ext(input.PNGName)))
	if name == "" {
		name = "Artwork"
	}
	var cuts []artworkCut
	pack := ArtworkImport{ID: newObjectID("import"), Name: name, Source: artworkDigest(input.PNG)}
	switch input.Kind {
	case "tiles":
		if config.Width%pixelsPerTile != 0 || config.Height%pixelsPerTile != 0 ||
			config.Width/pixelsPerTile*(config.Height/pixelsPerTile) > maxImportedTiles {
			return Snapshot{}, artworkError("the tile sheet must contain up to 4096 complete 8×8 tiles")
		}
		cuts = gridCuts(name, img.Bounds())
	case "sprite":
		cuts = []artworkCut{{name: name, kind: "sprite", bounds: img.Bounds()}}
	case "gbc-atlas":
		cuts, name, err = readGBCAtlas(img, input.PNGName, input.Manifest)
		if err != nil {
			return Snapshot{}, err
		}
		pack.Name = name
		pack.Atlas = input.Manifest
	default:
		return Snapshot{}, artworkError("choose a tilesheet, sprite, or gbc-atlas pack")
	}
	blobs := map[string][]byte{pack.Source: input.PNG}
	for _, cut := range cuts {
		digest := pack.Source
		if cut.bounds != img.Bounds() {
			view := image.NewNRGBA(image.Rect(0, 0, cut.bounds.Dx(), cut.bounds.Dy()))
			for y := 0; y < view.Bounds().Dy(); y++ {
				for x := 0; x < view.Bounds().Dx(); x++ {
					view.Set(x, y, img.At(x+cut.bounds.Min.X, y+cut.bounds.Min.Y))
				}
			}
			var encoded bytes.Buffer
			if err := png.Encode(&encoded, view); err != nil {
				return Snapshot{}, err
			}
			digest = artworkDigest(encoded.Bytes())
			blobs[digest] = encoded.Bytes()
		}
		asset := ArtworkAsset{ID: cut.kind + ":" + newObjectID("asset"), Name: cut.name, Kind: cut.kind, Width: cut.bounds.Dx(), Height: cut.bounds.Dy()}
		pack.Assets = append(pack.Assets, ImportedArtwork{ArtworkAsset: asset, Image: digest, Region: cut.region})
	}
	result, err := writeManifest(path, input.BaseRevision, func(path string, current Project, fields map[string]json.RawMessage) (string, error) {
		imports := append(current.ArtworkImports, pack)
		if err := validateArtworkImports(imports); err != nil {
			return "", err
		}
		if err := writeArtworkBlobs(path, blobs); err != nil {
			return "", err
		}
		fields["artworkImports"], err = json.Marshal(imports)
		return "", err
	})
	return result.Snapshot, err
}

func gridCuts(name string, bounds image.Rectangle) []artworkCut {
	var cuts []artworkCut
	for y := bounds.Min.Y; y < bounds.Max.Y; y += pixelsPerTile {
		for x := bounds.Min.X; x < bounds.Max.X; x += pixelsPerTile {
			label := name
			if bounds.Dx() != pixelsPerTile || bounds.Dy() != pixelsPerTile {
				label = fmt.Sprintf("%s (%d, %d)", name, (x-bounds.Min.X)/pixelsPerTile+1, (y-bounds.Min.Y)/pixelsPerTile+1)
			}
			cuts = append(cuts, artworkCut{name: label, kind: "tile", bounds: image.Rect(x, y, x+pixelsPerTile, y+pixelsPerTile)})
		}
	}
	return cuts
}
