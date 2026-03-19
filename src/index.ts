#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { handleContainerList } from "./tools/container-list.js";
import { handleImageList } from "./tools/image-list.js";
import { handleDockerfileAnalyzer } from "./tools/dockerfile-analyzer.js";
import { handleComposeAnalyzer } from "./tools/compose-analyzer.js";
import { handleContainerLogs } from "./tools/container-logs.js";

const server = new McpServer({
  name: "mcp-docker-tools",
  version: "1.0.0",
});

// Register: docker_container_list
server.tool(
  "docker_container_list",
  "List Docker containers with status, ports, image, created time, and resource usage. Can show only running containers or all containers including stopped ones.",
  {
    all: z.boolean().optional().default(false).describe("If true, show all containers including stopped ones. Defaults to false (running only)."),
    format: z.enum(["table", "json"]).optional().default("json").describe("Output format: 'table' for readable text, 'json' for structured data. Defaults to 'json'."),
  },
  async (args) => {
    const text = await handleContainerList(args);
    return { content: [{ type: "text" as const, text }] };
  }
);

// Register: docker_image_list
server.tool(
  "docker_image_list",
  "List Docker images with size, tags, created date, and layer count. Optionally filter by repository name.",
  {
    filter: z.string().optional().describe("Filter images by repository name (partial match). Leave empty to list all."),
    showDangling: z.boolean().optional().default(false).describe("Include dangling (untagged) images. Defaults to false."),
    format: z.enum(["table", "json"]).optional().default("json").describe("Output format: 'table' or 'json'. Defaults to 'json'."),
  },
  async (args) => {
    const text = await handleImageList(args);
    return { content: [{ type: "text" as const, text }] };
  }
);

// Register: docker_dockerfile_analyze
server.tool(
  "docker_dockerfile_analyze",
  "Analyze a Dockerfile for best practices including multi-stage builds, non-root user, .dockerignore usage, layer caching order, image size optimization, and security.",
  {
    content: z.string().describe("The full content of the Dockerfile to analyze."),
    checkDockerignore: z.boolean().optional().default(true).describe("If true, also checks for common .dockerignore recommendations. Defaults to true."),
  },
  async (args) => {
    const text = await handleDockerfileAnalyzer(args);
    return { content: [{ type: "text" as const, text }] };
  }
);

// Register: docker_compose_analyze
server.tool(
  "docker_compose_analyze",
  "Analyze docker-compose.yml: list services, ports, volumes, networks, health checks, dependencies. Suggest improvements.",
  {
    content: z.string().describe("The full content of the docker-compose.yml to analyze."),
  },
  async (args) => {
    const text = await handleComposeAnalyzer(args);
    return { content: [{ type: "text" as const, text }] };
  }
);

// Register: docker_container_logs
server.tool(
  "docker_container_logs",
  "Get logs from a Docker container. Supports retrieving the last N lines, filtering by keyword, and including timestamps.",
  {
    container: z.string().describe("Container name or ID to get logs from."),
    tail: z.number().optional().default(100).describe("Number of lines to retrieve from the end of logs. Defaults to 100."),
    since: z.string().optional().describe("Show logs since a timestamp (e.g., '2024-01-01T00:00:00') or relative duration (e.g., '1h', '30m')."),
    until: z.string().optional().describe("Show logs until a timestamp or relative duration."),
    filter: z.string().optional().describe("Filter log lines to only include those containing this keyword (case-insensitive)."),
    timestamps: z.boolean().optional().default(true).describe("Include timestamps in log output. Defaults to true."),
  },
  async (args) => {
    const text = await handleContainerLogs(args);
    return { content: [{ type: "text" as const, text }] };
  }
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("mcp-docker-tools server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
