package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestCreateProjectHTTP(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "new project")
	input, err := json.Marshal(createInput{Name: "New Project", Path: path})
	if err != nil {
		t.Fatal(err)
	}
	handler := workspaceServer(&Snapshot{Project: Project{Name: "Original"}}, dir)
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
	var created savedProject
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
	sameName, err := json.Marshal(createInput{Name: "New Project", Path: filepath.Join(dir, "another project")})
	if err != nil {
		t.Fatal(err)
	}
	duplicate := post("", sameName)
	if duplicate.Code != http.StatusCreated || duplicate.Header().Get("Location") != "/projects/new-project-2/" {
		t.Fatalf("same name in another folder: %d %s", duplicate.Code, duplicate.Body)
	}
	saved, err := loadProject(created.Path)
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

func TestCreateProjectMCP(t *testing.T) {
	ctx := context.Background()
	server, client := mcp.NewInMemoryTransports()
	session, err := cartquiltMCP().Connect(ctx, server, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	conn, err := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "1"}, nil).Connect(ctx, client, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	path := filepath.Join(t.TempDir(), "mcp project")
	out, err := conn.CallTool(ctx, &mcp.CallToolParams{
		Name:      "create_project",
		Arguments: createInput{Name: "MCP Project", Path: path},
	})
	if err != nil || out.IsError {
		t.Fatalf("create_project: %+v %v", out, err)
	}
	saved, err := loadProject(filepath.Join(path, "project.json"))
	if err != nil || saved.Project.Name != "MCP Project" || len(saved.Project.Scenes) != 0 {
		t.Fatalf("reopen: %+v %v", saved, err)
	}

	opened, err := conn.CallTool(ctx, &mcp.CallToolParams{
		Name:      "open_project",
		Arguments: openInput{Path: path},
	})
	if err != nil || opened.IsError {
		t.Fatalf("open_project: %+v %v", opened, err)
	}
	if content, ok := opened.StructuredContent.(map[string]any); !ok || content["revision"] != saved.Revision {
		t.Fatalf("unexpected open_project result: %+v", opened.StructuredContent)
	}

	existing := filepath.Join(path, "existing")
	if err := os.Mkdir(existing, 0700); err != nil {
		t.Fatal(err)
	}
	out, err = conn.CallTool(ctx, &mcp.CallToolParams{
		Name:      "create_project",
		Arguments: createInput{Name: "Existing", Path: existing},
	})
	if err != nil || !out.IsError {
		t.Fatalf("existing folder: %+v %v", out, err)
	}
}

func TestFolderPickerRejectsExternalRequests(t *testing.T) {
	handler := workspaceServer(nil, "")
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
	project, err := createProject(createInput{Name: "Loom Draft", Path: filepath.Join(t.TempDir(), "Loom Draft")})
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{filepath.Dir(project.Path), project.Path} {
		handler := workspaceServer(nil, "")
		root := httptest.NewRecorder()
		handler.ServeHTTP(root, httptest.NewRequest("GET", "/api/project", nil))
		if root.Code != http.StatusNoContent || root.Body.Len() != 0 {
			t.Fatalf("session without a startup project: %d %s", root.Code, root.Body)
		}
		body, err := json.Marshal(openInput{Path: path})
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest("POST", "http://127.0.0.1:4173/api/project-open", strings.NewReader(string(body)))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		var opened savedProject
		decodeErr := json.Unmarshal(rec.Body.Bytes(), &opened)
		if rec.Code != http.StatusOK || rec.Header().Get("Location") != "/projects/loom-draft/" ||
			decodeErr != nil || opened.Project.ID != project.Project.ID || opened.Revision != project.Revision {
			t.Fatalf("reopen %q: %d %s (%v)", path, rec.Code, rec.Body, decodeErr)
		}
	}
}
