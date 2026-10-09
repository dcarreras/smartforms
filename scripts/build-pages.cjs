const { cp, mkdir, rm, stat } = require("node:fs/promises");
const { join } = require("node:path");

const root = join(__dirname, "..");
const output = join(root, "dist");
const directories = [".well-known", "assets", "ffdnet", "fonts", "js", "models", "styles", "vendor"];
const files = ["favicon.svg", "google6c725a899ef3c23d.html", "index.html", "robots.txt", "site.webmanifest", "sitemap.xml", "sw.js"];

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function copy(source) {
  await cp(join(root, source), join(output, source), { recursive: true, dereference: true });
}

async function build() {
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const path of [...directories, ...files]) {
    if (await exists(join(root, path))) await copy(path);
  }
}

build().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
