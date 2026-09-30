const fs = require("fs"), path = require("path");
function flatten(obj, prefix, acc) {
  for (const k of Object.keys(obj)) {
    const v = obj[k], p = prefix ? prefix + "." + k : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, p, acc);
    else acc.add(p);
  }
  return acc;
}
const defined = new Set();
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.name.endsWith(".json")) {
      let obj; try { obj = JSON.parse(fs.readFileSync(full, "utf8")); } catch { continue; }
      flatten(obj, "", defined);
    }
  }
}
walk("src/i18n/locales");

const usedMap = new Map();
function walkSrc(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkSrc(full);
    else if (e.name.endsWith(".tsx") || e.name.endsWith(".ts")) {
      const txt = fs.readFileSync(full, "utf8");
      const rel = path.relative("src", full).split(path.sep).join("/");
      const re = /\bt\(\s*(['"`])([^'"`\n]+?)\1/g;
      let m;
      while ((m = re.exec(txt))) {
        const key = m[2];
        if (key.includes("${")) continue;
        if (!/^[a-zA-Z0-9_.]+$/.test(key)) continue;
        if (!usedMap.has(key)) usedMap.set(key, []);
        usedMap.get(key).push(rel);
      }
    }
  }
}
walkSrc("src");

let missing = 0;
const report = [];
for (const [key, files] of usedMap) {
  if (!defined.has(key)) { report.push([key, [...new Set(files)]]); missing++; }
}
console.log("Total distinct t() keys used: " + usedMap.size);
console.log("Used-but-not-defined (approx): " + missing);
for (const [key, files] of report.slice(0, 160)) {
  console.log("  " + key + "  <- " + files.slice(0, 3).join(", "));
}
