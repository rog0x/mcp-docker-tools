# mcp-docker-tools

Docker management tools for AI agents, built on the [Model Context Protocol](https://modelcontextprotocol.io).

Provides five tools for inspecting containers, images, Dockerfiles, and Compose configurations — all accessible to LLMs through MCP.

## Tools

| Tool | Description |
|------|-------------|
| `docker_container_list` | List running or all containers with status, ports, image, created time, and resource usage (CPU, memory, network/block I/O) |
| `docker_image_list` | List Docker images with size, tags, created date, and layer count |
| `docker_dockerfile_analyze` | Analyze a Dockerfile for best practices: multi-stage builds, non-root user, layer caching, image size, security |
| `docker_compose_analyze` | Analyze docker-compose.yml: services, ports, volumes, networks, health checks, dependencies, and improvement suggestions |
| `docker_container_logs` | Get container logs with tail, keyword filter, time range, and timestamp support |

## Prerequisites

- **Node.js** >= 18
- **Docker** CLI installed and accessible in PATH
- Docker daemon running (for container/image tools)

## Installation

```bash
git clone <repo-url>
cd mcp-docker-tools
npm install
npm run build
```

## Usage with Claude Desktop

Add to your Claude Desktop configuration (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "docker-tools": {
      "command": "node",
      "args": ["D:/products/mcp-servers/mcp-docker-tools/dist/index.js"]
    }
  }
}
```

## Usage with Claude Code

```bash
claude mcp add docker-tools node D:/products/mcp-servers/mcp-docker-tools/dist/index.js
```

Or add to `.claude/settings.json`:

```json
{
  "mcpServers": {
    "docker-tools": {
      "command": "node",
      "args": ["D:/products/mcp-servers/mcp-docker-tools/dist/index.js"]
    }
  }
}
```

## Tool Examples

### List running containers
```json
{ "tool": "docker_container_list" }
```

### List all containers including stopped
```json
{ "tool": "docker_container_list", "args": { "all": true, "format": "table" } }
```

### List images filtered by name
```json
{ "tool": "docker_image_list", "args": { "filter": "node" } }
```

### Analyze a Dockerfile
```json
{
  "tool": "docker_dockerfile_analyze",
  "args": {
    "content": "FROM node:20\nCOPY . .\nRUN npm install\nCMD [\"node\", \"index.js\"]"
  }
}
```

### Analyze docker-compose.yml
```json
{
  "tool": "docker_compose_analyze",
  "args": {
    "content": "services:\n  web:\n    image: nginx\n    ports:\n      - 80:80"
  }
}
```

### Get container logs
```json
{
  "tool": "docker_container_logs",
  "args": { "container": "my-app", "tail": 50, "filter": "error" }
}
```

## License

MIT
