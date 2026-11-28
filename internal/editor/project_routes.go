package editor

import (
	"encoding/json"
	"errors"
	"net/http"
	"path/filepath"

	"cartquilt/internal/project"
)

const maxBlockoutRestoreSize = 32 * 1024 * 1024

func projectRoutes(path string, files http.Handler) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/project", func(w http.ResponseWriter, r *http.Request) {
		snapshot, err := project.Load(path)
		if err != nil {
			http.Error(w, "Could not read the saved project.", http.StatusUnprocessableEntity)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(snapshot)
	})
	mux.HandleFunc("POST /api/project/scenes", func(w http.ResponseWriter, r *http.Request) {
		var input project.AddSceneInput
		if !decodeLocalRequest(w, r, &input) {
			return
		}
		added, err := project.AddScene(path, input)
		writeSceneResult(w, added, err, http.StatusCreated)
	})
	mux.HandleFunc("POST /api/project/scenes/{scene}/actions", func(w http.ResponseWriter, r *http.Request) {
		var input project.SceneActionInput
		if !decodeLocalRequest(w, r, &input) {
			return
		}
		updated, err := project.ApplySceneAction(path, r.PathValue("scene"), input)
		writeSceneResult(w, updated, err, http.StatusOK)
	})
	mux.HandleFunc("PUT /api/project/scenes/{scene}/blockout", func(w http.ResponseWriter, r *http.Request) {
		var input project.RestoreBlockoutInput
		if !decodeLocalRequestWithLimit(w, r, &input, maxBlockoutRestoreSize) {
			return
		}
		updated, err := project.RestoreBlockout(path, r.PathValue("scene"), input)
		writeSceneResult(w, updated, err, http.StatusOK)
	})
	mux.HandleFunc("GET /assets/{name}", func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("name")
		snapshot, err := project.Load(path)
		if err != nil || !hasAsset(snapshot.Project.Scenes, name) {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, filepath.Join(filepath.Dir(path), name))
	})
	mux.Handle("GET /", files)
	return mux
}

func hasAsset(scenes []project.Scene, name string) bool {
	for _, scene := range scenes {
		if scene.Art != "" && scene.Art == name {
			return true
		}
		for _, actor := range scene.Actors {
			if actor.Sprite == name {
				return true
			}
		}
	}
	return false
}

func writeSceneResult(w http.ResponseWriter, updated project.SceneResult, err error, success int) {
	if err != nil {
		status := http.StatusUnprocessableEntity
		switch {
		case errors.Is(err, project.ErrInvalidInput):
			status = http.StatusBadRequest
		case errors.Is(err, project.ErrSceneNotFound):
			status = http.StatusNotFound
		case errors.Is(err, project.ErrProjectBusy):
			status = http.StatusConflict
		case errors.Is(err, project.ErrStaleRevision):
			status = http.StatusConflict
			err = errors.New("The project changed on disk. Refresh the scene list before trying again.")
			w.Header().Set("Cartquilt-Conflict", "stale-revision")
		}
		http.Error(w, err.Error(), status)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(success)
	json.NewEncoder(w).Encode(updated)
}
