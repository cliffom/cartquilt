package main

import (
	"context"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"cartquilt/internal/editor"
	"cartquilt/internal/mcpserver"
	"cartquilt/internal/project"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const (
	defaultHTTPPort   = 4173
	readHeaderTimeout = 5 * time.Second
)

type editorFiles struct{ fs.FS }

func (files editorFiles) Open(name string) (fs.File, error) {
	file, err := files.FS.Open(name)
	if os.IsNotExist(err) && strings.HasPrefix(name, "starter/") {
		return os.DirFS("web/static").Open(name)
	}
	return file, err
}

func main() {
	path := flag.String("project", os.Getenv("CARTQUILT_PROJECT"), "saved project file to open at startup")
	port := flag.Int("port", defaultHTTPPort, "local HTTP port")
	mcpMode := flag.Bool("mcp", false, "serve Cartquilt MCP over standard input and output")
	flag.Parse()
	if *mcpMode {
		if err := mcpserver.New().Run(context.Background(), &mcp.StdioTransport{}); err != nil {
			log.Fatal(err)
		}
		return
	}
	var initial *project.Saved
	if *path != "" {
		absolutePath, err := filepath.Abs(*path)
		if err != nil {
			log.Fatal(err)
		}
		snapshot, err := project.Load(absolutePath)
		if err != nil {
			log.Fatal(err)
		}
		initial = &project.Saved{Snapshot: snapshot, Path: absolutePath}
	}
	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("Cartquilt at http://%s", listener.Addr())
	server := http.Server{Handler: editor.New(initial, editorFiles{os.DirFS("web/dist")}), ReadHeaderTimeout: readHeaderTimeout}
	log.Fatal(server.Serve(listener))
}
