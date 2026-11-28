package mcpserver

import (
	"context"

	"cartquilt/internal/project"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type createSceneInput struct {
	project.OpenInput
	project.AddSceneInput
}

type blockoutInput struct {
	project.OpenInput
	SceneID      string                 `json:"sceneId" jsonschema:"Stable ID of the scene returned by open_project or create_scene"`
	BaseRevision string                 `json:"baseRevision" jsonschema:"Project revision returned by open_project or the previous save"`
	Edits        []project.BlockoutEdit `json:"edits" jsonschema:"Ordered blockout edits applied together. For placement changes preview this batch before saving."`
}

func New() *mcp.Server {
	server := mcp.NewServer(&mcp.Implementation{Name: "cartquilt", Version: "0.1.0"}, nil)
	mcp.AddTool(server, &mcp.Tool{
		Name:        "create_project",
		Description: "Create an empty Cartquilt project at an explicitly chosen new local folder. Returns the saved project.json path and revision.",
		Annotations: &mcp.ToolAnnotations{DestructiveHint: new(bool)},
	}, func(_ context.Context, _ *mcp.CallToolRequest, input project.CreateInput) (*mcp.CallToolResult, project.Saved, error) {
		project, err := project.Create(input)
		return nil, project, err
	})
	mcp.AddTool(server, &mcp.Tool{
		Name: "create_scene", Description: "Create a blank scene in a saved Cartquilt project using its current revision. Returns the scene ID and new revision.",
		Annotations: &mcp.ToolAnnotations{DestructiveHint: new(bool)},
	}, func(_ context.Context, _ *mcp.CallToolRequest, input createSceneInput) (*mcp.CallToolResult, project.SceneResult, error) {
		saved, err := project.Open(input.OpenInput)
		if err != nil {
			return nil, project.SceneResult{}, err
		}
		result, err := project.AddScene(saved.Path, input.AddSceneInput)
		return nil, result, err
	})
	mcp.AddTool(server, &mcp.Tool{
		Name: "preview_blockout", Description: "Validate and preview an ordered batch of blockout edits against a saved scene revision. Returns candidate terrain and elements without writing. Terrain: walkable, blocked, one-way, water, pit, hazard, climb. Elements: enemy, patrol, flying-approach, reward, discoverable, detour, player-spawn, checkpoint, boss-entrance, boss-arena, stage-exit, section, note, camera.",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true},
	}, func(_ context.Context, _ *mcp.CallToolRequest, input blockoutInput) (*mcp.CallToolResult, project.BlockoutPreview, error) {
		saved, err := project.Open(input.OpenInput)
		if err != nil {
			return nil, project.BlockoutPreview{}, err
		}
		preview, err := project.PreviewBlockout(saved.Path, input.SceneID, input.BaseRevision, input.Edits)
		return nil, preview, err
	})
	mcp.AddTool(server, &mcp.Tool{
		Name: "apply_blockout", Description: "Save an ordered blockout edit batch atomically against the current project revision. Uses the same terrain, elements, and validation as the editor and preview_blockout.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, input blockoutInput) (*mcp.CallToolResult, project.SceneResult, error) {
		saved, err := project.Open(input.OpenInput)
		if err != nil {
			return nil, project.SceneResult{}, err
		}
		result, err := project.ApplySceneAction(saved.Path, input.SceneID, project.SceneActionInput{BaseRevision: input.BaseRevision, Action: "blockout", Blockout: input.Edits})
		return nil, result, err
	})
	mcp.AddTool(server, &mcp.Tool{
		Name:        "open_project",
		Description: "Read the saved snapshot of a Cartquilt project from an explicitly chosen local folder or JSON file. Returns its project ID and revision so you can identify it across sessions.",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true},
	}, func(_ context.Context, _ *mcp.CallToolRequest, input project.OpenInput) (*mcp.CallToolResult, project.Saved, error) {
		project, err := project.Open(input)
		return nil, project, err
	})
	return server
}
