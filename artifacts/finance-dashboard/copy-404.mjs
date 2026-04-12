import { copyFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "dist", "public");
const indexPath = path.join(distDir, "index.html");
const notFoundPath = path.join(distDir, "404.html");

try {
  await access(indexPath);
  await copyFile(indexPath, notFoundPath);
} catch (error) {
  console.error("Failed to create 404.html from index.html");
  throw error;
}
