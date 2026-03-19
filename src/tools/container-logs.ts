import { execSync } from "node:child_process";

export const containerLogsTool = {
  name: "docker_container_logs",
  description:
    "Get logs from a Docker container. Supports retrieving the last N lines, " +
    "filtering by keyword, and including timestamps. Can target a container by name or ID.",
  inputSchema: {
    type: "object" as const,
    properties: {
      container: {
        type: "string",
        description: "Container name or ID to get logs from.",
      },
      tail: {
        type: "number",
        description: "Number of lines to retrieve from the end of logs. Defaults to 100.",
        default: 100,
      },
      since: {
        type: "string",
        description: "Show logs since a timestamp (e.g., '2024-01-01T00:00:00') or relative duration (e.g., '1h', '30m').",
      },
      until: {
        type: "string",
        description: "Show logs until a timestamp or relative duration.",
      },
      filter: {
        type: "string",
        description: "Filter log lines to only include those containing this keyword (case-insensitive).",
      },
      timestamps: {
        type: "boolean",
        description: "Include timestamps in log output. Defaults to true.",
        default: true,
      },
    },
    required: ["container"],
  },
};

export async function handleContainerLogs(args: Record<string, unknown>): Promise<string> {
  const container = args.container as string;
  const tail = typeof args.tail === "number" ? args.tail : 100;
  const since = args.since as string | undefined;
  const until = args.until as string | undefined;
  const filter = args.filter as string | undefined;
  const timestamps = args.timestamps !== false;

  if (!container || !container.trim()) {
    return "Error: 'container' parameter is required. Provide a container name or ID.";
  }

  try {
    // Verify container exists
    try {
      execSync(`docker inspect --type=container ${container}`, {
        encoding: "utf-8",
        timeout: 10000,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      return `Error: Container '${container}' not found. Use docker_container_list to see available containers.`;
    }

    // Build the logs command
    const parts = ["docker", "logs"];
    if (timestamps) parts.push("--timestamps");
    parts.push(`--tail=${tail}`);
    if (since) parts.push(`--since=${since}`);
    if (until) parts.push(`--until=${until}`);
    parts.push(container);

    // docker logs outputs to stderr for some containers, capture both
    const raw = execSync(parts.join(" "), {
      encoding: "utf-8",
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Also capture stderr since docker logs sends some output there
    let combined: string;
    try {
      combined = execSync(parts.join(" ") + " 2>&1", {
        encoding: "utf-8",
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch {
      combined = raw;
    }

    if (!combined.trim()) {
      return `No logs found for container '${container}' with the specified parameters.`;
    }

    let lines = combined.split("\n");

    // Apply keyword filter
    if (filter) {
      const lowerFilter = filter.toLowerCase();
      lines = lines.filter((line) => line.toLowerCase().includes(lowerFilter));

      if (lines.length === 0) {
        return `No log lines matching '${filter}' found in the last ${tail} lines of container '${container}'.`;
      }
    }

    const header = `Logs for container '${container}' (${lines.length} lines)`;
    const separator = "=".repeat(Math.min(header.length, 60));

    const result = [header, separator, ...lines].join("\n");

    // Truncate if extremely long
    if (result.length > 50000) {
      return result.substring(0, 50000) + "\n\n... [output truncated at 50KB]";
    }

    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("not found") || message.includes("not recognized") || message.includes("ENOENT")) {
      return "Error: Docker is not installed or not available in PATH. Please install Docker and ensure the 'docker' command is accessible.";
    }
    if (message.includes("Cannot connect") || message.includes("Is the docker daemon running")) {
      return "Error: Cannot connect to the Docker daemon. Is Docker running?";
    }
    return `Error fetching logs for '${container}': ${message}`;
  }
}
