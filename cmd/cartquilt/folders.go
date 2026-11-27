package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
)

const chooseFolderScript = `try
	return POSIX path of (choose folder with prompt "Choose a folder for Cartquilt")
on error number -128
	return ""
end try`

func projectFolderPicker() http.HandlerFunc {
	var dialog sync.Mutex
	return func(w http.ResponseWriter, r *http.Request) {
		if !decodeLocalRequest(w, r, &struct{}{}) {
			return
		}
		if r.Header.Get("Origin") == "" {
			http.Error(w, "Open the folder picker from the Cartquilt editor", http.StatusForbidden)
			return
		}
		if runtime.GOOS != "darwin" {
			http.Error(w, "Enter the full project folder path on this platform", http.StatusNotImplemented)
			return
		}
		if !dialog.TryLock() {
			http.Error(w, "A folder picker is already open", http.StatusConflict)
			return
		}
		defer dialog.Unlock()
		output, err := exec.CommandContext(r.Context(), "/usr/bin/osascript", "-e", chooseFolderScript).Output()
		if err != nil {
			if r.Context().Err() == nil {
				log.Printf("Open project folder picker: %v", err)
				http.Error(w, "Could not open the macOS folder picker. Enter the full project folder path.", http.StatusServiceUnavailable)
			}
			return
		}
		path := strings.TrimSuffix(string(output), "\n")
		w.Header().Set("Cache-Control", "no-store")
		if path == "" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if !filepath.IsAbs(path) {
			http.Error(w, "The folder picker did not return an absolute path", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(struct {
			Path string `json:"path"`
		}{Path: filepath.Clean(path)})
	}
}
