import { execSync } from "node:child_process";

export const imageListTool = {
  name: "docker_image_list",
  description:
    "List Docker images with size, tags, created date, and layer count. " +
    "Optionally filter by repository name.",
  inputSchema: {
    type: "object" as const,
    properties: {
      filter: {
        type: "string",
        description: "Filter images by repository name (partial match). Leave empty to list all.",
      },
      showDangling: {
        type: "boolean",
        description: "Include dangling (untagged) images. Defaults to false.",
        default: false,
      },
      format: {
        type: "string",
        enum: ["table", "json"],
        description: "Output format: 'table' or 'json'. Defaults to 'json'.",
        default: "json",
      },
    },
    required: [],
  },
};

interface ImageInfo {
  id: string;
  repository: string;
  tag: string;
  size: string;
  created: string;
  layers: number;
}

function getLayerCount(imageId: string): number {
  try {
    const raw = execSync(`docker inspect --format="{{len .RootFS.Layers}}" ${imageId}`, {
      encoding: "utf-8",
      timeout: 10000,
    }).trim();
    return parseInt(raw, 10) || 0;
  } catch {
    return 0;
  }
}

export async function handleImageList(args: Record<string, unknown>): Promise<string> {
  const filter = (args.filter as string) || "";
  const showDangling = args.showDangling === true;
  const format = (args.format as string) || "json";

  try {
    let cmd = `docker images --format "{{.ID}}|||{{.Repository}}|||{{.Tag}}|||{{.Size}}|||{{.CreatedAt}}"`;
    if (!showDangling) {
      cmd += ` --filter "dangling=false"`;
    }
    if (filter) {
      cmd += ` ${filter}`;
    }

    const raw = execSync(cmd, { encoding: "utf-8", timeout: 15000 }).trim();

    if (!raw) {
      return filter
        ? `No images found matching '${filter}'.`
        : "No Docker images found on this system.";
    }

    const lines = raw.split("\n").filter((l) => l.trim());
    const images: ImageInfo[] = [];

    for (const line of lines) {
      const parts = line.split("|||");
      if (parts.length < 5) continue;

      const id = parts[0];
      images.push({
        id,
        repository: parts[1],
        tag: parts[2],
        size: parts[3],
        created: parts[4],
        layers: getLayerCount(id),
      });
    }

    const totalSize = images
      .map((img) => {
        const s = img.size.toUpperCase();
        if (s.includes("GB")) return parseFloat(s) * 1024;
        if (s.includes("MB")) return parseFloat(s);
        if (s.includes("KB")) return parseFloat(s) / 1024;
        return 0;
      })
      .reduce((a, b) => a + b, 0);

    const totalSizeStr =
      totalSize >= 1024
        ? `${(totalSize / 1024).toFixed(2)} GB`
        : `${totalSize.toFixed(1)} MB`;

    if (format === "json") {
      return JSON.stringify(
        { count: images.length, totalSize: totalSizeStr, images },
        null,
        2
      );
    }

    let table = `Found ${images.length} image(s) | Total size: ${totalSizeStr}\n\n`;
    for (const img of images) {
      table += `${img.repository}:${img.tag}\n`;
      table += `  ID:      ${img.id}\n`;
      table += `  Size:    ${img.size}\n`;
      table += `  Layers:  ${img.layers}\n`;
      table += `  Created: ${img.created}\n\n`;
    }
    return table.trim();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("not found") || message.includes("not recognized") || message.includes("ENOENT")) {
      return "Error: Docker is not installed or not available in PATH. Please install Docker and ensure the 'docker' command is accessible.";
    }
    if (message.includes("Cannot connect") || message.includes("Is the docker daemon running")) {
      return "Error: Cannot connect to the Docker daemon. Is Docker running?";
    }
    return `Error listing images: ${message}`;
  }
}
