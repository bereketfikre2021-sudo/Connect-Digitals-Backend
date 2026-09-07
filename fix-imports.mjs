import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, relative, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, "src");

function walk(dir) {
  const result = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    statSync(full).isDirectory() ? result.push(...walk(full)) : full.endsWith(".ts") && result.push(full);
  }
  return result;
}

// Map: broken import string -> absolute path of real file
const BROKEN = {
  "/lib/prisma.js":        join(srcDir, "lib/prisma.js"),
  "../lib/prisma.js":      join(srcDir, "lib/prisma.js"),
  "/shared/index.js":      join(srcDir, "shared/index.js"),
  "../shared/index.js":    join(srcDir, "shared/index.js"),
  "/validation/index.js":  join(srcDir, "validation/index.js"),
  "../validation/index.js":join(srcDir, "validation/index.js"),
};

let fixed = 0;
for (const file of walk(srcDir)) {
  const fileDir = dirname(file);
  let content = readFileSync(file, "utf8");
  let changed = false;

  for (const [broken, absTarget] of Object.entries(BROKEN)) {
    if (!content.includes(`"${broken}"`) && !content.includes(`'${broken}'`)) continue;
    let rel = relative(fileDir, absTarget).replace(/\\/g, "/");
    if (!rel.startsWith(".")) rel = "./" + rel;
    content = content.replaceAll(`"${broken}"`, `"${rel}"`).replaceAll(`'${broken}'`, `"${rel}"`);
    changed = true;
  }

  if (changed) { writeFileSync(file, content); fixed++; }
}
console.log(`Fixed ${fixed} files`);
