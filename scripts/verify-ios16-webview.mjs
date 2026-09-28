import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const distDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(repoRoot, "frontend", "dist")

const indexHtml = fs.readFileSync(path.join(distDir, "index.html"), "utf8")
const initialAssets = [
  ...indexHtml.matchAll(/(?:src|href)="(\.\/assets\/[^"]+\.js)"/g),
].map((match) => match[1].replace(/^\.\//, ""))

if (initialAssets.length === 0) {
  throw new Error("iOS 16 compatibility check found no initial JavaScript assets")
}

const visited = new Set()
const queue = initialAssets.map((asset) => path.resolve(distDir, asset))
const failures = []

while (queue.length > 0) {
  const filePath = queue.shift()
  if (!filePath || visited.has(filePath)) continue
  visited.add(filePath)

  const relative = path.relative(distDir, filePath).split(path.sep).join("/")
  const code = fs.readFileSync(filePath, "utf8")
  if (/\(\?<[=!]/.test(code)) {
    failures.push(`${relative} contains a regular-expression lookbehind`)
  }

  const staticImportPattern =
    /from\s*["'](\.\/[^"']+\.js)["']|import\s*["'](\.\/[^"']+\.js)["']/g
  for (const match of code.matchAll(staticImportPattern)) {
    const specifier = match[1] || match[2]
    queue.push(path.resolve(path.dirname(filePath), specifier))
  }
}

if (failures.length > 0) {
  throw new Error(`iOS 16 WebView compatibility check failed:\n- ${failures.join("\n- ")}`)
}

console.log(
  `iOS 16 WebView compatibility check passed (${visited.size} initial JavaScript assets)`,
)
