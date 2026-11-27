package mcpserver

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"cartquilt/internal/project"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestCreateProjectMCP(t *testing.T) {
	ctx := context.Background()
	server, client := mcp.NewInMemoryTransports()
	session, err := New().Connect(ctx, server, nil)
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
		Arguments: project.CreateInput{Name: "MCP Project", Path: path},
	})
	if err != nil || out.IsError {
		t.Fatalf("create_project: %+v %v", out, err)
	}
	saved, err := project.Load(filepath.Join(path, "project.json"))
	if err != nil || saved.Project.Name != "MCP Project" || len(saved.Project.Scenes) != 0 {
		t.Fatalf("reopen: %+v %v", saved, err)
	}

	opened, err := conn.CallTool(ctx, &mcp.CallToolParams{
		Name:      "open_project",
		Arguments: project.OpenInput{Path: path},
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
		Arguments: project.CreateInput{Name: "Existing", Path: existing},
	})
	if err != nil || !out.IsError {
		t.Fatalf("existing folder: %+v %v", out, err)
	}
}
