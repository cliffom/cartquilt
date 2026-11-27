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
	handler := New(&project.Saved{Snapshot: project.Snapshot{Project: project.Project{Name: "Original"}}, Path: filepath.Join(dir, "project.json")}, fstest.MapFS{})
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
