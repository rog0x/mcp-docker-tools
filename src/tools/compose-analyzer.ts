export const composeAnalyzerTool = {
  name: "docker_compose_analyze",
  description:
    "Analyze a docker-compose.yml file: list services, ports, volumes, networks, " +
    "health checks, dependencies, and environment variables. Suggests improvements " +
    "for production readiness, security, and best practices.",
  inputSchema: {
    type: "object" as const,
    properties: {
      content: {
        type: "string",
        description: "The full content of the docker-compose.yml to analyze.",
      },
    },
    required: ["content"],
  },
};

interface ServiceInfo {
  name: string;
  image?: string;
  build?: string;
  ports: string[];
  volumes: string[];
  networks: string[];
  dependsOn: string[];
  environment: string[];
  hasHealthcheck: boolean;
  restart?: string;
  hasResourceLimits: boolean;
  hasReadonlyRootfs: boolean;
  hasSecurityOpt: boolean;
}

interface ComposeAnalysis {
  version?: string;
  services: ServiceInfo[];
  topLevelNetworks: string[];
  topLevelVolumes: string[];
  findings: { severity: string; message: string; suggestion?: string }[];
}

function parseSimpleYaml(content: string): ComposeAnalysis {
  const lines = content.split("\n");
  const analysis: ComposeAnalysis = {
    services: [],
    topLevelNetworks: [],
    topLevelVolumes: [],
    findings: [],
  };

  let currentTopLevel = "";
  let currentService = "";
  let currentServiceKey = "";
  let inServiceBlock = false;
  const serviceMap = new Map<string, ServiceInfo>();

  for (const raw of lines) {
    // Skip comments and empty
    if (raw.trim().startsWith("#") || !raw.trim()) continue;

    const indent = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();

    // Top-level keys (no indent)
    if (indent === 0 && trimmed.endsWith(":")) {
      currentTopLevel = trimmed.replace(":", "").trim();
      currentService = "";
      currentServiceKey = "";
      inServiceBlock = currentTopLevel === "services";
      continue;
    }

    if (indent === 0 && trimmed.includes(":")) {
      const key = trimmed.split(":")[0].trim();
      const value = trimmed.substring(trimmed.indexOf(":") + 1).trim();
      if (key === "version") {
        analysis.version = value.replace(/['"]/g, "");
      }
      currentTopLevel = key;
      inServiceBlock = key === "services";
      currentService = "";
      continue;
    }

    // Service-level (indent 2)
    if (inServiceBlock && indent === 2 && trimmed.endsWith(":") && !trimmed.startsWith("-")) {
      currentService = trimmed.replace(":", "").trim();
      currentServiceKey = "";
      if (!serviceMap.has(currentService)) {
        serviceMap.set(currentService, {
          name: currentService,
          ports: [],
          volumes: [],
          networks: [],
          dependsOn: [],
          environment: [],
          hasHealthcheck: false,
          hasResourceLimits: false,
          hasReadonlyRootfs: false,
          hasSecurityOpt: false,
        });
      }
      continue;
    }

    const svc = serviceMap.get(currentService);

    // Service properties (indent 4)
    if (inServiceBlock && currentService && indent >= 4) {
      if (indent === 4 && trimmed.includes(":")) {
        const key = trimmed.split(":")[0].trim();
        const value = trimmed.substring(trimmed.indexOf(":") + 1).trim();
        currentServiceKey = key;

        if (svc) {
          if (key === "image") svc.image = value.replace(/['"]/g, "");
          if (key === "build") svc.build = value || "(context)";
          if (key === "restart") svc.restart = value.replace(/['"]/g, "");
          if (key === "healthcheck") svc.hasHealthcheck = true;
          if (key === "read_only" && value === "true") svc.hasReadonlyRootfs = true;
          if (key === "security_opt") svc.hasSecurityOpt = true;
          if (key === "deploy") svc.hasResourceLimits = true;

          // Inline port or volume
          if (key === "ports" && value && !value.startsWith("[")) {
            // Not a list, skip
          }
          if (key === "environment" && value) {
            // Inline map style
          }
        }
        continue;
      }

      // List items (indent 6 with -)
      if (trimmed.startsWith("-") && svc) {
        const item = trimmed.substring(1).trim().replace(/['"]/g, "");
        if (currentServiceKey === "ports") svc.ports.push(item);
        if (currentServiceKey === "volumes") svc.volumes.push(item);
        if (currentServiceKey === "networks") svc.networks.push(item);
        if (currentServiceKey === "depends_on") svc.dependsOn.push(item);
        if (currentServiceKey === "environment") svc.environment.push(item);
      }
    }

    // Top-level networks/volumes
    if (currentTopLevel === "networks" && indent === 2 && trimmed.endsWith(":")) {
      analysis.topLevelNetworks.push(trimmed.replace(":", "").trim());
    }
    if (currentTopLevel === "volumes" && indent === 2 && trimmed.endsWith(":")) {
      analysis.topLevelVolumes.push(trimmed.replace(":", "").trim());
    }
  }

  analysis.services = Array.from(serviceMap.values());
  return analysis;
}

function generateFindings(analysis: ComposeAnalysis): void {
  const findings = analysis.findings;

  if (analysis.version) {
    findings.push({
      severity: "info",
      message: `Compose version: ${analysis.version}. Note: 'version' is obsolete in Compose V2.`,
      suggestion: "The 'version' key can be removed when using Docker Compose V2.",
    });
  }

  for (const svc of analysis.services) {
    // Image tag
    if (svc.image && (svc.image.endsWith(":latest") || (!svc.image.includes(":") && !svc.image.includes("@")))) {
      findings.push({
        severity: "warning",
        message: `Service '${svc.name}': image '${svc.image}' uses :latest or no tag.`,
        suggestion: "Pin to a specific version for reproducible deployments.",
      });
    }

    // Restart policy
    if (!svc.restart) {
      findings.push({
        severity: "warning",
        message: `Service '${svc.name}': no restart policy defined.`,
        suggestion: "Add 'restart: unless-stopped' or 'restart: on-failure' for production.",
      });
    }

    // Health check
    if (!svc.hasHealthcheck) {
      findings.push({
        severity: "info",
        message: `Service '${svc.name}': no healthcheck defined.`,
        suggestion: "Add a healthcheck for better orchestration and monitoring.",
      });
    }

    // Resource limits
    if (!svc.hasResourceLimits) {
      findings.push({
        severity: "info",
        message: `Service '${svc.name}': no resource limits (deploy.resources) configured.`,
        suggestion: "Set memory and CPU limits to prevent a single container from consuming all host resources.",
      });
    }

    // Privileged ports
    for (const port of svc.ports) {
      const hostPort = port.split(":")[0];
      const portNum = parseInt(hostPort, 10);
      if (portNum > 0 && portNum < 1024) {
        findings.push({
          severity: "info",
          message: `Service '${svc.name}': uses privileged port ${portNum}.`,
          suggestion: "Privileged ports (<1024) may require elevated permissions.",
        });
      }
      if (port.startsWith("0.0.0.0:") || (!port.includes("127.0.0.1") && port.includes(":"))) {
        // Bound to all interfaces by default
      }
    }

    // Host volumes
    for (const vol of svc.volumes) {
      if (vol.includes("/var/run/docker.sock")) {
        findings.push({
          severity: "warning",
          message: `Service '${svc.name}': mounts Docker socket.`,
          suggestion: "Mounting the Docker socket gives full control over the Docker daemon. Use with extreme caution.",
        });
      }
    }

    // Environment secrets
    for (const env of svc.environment) {
      const lower = env.toLowerCase();
      if (lower.includes("password") || lower.includes("secret") || lower.includes("api_key") || lower.includes("token")) {
        findings.push({
          severity: "warning",
          message: `Service '${svc.name}': environment variable '${env.split("=")[0]}' may contain a secret.`,
          suggestion: "Use Docker secrets or an .env file (not committed to VCS) instead of inline values.",
        });
      }
    }
  }

  // Dependencies without healthcheck
  for (const svc of analysis.services) {
    for (const dep of svc.dependsOn) {
      const depSvc = analysis.services.find((s) => s.name === dep);
      if (depSvc && !depSvc.hasHealthcheck) {
        findings.push({
          severity: "info",
          message: `Service '${svc.name}' depends on '${dep}', but '${dep}' has no healthcheck.`,
          suggestion: "Add a healthcheck to the dependency and use 'condition: service_healthy' for reliable startup order.",
        });
      }
    }
  }
}

export async function handleComposeAnalyzer(args: Record<string, unknown>): Promise<string> {
  const content = args.content as string;

  if (!content || !content.trim()) {
    return "Error: docker-compose.yml content is empty. Please provide the file content to analyze.";
  }

  const analysis = parseSimpleYaml(content);
  generateFindings(analysis);

  const sections: string[] = [];

  sections.push("# Docker Compose Analysis Report\n");

  // Services overview
  sections.push(`## Services (${analysis.services.length})\n`);
  for (const svc of analysis.services) {
    sections.push(`### ${svc.name}`);
    if (svc.image) sections.push(`  Image: ${svc.image}`);
    if (svc.build) sections.push(`  Build: ${svc.build}`);
    if (svc.ports.length > 0) sections.push(`  Ports: ${svc.ports.join(", ")}`);
    if (svc.volumes.length > 0) sections.push(`  Volumes: ${svc.volumes.join(", ")}`);
    if (svc.networks.length > 0) sections.push(`  Networks: ${svc.networks.join(", ")}`);
    if (svc.dependsOn.length > 0) sections.push(`  Depends on: ${svc.dependsOn.join(", ")}`);
    if (svc.environment.length > 0) sections.push(`  Environment: ${svc.environment.length} variable(s)`);
    sections.push(`  Restart: ${svc.restart || "not set"}`);
    sections.push(`  Healthcheck: ${svc.hasHealthcheck ? "Yes" : "No"}`);
    sections.push("");
  }

  // Networks & Volumes
  if (analysis.topLevelNetworks.length > 0) {
    sections.push(`## Networks: ${analysis.topLevelNetworks.join(", ")}\n`);
  }
  if (analysis.topLevelVolumes.length > 0) {
    sections.push(`## Volumes: ${analysis.topLevelVolumes.join(", ")}\n`);
  }

  // Findings
  const warnings = analysis.findings.filter((f) => f.severity === "warning");
  const infos = analysis.findings.filter((f) => f.severity === "info");

  sections.push(`## Findings (${warnings.length} warnings, ${infos.length} info)\n`);
  for (const f of warnings) {
    sections.push(`[WARN] ${f.message}`);
    if (f.suggestion) sections.push(`  -> ${f.suggestion}`);
  }
  for (const f of infos) {
    sections.push(`[INFO] ${f.message}`);
    if (f.suggestion) sections.push(`  -> ${f.suggestion}`);
  }

  return sections.join("\n");
}
