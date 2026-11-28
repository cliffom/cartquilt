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

func TestBlockoutMCPUsesSavedRevisions(t *testing.T) {
	ctx := context.Background()
	serverTransport, clientTransport := mcp.NewInMemoryTransports()
	server, err := New().Connect(ctx, serverTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	client, err := mcp.NewClient(&mcp.Implementation{Name: "test"}, nil).Connect(ctx, clientTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	path := filepath.Join(t.TempDir(), "blockout")
	saved, err := project.Create(project.CreateInput{Name: "Blockout", Path: path})
	if err != nil {
		t.Fatal(err)
	}
	call := func(name string, arguments any, wantError bool) map[string]any {
		t.Helper()
		result, err := client.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: arguments})
		if err != nil || result.IsError != wantError {
			t.Fatalf("%s: %+v, %v", name, result, err)
		}
		if wantError {
			return nil
		}
		value, ok := result.StructuredContent.(map[string]any)
		if !ok {
			t.Fatalf("%s returned %+v", name, result.StructuredContent)
		}
		return value
	}
	created := call("create_scene", createSceneInput{
		OpenInput:     project.OpenInput{Path: path},
		AddSceneInput: project.AddSceneInput{BaseRevision: saved.Revision, Name: "Loft", Width: 8, Height: 6},
	}, false)
	input := blockoutInput{
		OpenInput:    project.OpenInput{Path: path},
		SceneID:      created["sceneId"].(string),
		BaseRevision: created["revision"].(string),
		Edits:        []project.BlockoutEdit{{Op: "paint", Kind: "one-way", Area: &project.TileArea{Point: project.Point{X: 1, Y: 3}, Width: 4, Height: 1}}},
	}
	call("preview_blockout", input, false)
	unchanged, err := project.Load(saved.Path)
	if err != nil || unchanged.Revision != input.BaseRevision || unchanged.Project.Scenes[0].Blockout != nil {
		t.Fatalf("preview wrote to disk: %+v, %v", unchanged, err)
	}
	call("apply_blockout", input, false)
	call("apply_blockout", input, true)
	updated, err := project.Load(saved.Path)
	if err != nil {
		t.Fatal(err)
	}
	terrain := updated.Project.Scenes[0].Blockout.Terrain
	if len(terrain) != 1 || terrain[0].Kind != "one-way" || terrain[0].Width != 4 {
		t.Fatalf("unexpected saved terrain: %+v", terrain)
	}
}
