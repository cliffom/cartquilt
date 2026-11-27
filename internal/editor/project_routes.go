package editor

import (
	"encoding/json"
	"net/http"
	"path/filepath"

	"cartquilt/internal/project"
)

func projectRoutes(snapshot project.Snapshot, dir string, files http.Handler) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/project", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(snapshot)
	})
	assets := map[string]bool{}
	for _, s := range snapshot.Project.Scenes {
		assets[s.Art] = true
		for _, a := range s.Actors {
			assets[a.Sprite] = true
		}
	}
	mux.HandleFunc("GET /assets/{name}", func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("name")
		if !assets[name] {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, filepath.Join(dir, name))
	})
	mux.Handle("GET /", files)
	return mux
}
