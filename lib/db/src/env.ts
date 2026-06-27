import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function parseEnv(content: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    values[key] = value.replace(/\\n/g, "\n");
  }

  return values;
}

function loadFile(filePath: string) {
  if (!existsSync(filePath)) {
    return;
  }

  const parsed = parseEnv(readFileSync(filePath, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function findRepoRoot(startDir: string): string {
  let currentDir = path.resolve(startDir);

  while (true) {
    if (existsSync(path.join(currentDir, "pnpm-workspace.yaml"))) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error(`Could not locate workspace root from ${startDir}`);
    }
    currentDir = parentDir;
  }
}

export function loadDatabaseEnv(baseDir: string) {
  const repoRoot = findRepoRoot(baseDir);

  const candidates = [
    path.join(repoRoot, ".env.local"),
    path.join(repoRoot, ".env"),
    path.join(repoRoot, "artifacts", "api-server", ".env.local"),
    path.join(repoRoot, "artifacts", "api-server", ".env"),
    path.join(repoRoot, "lib", "db", ".env.local"),
    path.join(repoRoot, "lib", "db", ".env"),
  ];

  for (const candidate of candidates) {
    loadFile(candidate);
  }
}
