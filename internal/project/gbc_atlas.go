package project

import (
	"encoding/json"
	"image"
	"image/color"
	"path"
	"regexp"
	"slices"
	"strings"
)

const (
	maxAtlasCells    = 256
	maxAtlasAxis     = 256
	maxAtlasRegions  = 255
	maxAtlasFrames   = 255
	maxAtlasPalettes = 8
	atlasColorMax    = 31
	maxAtlasDuration = 65535
)

var atlasIdentifier = regexp.MustCompile("^[a-z][a-z0-9_]*$")

type atlasRegion struct {
	Name     string `json:"name"`
	Kind     string `json:"kind"`
	X        int    `json:"x"`
	Y        int    `json:"y"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
	Origin   []int  `json:"origin"`
	Duration *int   `json:"duration_ms"`
}

type atlasManifest struct {
	Version      int           `json:"version"`
	ID           string        `json:"id"`
	PNG          string        `json:"png"`
	Palettes     [][][]int     `json:"palettes"`
	CellPalettes []int         `json:"cell_palettes"`
	Regions      []atlasRegion `json:"regions"`
	Animations   []struct {
		Name   string `json:"name"`
		Frames []struct {
			Region   string `json:"region"`
			Duration *int   `json:"duration_ms"`
		} `json:"frames"`
	} `json:"animations"`
}

func readGBCAtlas(img image.Image, pngName string, data []byte) ([]artworkCut, string, error) {
	var atlas atlasManifest
	if err := json.Unmarshal(data, &atlas); err != nil || atlas.Version != 1 || !atlasIdentifier.MatchString(atlas.ID) {
		return nil, "", artworkError("choose a gbc-atlas v1 manifest")
	}
	cleanPNG := path.Clean(atlas.PNG)
	if path.IsAbs(cleanPNG) || strings.HasPrefix(cleanPNG, "../") || strings.Contains(atlas.PNG, "\\") ||
		!strings.EqualFold(path.Ext(cleanPNG), ".png") || path.Base(cleanPNG) != pngName {
		return nil, "", artworkError("the PNG filename must match the atlas manifest")
	}
	width, height := img.Bounds().Dx(), img.Bounds().Dy()
	columns, rows := width/pixelsPerTile, height/pixelsPerTile
	if width > maxAtlasAxis || height > maxAtlasAxis || width%pixelsPerTile != 0 || height%pixelsPerTile != 0 ||
		columns*rows > maxAtlasCells || len(atlas.CellPalettes) != columns*rows {
		return nil, "", artworkError("the atlas must assign a palette to every 8×8 cell")
	}
	if len(atlas.Palettes) < 1 || len(atlas.Palettes) > maxAtlasPalettes {
		return nil, "", artworkError("the atlas must declare one to eight palettes")
	}
	palettes := make([][4]color.NRGBA, len(atlas.Palettes))
	for p, palette := range atlas.Palettes {
		if len(palette) != 4 {
			return nil, "", artworkError("each atlas palette must have four RGB5 entries")
		}
		for i, rgb := range palette {
			if len(rgb) != 3 || slices.ContainsFunc(rgb, func(v int) bool { return v < 0 || v > atlasColorMax }) {
				return nil, "", artworkError("atlas palette components must be RGB5 values from 0 to 31")
			}
			expand := func(v int) uint8 { return uint8((v*255 + atlasColorMax/2) / atlasColorMax) }
			palettes[p][i] = color.NRGBA{R: expand(rgb[0]), G: expand(rgb[1]), B: expand(rgb[2]), A: 255}
		}
	}
	for _, index := range atlas.CellPalettes {
		if index < 0 || index >= len(palettes) {
			return nil, "", artworkError("an atlas cell references an unknown palette")
		}
	}
	kinds := make([]string, columns*rows)
	if len(atlas.Regions) < 1 || len(atlas.Regions) > maxAtlasRegions {
		return nil, "", artworkError("the atlas must declare one to 255 regions")
	}
	regions := map[string]atlasRegion{}
	tileCells := map[image.Point]bool{}
	var cuts []artworkCut
	for _, region := range atlas.Regions {
		if !atlasIdentifier.MatchString(region.Name) || regions[region.Name].Name != "" ||
			(region.Kind != "tile" && region.Kind != "sprite") ||
			region.X < 0 || region.Y < 0 || region.Width < 1 || region.Height < 1 ||
			region.Width > width-region.X || region.Height > height-region.Y ||
			region.X%pixelsPerTile != 0 || region.Y%pixelsPerTile != 0 ||
			region.Width%pixelsPerTile != 0 || region.Height%pixelsPerTile != 0 ||
			(region.Kind == "sprite" && (region.Y%(2*pixelsPerTile) != 0 || region.Height%(2*pixelsPerTile) != 0)) {
			return nil, "", artworkError("invalid atlas region " + region.Name)
		}
		if region.Origin == nil {
			region.Origin = []int{0, 0}
		}
		if len(region.Origin) != 2 || region.Origin[0] < 0 || region.Origin[1] < 0 ||
			region.Origin[0] >= region.Width || region.Origin[1] >= region.Height ||
			(region.Duration != nil && (*region.Duration < 1 || *region.Duration > maxAtlasDuration)) {
			return nil, "", artworkError("invalid origin or duration in atlas region " + region.Name)
		}
		regions[region.Name] = region
		x1, y1 := region.X+region.Width, region.Y+region.Height
		for y := region.Y / pixelsPerTile; y < y1/pixelsPerTile; y++ {
			for x := region.X / pixelsPerTile; x < x1/pixelsPerTile; x++ {
				i := y*columns + x
				if kinds[i] != "" && kinds[i] != region.Kind {
					return nil, "", artworkError("tile and sprite atlas regions overlap")
				}
				if region.Kind == "sprite" && y%2 == 0 && atlas.CellPalettes[i] != atlas.CellPalettes[i+columns] {
					return nil, "", artworkError("each 8×16 sprite pair must share a palette")
				}
				kinds[i] = region.Kind
			}
		}
		bounds := image.Rect(region.X, region.Y, x1, y1)
		label := strings.ReplaceAll(region.Name, "_", " ")
		if region.Kind == "tile" {
			for _, cut := range gridCuts(label, bounds) {
				if tileCells[cut.bounds.Min] {
					continue
				}
				tileCells[cut.bounds.Min] = true
				cut.region = region.Name
				cuts = append(cuts, cut)
			}
		} else {
			cuts = append(cuts, artworkCut{name: label, kind: "sprite", bounds: bounds, region: region.Name})
		}
	}
	for i, kind := range kinds {
		if kind == "" {
			return nil, "", artworkError("each atlas cell must belong to a named region")
		}
		palette := palettes[atlas.CellPalettes[i]][:]
		if kind == "sprite" {
			palette = palette[1:]
		}
		x0, y0 := i%columns*pixelsPerTile, i/columns*pixelsPerTile
		for y := y0; y < y0+pixelsPerTile; y++ {
			for x := x0; x < x0+pixelsPerTile; x++ {
				pixel := color.NRGBAModel.Convert(img.At(x, y)).(color.NRGBA)
				if kind == "sprite" && pixel.A == 0 {
					continue
				}
				if !slices.Contains(palette, pixel) {
					return nil, "", artworkError("an atlas pixel does not match its assigned palette")
				}
			}
		}
	}
	animations := map[string]bool{}
	for _, animation := range atlas.Animations {
		if !atlasIdentifier.MatchString(animation.Name) || animations[animation.Name] || len(animation.Frames) == 0 ||
			len(animation.Frames) > maxAtlasFrames {
			return nil, "", artworkError("invalid atlas animation " + animation.Name)
		}
		animations[animation.Name] = true
		first := regions[animation.Frames[0].Region]
		for _, frame := range animation.Frames {
			region, ok := regions[frame.Region]
			duration := frame.Duration
			if duration == nil {
				duration = region.Duration
			}
			if !ok || region.Kind != first.Kind || region.Width != first.Width || region.Height != first.Height ||
				!slices.Equal(region.Origin, first.Origin) || duration == nil || *duration < 1 || *duration > maxAtlasDuration {
				return nil, "", artworkError("invalid atlas animation frame " + frame.Region)
			}
		}
	}
	return cuts, atlas.ID, nil
}
