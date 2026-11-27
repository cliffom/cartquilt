package editor

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"testing/fstest"

	"cartquilt/internal/project"
)

func TestCreateProjectHTTP(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "new project")
	input, err := json.Marshal(project.CreateInput{Name: "New Project", Path: path})
	if err != nil {
		t.Fatal(err)
	}
	original, err := project.Create(project.CreateInput{Name: "Original", Path: filepath.Join(dir, "original")})
	if err != nil {
		t.Fatal(err)
	}
	handler := New(&original, fstest.MapFS{})
	post := func(origin string, body []byte) *httptest.ResponseRecorder {
		req := httptest.NewRequest("POST", "http://127.0.0.1:4173/api/projects", strings.NewReader(string(body)))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", origin)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}
	if rec := post("http://example.com", input); rec.Code != http.StatusForbidden {
		t.Fatalf("cross-origin create: %d %s", rec.Code, rec.Body)
	}
	rec := post("http://127.0.0.1:4173", input)
	if rec.Code != http.StatusCreated || rec.Header().Get("Location") != "/projects/new-project/" {
		t.Fatalf("create: %d %s", rec.Code, rec.Body)
	}
	var created project.Saved
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.Path != filepath.Join(path, "project.json") || created.Project.Name != "New Project" ||
		created.Project.Scenes == nil || len(created.Project.Scenes) != 0 {
		t.Fatalf("unexpected project: %+v", created)
	}
	if rec := post("", input); rec.Code != http.StatusConflict {
		t.Fatalf("duplicate create: %d %s", rec.Code, rec.Body)
	}
	sameName, err := json.Marshal(project.CreateInput{Name: "New Project", Path: filepath.Join(dir, "another project")})
	if err != nil {
		t.Fatal(err)
	}
	duplicate := post("", sameName)
	if duplicate.Code != http.StatusCreated || duplicate.Header().Get("Location") != "/projects/new-project-2/" {
		t.Fatalf("same name in another folder: %d %s", duplicate.Code, duplicate.Body)
	}
	saved, err := project.Load(created.Path)
	if err != nil || saved.Revision != created.Revision {
		t.Fatalf("reopen: %+v %v", saved, err)
	}
	for route, want := range map[string]string{
		"/api/project": "Original",
		rec.Header().Get("Location") + "api/project": "New Project",
	} {
		out := httptest.NewRecorder()
		handler.ServeHTTP(out, httptest.NewRequest("GET", route, nil))
		if out.Code != http.StatusOK || !strings.Contains(out.Body.String(), want) {
			t.Fatalf("GET %s: %d %s", route, out.Code, out.Body)
		}
	}
}

func TestFolderPickerRejectsExternalRequests(t *testing.T) {
	handler := New(nil, fstest.MapFS{})
	for _, tc := range []struct {
		host, origin string
	}{
		{"example.com", "http://example.com"},
		{"127.0.0.1:4173", "http://example.com"},
		{"127.0.0.1:4173", ""},
	} {
		req := httptest.NewRequest("POST", "http://"+tc.host+"/api/project-folder-picker", strings.NewReader("{}"))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", tc.origin)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Errorf("picker from %q on %q: %d %s", tc.origin, tc.host, rec.Code, rec.Body)
		}
	}
}

func TestOpenSavedProjectAcrossSessions(t *testing.T) {
	created, err := project.Create(project.CreateInput{Name: "Loom Draft", Path: filepath.Join(t.TempDir(), "Loom Draft")})
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{filepath.Dir(created.Path), created.Path} {
		handler := New(nil, fstest.MapFS{})
		root := httptest.NewRecorder()
		handler.ServeHTTP(root, httptest.NewRequest("GET", "/api/project", nil))
		if root.Code != http.StatusNoContent || root.Body.Len() != 0 {
			t.Fatalf("session without a startup project: %d %s", root.Code, root.Body)
		}
		body, err := json.Marshal(project.OpenInput{Path: path})
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest("POST", "http://127.0.0.1:4173/api/project-open", strings.NewReader(string(body)))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		var opened project.Saved
		decodeErr := json.Unmarshal(rec.Body.Bytes(), &opened)
		if rec.Code != http.StatusOK || rec.Header().Get("Location") != "/projects/loom-draft/" ||
			decodeErr != nil || opened.Project.ID != created.Project.ID || opened.Revision != created.Revision {
			t.Fatalf("reopen %q: %d %s (%v)", path, rec.Code, rec.Body, decodeErr)
		}
	}
}

func TestCreateSceneThroughOpenedProject(t *testing.T) {
	saved, err := project.Create(project.CreateInput{Name: "Loom Draft", Path: filepath.Join(t.TempDir(), "Loom Draft")})
	if err != nil {
		t.Fatal(err)
	}
	handler := New(nil, fstest.MapFS{})
	post := func(path string, input any) *httptest.ResponseRecorder {
		t.Helper()
		body, err := json.Marshal(input)
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest("POST", "http://127.0.0.1:4173"+path, strings.NewReader(string(body)))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", "http://127.0.0.1:4173")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}
	opened := post("/api/project-open", project.OpenInput{Path: saved.Path})
	if opened.Code != http.StatusOK {
		t.Fatalf("open: %d %s", opened.Code, opened.Body)
	}
	path := opened.Header().Get("Location") + "api/project"
	input := project.AddSceneInput{BaseRevision: saved.Revision, Name: "  Dye Garden ", Width: 20, Height: 18}
	added := post(path+"/scenes", input)
	var next project.AddedScene
	if err := json.Unmarshal(added.Body.Bytes(), &next); err != nil || added.Code != http.StatusCreated || len(next.Project.Scenes) != 1 {
		t.Fatalf("create scene: %d %s (%v)", added.Code, added.Body, err)
	}
	scene := next.Project.Scenes[0]
	if scene.ID != next.SceneID || scene.Name != "Dye Garden" || scene.Width != 20 || scene.Height != 18 || scene.Art != "" || scene.World != (project.Point{}) {
		t.Fatalf("scene: %+v", scene)
	}
	if stale := post(path+"/scenes", input); stale.Code != http.StatusConflict || stale.Header().Get("Cartquilt-Conflict") != "stale-revision" {
		t.Fatalf("stale add: %d %s", stale.Code, stale.Body)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
	var current project.Snapshot
	if err := json.Unmarshal(rec.Body.Bytes(), &current); err != nil || current.Revision != next.Revision {
		t.Fatalf("read through active route: %d %s (%v)", rec.Code, rec.Body, err)
	}
	reopened, err := project.Open(project.OpenInput{Path: saved.Path})
	if err != nil || reopened.Revision != next.Revision || len(reopened.Project.Scenes) != 1 {
		t.Fatalf("read through a fresh session: %+v (%v)", reopened, err)
	}
}
