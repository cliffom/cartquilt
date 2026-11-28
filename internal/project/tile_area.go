package project

import "slices"

type TileArea struct {
	Point
	Width  int `json:"width"`
	Height int `json:"height"`
}

func (a TileArea) inBounds(scene Scene) bool {
	return a.X >= 0 && a.Y >= 0 && a.Width > 0 && a.Height > 0 &&
		a.Width <= scene.Width-a.X && a.Height <= scene.Height-a.Y
}

func (a TileArea) overlaps(b TileArea) bool {
	return a.X < b.X+b.Width && b.X < a.X+a.Width && a.Y < b.Y+b.Height && b.Y < a.Y+a.Height
}

func (a TileArea) overlapTiles(b TileArea) int {
	width := max(0, min(a.X+a.Width, b.X+b.Width)-max(a.X, b.X))
	height := max(0, min(a.Y+a.Height, b.Y+b.Height)-max(a.Y, b.Y))
	return width * height
}

// subtract returns the parts of a rectangle outside the brush, with no overlapping slivers.
func (a TileArea) subtract(brush TileArea) []TileArea {
	if !a.overlaps(brush) {
		return []TileArea{a}
	}
	left, top := max(a.X, brush.X), max(a.Y, brush.Y)
	right, bottom := min(a.X+a.Width, brush.X+brush.Width), min(a.Y+a.Height, brush.Y+brush.Height)
	pieces := []TileArea{
		{Point{a.X, a.Y}, a.Width, top - a.Y},
		{Point{a.X, bottom}, a.Width, a.Y + a.Height - bottom},
		{Point{a.X, top}, left - a.X, bottom - top},
		{Point{right, top}, a.X + a.Width - right, bottom - top},
	}
	return slices.DeleteFunc(pieces, func(p TileArea) bool { return p.Width == 0 || p.Height == 0 })
}
