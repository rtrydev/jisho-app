// Copy kuromoji IPADIC dictionary files into /public/dict/ so the browser can
// fetch them at runtime. Runs as a postinstall step.

import fs from "node:fs";
import path from "node:path";

const src = path.join("node_modules", "kuromoji", "dict");
const dst = path.join("public", "dict");

if (!fs.existsSync(src)) process.exit(0);
fs.mkdirSync(dst, { recursive: true });
for (const f of fs.readdirSync(src)) {
  if (!f.endsWith(".dat.gz")) continue;
  fs.copyFileSync(path.join(src, f), path.join(dst, f));
}
