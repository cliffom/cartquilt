package project

const (
	projectVersion    = 1
	manifestFilename  = "project.json"
	minSceneTiles     = 1
	maxSceneTiles     = 1024
	pixelsPerTile     = 8
	newSceneSpacing   = 280 // World layout pixels.
	objectIDBytes     = 16
	privateFileMode   = 0o600
	privateFolderMode = 0o700
	maxBrowserInteger = 1<<53 - 1
)

func validSceneDimensions(width, height int) bool {
	return width >= minSceneTiles && width <= maxSceneTiles && height >= minSceneTiles && height <= maxSceneTiles
}
