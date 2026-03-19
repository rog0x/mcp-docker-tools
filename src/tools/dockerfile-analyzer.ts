export const dockerfileAnalyzerTool = {
  name: "docker_dockerfile_analyze",
  description:
    "Analyze a Dockerfile for best practices including multi-stage builds, non-root user, " +
    ".dockerignore usage, layer caching order, image size optimization, and security. " +
    "Provide the Dockerfile content as input and receive a detailed report with suggestions.",
  inputSchema: {
    type: "object" as const,
    properties: {
      content: {
        type: "string",
        description: "The full content of the Dockerfile to analyze.",
      },
      checkDockerignore: {
        type: "boolean",
        description: "If true, also checks for common .dockerignore recommendations. Defaults to true.",
        default: true,
      },
    },
    required: ["content"],
  },
};

interface Finding {
  category: string;
  severity: "info" | "warning" | "error";
  message: string;
  suggestion?: string;
  line?: number;
}

function analyzeDockerfile(content: string, checkDockerignore: boolean): { findings: Finding[]; summary: Record<string, unknown> } {
  const lines = content.split("\n");
  const findings: Finding[] = [];

  const fromStatements: { line: number; image: string; alias?: string }[] = [];
  let hasUser = false;
  let hasCopy = false;
  let hasAdd = false;
  let hasHealthcheck = false;
  let hasExpose = false;
  let hasWorkdir = false;
  let runCount = 0;
  let hasAptGetCleanup = false;
  let usesLatestTag = false;
  let hasEnvForVersions = false;
  let copiesBeforeRun = false;
  let lastCopyLine = -1;
  let lastRunLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    const lineNum = i + 1;

    // Skip comments and empty
    if (trimmed.startsWith("#") || !trimmed) continue;

    const instruction = trimmed.split(/\s+/)[0].toUpperCase();

    if (instruction === "FROM") {
      const rest = trimmed.substring(4).trim();
      const parts = rest.split(/\s+/);
      const image = parts[0];
      const alias = parts.find((_, idx) => idx > 0 && parts[idx - 1]?.toUpperCase() === "AS");
      fromStatements.push({ line: lineNum, image, alias });

      if (image.endsWith(":latest") || (!image.includes(":") && !image.includes("@"))) {
        usesLatestTag = true;
        findings.push({
          category: "Versioning",
          severity: "warning",
          message: `Line ${lineNum}: Base image '${image}' uses implicit or explicit :latest tag.`,
          suggestion: "Pin to a specific version tag (e.g., node:20-alpine) for reproducible builds.",
          line: lineNum,
        });
      }

      if (!image.includes("alpine") && !image.includes("slim") && !image.includes("distroless") && !image.includes("scratch")) {
        findings.push({
          category: "Image Size",
          severity: "info",
          message: `Line ${lineNum}: Base image '${image}' is not a minimal variant.`,
          suggestion: "Consider using an alpine, slim, or distroless variant to reduce image size.",
          line: lineNum,
        });
      }
    }

    if (instruction === "RUN") {
      runCount++;
      lastRunLine = lineNum;

      if (trimmed.includes("apt-get") || trimmed.includes("apk add")) {
        if (trimmed.includes("rm -rf /var/lib/apt/lists") || trimmed.includes("--no-cache")) {
          hasAptGetCleanup = true;
        } else {
          findings.push({
            category: "Layer Caching",
            severity: "warning",
            message: `Line ${lineNum}: Package install without cache cleanup.`,
            suggestion: "Add 'rm -rf /var/lib/apt/lists/*' in the same RUN layer, or use 'apk add --no-cache'.",
            line: lineNum,
          });
        }
      }

      if (trimmed.includes("curl") && !trimmed.includes("--fail")) {
        findings.push({
          category: "Reliability",
          severity: "info",
          message: `Line ${lineNum}: curl used without --fail flag.`,
          suggestion: "Use 'curl --fail' so the build fails on HTTP errors.",
          line: lineNum,
        });
      }
    }

    if (instruction === "COPY") {
      hasCopy = true;
      lastCopyLine = lineNum;
      if (lastRunLine > 0 && lastCopyLine > lastRunLine) {
        // This is normal — but copying app code before dependency install is not
      }
    }

    if (instruction === "ADD") {
      hasAdd = true;
      if (!trimmed.includes(".tar") && !trimmed.includes("http")) {
        findings.push({
          category: "Best Practice",
          severity: "warning",
          message: `Line ${lineNum}: ADD instruction used instead of COPY.`,
          suggestion: "Use COPY unless you specifically need ADD's tar extraction or URL features.",
          line: lineNum,
        });
      }
    }

    if (instruction === "USER") {
      hasUser = true;
    }

    if (instruction === "HEALTHCHECK") {
      hasHealthcheck = true;
    }

    if (instruction === "EXPOSE") {
      hasExpose = true;
    }

    if (instruction === "WORKDIR") {
      hasWorkdir = true;
    }

    if (instruction === "ENV") {
      hasEnvForVersions = true;
    }
  }

  // Multi-stage build check
  const isMultiStage = fromStatements.length > 1;
  if (!isMultiStage) {
    findings.push({
      category: "Multi-stage Build",
      severity: "info",
      message: "Dockerfile does not use multi-stage builds.",
      suggestion:
        "Multi-stage builds reduce final image size by separating build dependencies from runtime. " +
        "Consider adding a build stage and copying only needed artifacts to the final stage.",
    });
  } else {
    findings.push({
      category: "Multi-stage Build",
      severity: "info",
      message: `Good: Uses multi-stage build with ${fromStatements.length} stages.`,
    });
  }

  // Non-root user
  if (!hasUser) {
    findings.push({
      category: "Security",
      severity: "warning",
      message: "No USER instruction found. Container will run as root by default.",
      suggestion: "Add a USER instruction to run as a non-root user (e.g., USER 1001 or USER appuser).",
    });
  }

  // HEALTHCHECK
  if (!hasHealthcheck) {
    findings.push({
      category: "Reliability",
      severity: "info",
      message: "No HEALTHCHECK instruction found.",
      suggestion: "Add a HEALTHCHECK to enable Docker to monitor container health.",
    });
  }

  // RUN consolidation
  if (runCount > 5) {
    findings.push({
      category: "Layer Caching",
      severity: "warning",
      message: `Found ${runCount} separate RUN instructions.`,
      suggestion:
        "Consolidate related RUN commands using && to reduce the number of image layers.",
    });
  }

  // WORKDIR
  if (!hasWorkdir && hasCopy) {
    findings.push({
      category: "Best Practice",
      severity: "info",
      message: "No WORKDIR instruction found.",
      suggestion: "Use WORKDIR to set a working directory instead of relying on the default or using 'cd' in RUN.",
    });
  }

  // Layer caching order hint
  if (hasCopy && runCount > 0) {
    findings.push({
      category: "Layer Caching",
      severity: "info",
      message: "Tip: Copy dependency manifests (package.json, requirements.txt) before source code.",
      suggestion:
        "COPY package*.json ./ then RUN npm install, then COPY the rest. " +
        "This leverages Docker layer caching so dependencies are only reinstalled when manifests change.",
    });
  }

  // .dockerignore
  if (checkDockerignore) {
    findings.push({
      category: ".dockerignore",
      severity: "info",
      message: "Ensure a .dockerignore file exists alongside the Dockerfile.",
      suggestion:
        "Common entries: node_modules, .git, .env, dist, *.log, .DS_Store, __pycache__, .venv",
    });
  }

  const score = calculateScore(findings);

  return {
    findings,
    summary: {
      totalFindings: findings.length,
      errors: findings.filter((f) => f.severity === "error").length,
      warnings: findings.filter((f) => f.severity === "warning").length,
      info: findings.filter((f) => f.severity === "info").length,
      stages: fromStatements.length,
      isMultiStage,
      hasNonRootUser: hasUser,
      hasHealthcheck,
      runInstructions: runCount,
      usesLatestTag,
      score,
    },
  };
}

function calculateScore(findings: Finding[]): string {
  let score = 100;
  for (const f of findings) {
    if (f.severity === "error") score -= 15;
    if (f.severity === "warning") score -= 7;
  }
  score = Math.max(0, score);
  if (score >= 80) return `${score}/100 (Good)`;
  if (score >= 50) return `${score}/100 (Needs improvement)`;
  return `${score}/100 (Poor)`;
}

export async function handleDockerfileAnalyzer(args: Record<string, unknown>): Promise<string> {
  const content = args.content as string;
  const checkDockerignore = args.checkDockerignore !== false;

  if (!content || !content.trim()) {
    return "Error: Dockerfile content is empty. Please provide the Dockerfile content to analyze.";
  }

  const { findings, summary } = analyzeDockerfile(content, checkDockerignore);

  const sections: string[] = [];

  sections.push("# Dockerfile Analysis Report\n");
  sections.push(`Score: ${summary.score}`);
  sections.push(`Stages: ${summary.stages} | Multi-stage: ${summary.isMultiStage ? "Yes" : "No"}`);
  sections.push(`Non-root user: ${summary.hasNonRootUser ? "Yes" : "No"} | Healthcheck: ${summary.hasHealthcheck ? "Yes" : "No"}`);
  sections.push(`Findings: ${summary.errors} errors, ${summary.warnings} warnings, ${summary.info} info\n`);

  const grouped: Record<string, Finding[]> = {};
  for (const f of findings) {
    if (!grouped[f.category]) grouped[f.category] = [];
    grouped[f.category].push(f);
  }

  for (const [category, items] of Object.entries(grouped)) {
    sections.push(`## ${category}`);
    for (const item of items) {
      const icon = item.severity === "error" ? "[ERROR]" : item.severity === "warning" ? "[WARN]" : "[INFO]";
      const lineRef = item.line ? ` (line ${item.line})` : "";
      sections.push(`${icon}${lineRef} ${item.message}`);
      if (item.suggestion) {
        sections.push(`  -> ${item.suggestion}`);
      }
    }
    sections.push("");
  }

  return sections.join("\n");
}
