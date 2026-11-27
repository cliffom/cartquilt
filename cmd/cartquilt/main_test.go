package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestSnapshotResponse(t *testing.T) {
	dir := filepath.Join("..", "..", "examples", "threadvale")
	snap, err := loadProject(filepath.Join(dir, "project.json"))
	if err != nil {
		t.Fatal(err)
	}
	handler := editor(snap, dir)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest("GET", "/api/project", nil))
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "application/json" {
		t.Fatal(rec.Result())
	}
	var got Snapshot
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil || got.Revision != snap.Revision || len(got.Project.Scenes) != 2 {
		t.Fatalf("unexpected response: %s", rec.Body.String())
	}
	// The browser contract test decodes the bytes emitted by the real HTTP handler.
	if path := os.Getenv("CARTQUILT_CONTRACT_OUTPUT"); path != "" {
		if err := os.WriteFile(path, rec.Body.Bytes(), 0600); err != nil {
			t.Fatal(err)
		}
	}
	for _, tc := range []struct {
		method, path string
		status       int
	}{
		{"GET", "/assets/willow.png", 200}, {"GET", "/assets/project.json", 404}, {"POST", "/api/project", 405},
	} {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(tc.method, tc.path, nil))
		if rec.Code != tc.status {
			t.Errorf("%s %s: got %d", tc.method, tc.path, rec.Code)
		}
	}
}
