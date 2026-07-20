import fs from "fs";
import path from "path";

const root = path.join(process.cwd(), "src");
const exts = new Set([".ts", ".tsx"]);
const files = [];

function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (exts.has(path.extname(e.name))) files.push(p);
  }
}
walk(root);

const norm = (p) => p.replace(/\\/g, "/");
const fileSet = new Set(files.map((f) => norm(f)));
const entries = new Set(["main.tsx", "App.tsx", "vite-env.d.ts", "benchmark-cli-bootstrap.tsx"]);
const testSuffix = /\.(test|spec)\.(ts|tsx)$/;

function importRefs(content) {
  const refs = [];
  const re1 = /from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re1.exec(content))) refs.push(m[1]);
  const re2 = /import\s*\(\s*['"]([^'"]+)['"]/g;
  while ((m = re2.exec(content))) refs.push(m[1]);
  return refs;
}

function resolveImport(from, spec) {
  if (!spec.startsWith(".") && !spec.startsWith("@/")) return null;
  let base;
  if (spec.startsWith("@/")) base = path.join(root, spec.slice(2));
  else base = path.resolve(path.dirname(from), spec);
  const tryPaths = [];
  if (base.endsWith(".ts") || base.endsWith(".tsx")) tryPaths.push(base);
  else {
    tryPaths.push(base + ".ts", base + ".tsx", path.join(base, "index.ts"), path.join(base, "index.tsx"));
  }
  for (const p of tryPaths) {
    if (fileSet.has(norm(p))) return norm(p);
  }
  return null;
}

const importedBy = new Map(files.map((f) => [norm(f), new Set()]));
for (const f of files) {
  let content;
  try {
    content = fs.readFileSync(f, "utf8");
  } catch {
    continue;
  }
  for (const spec of importRefs(content)) {
    const target = resolveImport(f, spec);
    if (target) importedBy.get(target).add(norm(f));
  }
}

const orphans = [];
for (const f of files) {
  const nf = norm(f);
  const base = path.basename(f);
  if (entries.has(base)) continue;
  if (testSuffix.test(f)) continue;
  const importers = importedBy.get(nf);
  if (!importers || importers.size === 0) orphans.push(nf.replace(/.*\/src\//, "src/"));
}
orphans.sort();
console.log("ORPHAN_NON_TEST_FILES:", orphans.length);
for (const o of orphans) console.log(o);
