/**
 * Fails when development-only tooling (the schema inspector, the capture harness) leaked into the
 * production bundle. Run after `npm run build`:  npm run check:dist-dev-only
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = new URL("../desktop/dist/", import.meta.url);
const markers = ["Schema inspector (development only)", "Containers without layout", "Text clamp risk", "Row candidates", "UISchema JSON (read-only)", "schema-inspector",
  "V2C capture harness", "capture-harness", "harness.invalid", "harness-token"];

function* files(directory: string): Generator<string> {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else yield path;
  }
}

const root = fileURLToPath(dist);
if (!existsSync(root)) { console.error("desktop/dist not found: run `npm run build` first."); process.exit(2); }
const leaks: string[] = [];
let scanned = 0;
for (const path of files(root)) {
  if (!/\.(js|css|html|map)$/.test(path)) continue;
  scanned++;
  const content = readFileSync(path, "utf8");
  for (const marker of markers) if (content.includes(marker)) leaks.push(`${marker}  <-  ${path}`);
}
if (leaks.length > 0) { console.error(`Development-only tooling found in the production bundle:\n${leaks.join("\n")}`); process.exit(1); }
console.log(`OK: none of ${markers.length} development-only markers appear in ${scanned} files of desktop/dist.`);
