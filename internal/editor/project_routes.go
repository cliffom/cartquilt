package editor

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"cartquilt/internal/project"
)

const maxSceneRestoreSize = 32 * 1024 * 1024
const maxArtworkUploadSize = 24 * 1024 * 1024

func projectRoutes(path string, files http.Handler, web fs.FS) http.Handler {
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
	mux.HandleFunc("GET /api/artwork-assets", func(w http.ResponseWriter, r *http.Request) {
		assets, err := project.ListArtworkAssets(path)
		if err != nil {
			http.Error(w, "Could not read the project asset library.", http.StatusUnprocessableEntity)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(assets)
	})
	mux.HandleFunc("GET /api/artwork-assets/{kind}/{name}", func(w http.ResponseWriter, r *http.Request) {
		data, managed, err := project.ReadImportedArtwork(path, r.PathValue("kind"), r.PathValue("name"))
		if managed {
			if err != nil {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", "image/png")
			w.Header().Set("Cache-Control", "no-cache")
			http.ServeContent(w, r, "artwork.png", time.Time{}, bytes.NewReader(data))
			return
		}
		file, err := project.OpenArtworkFile(path, r.PathValue("kind"), r.PathValue("name"))
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer file.Close()
		info, err := file.Stat()
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		http.ServeContent(w, r, info.Name(), info.ModTime(), file)
	})
	mux.HandleFunc("POST /api/artwork-assets/import", func(w http.ResponseWriter, r *http.Request) {
		if !requireLocalEditor(w, r) {
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxArtworkUploadSize)
		if err := r.ParseMultipartForm(maxArtworkUploadSize); err != nil {
			http.Error(w, "Could not read the artwork upload or it exceeds 24 MiB.", http.StatusBadRequest)
			return
		}
		defer r.MultipartForm.RemoveAll()
		input := project.ImportArtworkInput{BaseRevision: r.PostForm.Get("baseRevision"), Kind: r.PostForm.Get("kind")}
		file, header, err := r.FormFile("png")
		if err != nil {
			http.Error(w, "Choose a PNG to import.", http.StatusBadRequest)
			return
		}
		defer file.Close()
		input.PNGName = header.Filename
		if input.PNG, err = io.ReadAll(file); err != nil {
			http.Error(w, "Could not read the PNG.", http.StatusBadRequest)
			return
		}
		if input.Kind == "gbc-atlas" {
			manifest, _, err := r.FormFile("manifest")
			if err != nil {
				http.Error(w, "Choose the matching .atlas.json file.", http.StatusBadRequest)
				return
			}
			defer manifest.Close()
			if input.Manifest, err = io.ReadAll(manifest); err != nil {
				http.Error(w, "Could not read the atlas manifest.", http.StatusBadRequest)
				return
			}
		}
		snapshot, err := project.ImportArtwork(path, input)
		if errors.Is(err, project.ErrInvalidInput) {
			http.Error(w, strings.TrimPrefix(err.Error(), project.ErrInvalidInput.Error()+": "), http.StatusBadRequest)
			return
		}
		writeSceneResult(w, project.SceneResult{Snapshot: snapshot}, err, http.StatusCreated)
	})
	mux.HandleFunc("GET /api/project/scenes/{scene}/tiled", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("scene")
		data, err := project.ExportTiledScene(path, id, web)
		if err != nil {
			writeSceneResult(w, project.SceneResult{}, err, http.StatusOK)
			return
		}
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", "attachment; filename="+id+"-tiled.zip")
		w.Header().Set("Cache-Control", "no-store")
		w.Write(data)
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
		if !decodeLocalRequestWithLimit(w, r, &input, maxSceneRestoreSize) {
			return
		}
		updated, err := project.RestoreBlockout(path, r.PathValue("scene"), input)
		writeSceneResult(w, updated, err, http.StatusOK)
	})
	mux.HandleFunc("PUT /api/project/scenes/{scene}/artwork", func(w http.ResponseWriter, r *http.Request) {
		var input project.RestoreArtworkInput
		if !decodeLocalRequestWithLimit(w, r, &input, maxSceneRestoreSize) {
			return
		}
		updated, err := project.RestoreArtwork(path, r.PathValue("scene"), input)
		writeSceneResult(w, updated, err, http.StatusOK)
	})
	mux.HandleFunc("GET /assets/{name}", func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("name")
		snapshot, err := project.Load(path)
		if err != nil || filepath.Ext(name) != ".png" || !hasAsset(snapshot.Project.Scenes, name) {
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
