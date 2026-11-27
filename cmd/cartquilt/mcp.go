package main

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func cartquiltMCP() *mcp.Server {
	server := mcp.NewServer(&mcp.Implementation{Name: "cartquilt", Version: "0.1.0"}, nil)
	mcp.AddTool(server, &mcp.Tool{
		Name:        "create_project",
		Description: "Create an empty Cartquilt project at an explicitly chosen new local folder. Returns the saved project.json path and revision.",
		Annotations: &mcp.ToolAnnotations{DestructiveHint: new(bool)},
	}, func(_ context.Context, _ *mcp.CallToolRequest, input createInput) (*mcp.CallToolResult, savedProject, error) {
		project, err := createProject(input)
		return nil, project, err
	})
	mcp.AddTool(server, &mcp.Tool{
		Name:        "open_project",
		Description: "Read the saved snapshot of a Cartquilt project from an explicitly chosen local folder or JSON file. Returns its project ID and revision so you can identify it across sessions.",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true},
	}, func(_ context.Context, _ *mcp.CallToolRequest, input openInput) (*mcp.CallToolResult, savedProject, error) {
		project, err := openProject(input)
		return nil, project, err
	})
	return server
}
