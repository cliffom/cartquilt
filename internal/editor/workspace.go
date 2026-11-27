package editor

import (
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"mime"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"

	"cartquilt/internal/project"
)

var projectSlugSeparators = regexp.MustCompile(`[^a-z0-9]+`)

func projectSlug(name string) string {
	slug := strings.Trim(projectSlugSeparators.ReplaceAllString(strings.ToLower(name), "-"), "-")
	slug = strings.TrimRight(slug[:min(len(slug), 64)], "-")
	if slug == "" {
		return "project"
	}
	return slug
}

func New(initial *project.Saved, web fs.FS) http.Handler {
	editorFiles := http.FileServerFS(web)
	mux := http.NewServeMux()
	type sessionProject struct {
		path    string
		handler http.Handler
	}
	var projects sync.Map
	serveProject := func(w http.ResponseWriter, saved project.Saved, status int) {
		path := saved.Path
		if resolved, err := filepath.EvalSymlinks(filepath.Dir(path)); err == nil {
			path = filepath.Join(resolved, filepath.Base(path))
		}
		entry := sessionProject{path: path, handler: projectRoutes(saved.Path, editorFiles)}
		base := projectSlug(saved.Project.Name)
		slug := base
		for suffix := 2; ; suffix++ {
			previous, exists := projects.LoadOrStore(slug, entry)
			if !exists {
				break
			}
			if previous.(sessionProject).path == path {
				projects.Store(slug, entry)
				break
			}
			slug = base + "-" + strconv.Itoa(suffix)
		}
		w.Header().Set("Location", "/projects/"+slug+"/")
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(status)
		json.NewEncoder(w).Encode(saved)
	}
	serveOpenedProject := func(w http.ResponseWriter, r *http.Request) {
		slug := r.PathValue("slug")
		handler, ok := projects.Load(slug)
		if !ok {
			if r.URL.Path == "/projects/"+slug+"/" {
				http.StripPrefix("/projects/"+slug, editorFiles).ServeHTTP(w, r)
				return
			}
			http.NotFound(w, r)
			return
		}
		http.StripPrefix("/projects/"+slug, handler.(sessionProject).handler).ServeHTTP(w, r)
	}
	mux.HandleFunc("GET /projects/{slug}/", serveOpenedProject)
	mux.HandleFunc("POST /projects/{slug}/api/project/scenes", serveOpenedProject)
	mux.HandleFunc("POST /api/projects", func(w http.ResponseWriter, r *http.Request) {
		var input project.CreateInput
		if !decodeLocalRequest(w, r, &input) {
			return
		}
		saved, err := project.Create(input)
		if err != nil {
			status := http.StatusUnprocessableEntity
			switch {
			case errors.Is(err, project.ErrInvalidInput):
				status = http.StatusBadRequest
			case errors.Is(err, project.ErrExists):
				status = http.StatusConflict
			}
			http.Error(w, err.Error(), status)
			return
		}
		serveProject(w, saved, http.StatusCreated)
	})
	mux.HandleFunc("POST /api/project-open", func(w http.ResponseWriter, r *http.Request) {
		var input project.OpenInput
		if !decodeLocalRequest(w, r, &input) {
			return
		}
		saved, err := project.Open(input)
		if err != nil {
			status := http.StatusUnprocessableEntity
			switch {
			case errors.Is(err, project.ErrInvalidInput):
				status = http.StatusBadRequest
			case errors.Is(err, os.ErrNotExist):
				status = http.StatusNotFound
			}
			http.Error(w, err.Error(), status)
			return
		}
		serveProject(w, saved, http.StatusOK)
	})
	mux.HandleFunc("POST /api/project-folder-picker", projectFolderPicker())
	if initial == nil {
		mux.HandleFunc("GET /api/project", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", "no-store")
			w.WriteHeader(http.StatusNoContent)
		})
		mux.Handle("GET /", editorFiles)
	} else {
		mux.Handle("/", projectRoutes(initial.Path, editorFiles))
	}
	return mux
}

func decodeLocalRequest(w http.ResponseWriter, r *http.Request, input any) bool {
	host, _, err := net.SplitHostPort(r.Host)
	if err != nil {
		host = r.Host
	}
	if !strings.EqualFold(host, "localhost") && !net.ParseIP(host).IsLoopback() {
		http.Error(w, "Project requests require a loopback address", http.StatusForbidden)
		return false
	}
	if origin := r.Header.Get("Origin"); origin != "" && origin != "http://"+r.Host {
		http.Error(w, "Project requests require the editor origin", http.StatusForbidden)
		return false
	}
	mediaType, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if mediaType != "application/json" {
		http.Error(w, "Project requests require JSON", http.StatusUnsupportedMediaType)
		return false
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32*1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(input); err != nil || decoder.Decode(new(any)) != io.EOF {
		http.Error(w, "Invalid project request", http.StatusBadRequest)
		return false
	}
	return true
}
