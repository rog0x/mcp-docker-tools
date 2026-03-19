import { execSync } from "node:child_process";

export const containerListTool = {
  name: "docker_container_list",
  description:
    "List Docker containers with status, ports, image, created time, and resource usage. " +
    "Can show only running containers or all containers including stopped ones.",
  inputSchema: {
    type: "object" as const,
    properties: {
      all: {
        type: "boolean",
        description:
          "If true, show all containers including stopped ones. Defaults to false (running only).",
        default: false,
      },
      format: {
        type: "string",
        enum: ["table", "json"],
        description: "Output format: 'table' for readable text, 'json' for structured data. Defaults to 'json'.",
        default: "json",
      },
    },
    required: [],
  },
};

interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  ports: string;
  created: string;
  cpu: string;
  memory: string;
  memoryLimit: string;
  memoryPercent: string;
  networkIO: string;
  blockIO: string;
}

function getContainerStats(containerIds: string[]): Map<string, { cpu: string; memory: string; memoryLimit: string; memoryPercent: string; networkIO: string; blockIO: string }> {
  const statsMap = new Map<string, { cpu: string; memory: string; memoryLimit: string; memoryPercent: string; networkIO: string; blockIO: string }>();
  if (containerIds.length === 0) return statsMap;

  try {
    const raw = execSync(
      `docker stats --no-stream --format "{{.ID}}|||{{.CPUPerc}}|||{{.MemUsage}}|||{{.MemPerc}}|||{{.NetIO}}|||{{.BlockIO}}"`,
      { encoding: "utf-8", timeout: 30000 }
    ).trim();

    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const parts = line.split("|||");
      if (parts.length >= 6) {
        const memParts = parts[2].split(" / ");
        statsMap.set(parts[0], {
          cpu: parts[1],
          memory: memParts[0]?.trim() ?? "N/A",
          memoryLimit: memParts[1]?.trim() ?? "N/A",
          memoryPercent: parts[3],
          networkIO: parts[4],
          blockIO: parts[5],
        });
      }
    }
  } catch {
    // Stats unavailable for stopped containers — that's fine
  }
  return statsMap;
}

export async function handleContainerList(args: Record<string, unknown>): Promise<string> {
  const showAll = args.all === true;
  const format = (args.format as string) || "json";

  try {
    const allFlag = showAll ? " -a" : "";
    const raw = execSync(
      `docker ps${allFlag} --format "{{.ID}}|||{{.Names}}|||{{.Image}}|||{{.Status}}|||{{.State}}|||{{.Ports}}|||{{.CreatedAt}}" --no-trunc`,
      { encoding: "utf-8", timeout: 15000 }
    ).trim();

    if (!raw) {
      return showAll
        ? "No containers found."
        : "No running containers. Use { \"all\": true } to see stopped containers.";
    }

    const lines = raw.split("\n").filter((l) => l.trim());
    const containerIds: string[] = [];
    const containers: ContainerInfo[] = [];

    for (const line of lines) {
      const parts = line.split("|||");
      if (parts.length < 7) continue;
      const id = parts[0].substring(0, 12);
      containerIds.push(id);
      containers.push({
        id,
        name: parts[1],
        image: parts[2],
        status: parts[3],
        state: parts[4],
        ports: parts[5] || "none",
        created: parts[6],
        cpu: "N/A",
        memory: "N/A",
        memoryLimit: "N/A",
        memoryPercent: "N/A",
        networkIO: "N/A",
        blockIO: "N/A",
      });
    }

    const stats = getContainerStats(containerIds);
    for (const c of containers) {
      const s = stats.get(c.id);
      if (s) {
        c.cpu = s.cpu;
        c.memory = s.memory;
        c.memoryLimit = s.memoryLimit;
        c.memoryPercent = s.memoryPercent;
        c.networkIO = s.networkIO;
        c.blockIO = s.blockIO;
      }
    }

    if (format === "json") {
      return JSON.stringify({ count: containers.length, containers }, null, 2);
    }

    let table = `Found ${containers.length} container(s):\n\n`;
    for (const c of containers) {
      table += `--- ${c.name} (${c.id}) ---\n`;
      table += `  Image:    ${c.image}\n`;
      table += `  State:    ${c.state} | ${c.status}\n`;
      table += `  Ports:    ${c.ports}\n`;
      table += `  Created:  ${c.created}\n`;
      table += `  CPU:      ${c.cpu}\n`;
      table += `  Memory:   ${c.memory} / ${c.memoryLimit} (${c.memoryPercent})\n`;
      table += `  Net I/O:  ${c.networkIO}\n`;
      table += `  Block IO: ${c.blockIO}\n\n`;
    }
    return table.trim();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("not found") || message.includes("not recognized") || message.includes("ENOENT")) {
      return "Error: Docker is not installed or not available in PATH. Please install Docker and ensure the 'docker' command is accessible.";
    }
    if (message.includes("Cannot connect") || message.includes("permission denied") || message.includes("Is the docker daemon running")) {
      return "Error: Cannot connect to the Docker daemon. Is Docker running? You may also need appropriate permissions.";
    }
    return `Error listing containers: ${message}`;
  }
}
