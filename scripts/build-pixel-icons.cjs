const { readFile, readdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

const root = join(__dirname, "..");
const output = join(root, "vendor", "pixelarticons.min.js");
const sourceFiles = ["index.html", "tests/evaluate.html"];

const aliases = {
  "alert-triangle": "alert",
  "arrow-down-to-line": "arrow-bar-down",
  "arrow-left-right": "arrows-horizontal",
  "arrow-up-down": "arrows-vertical",
  "arrow-up-right": "arrow-right",
  "arrow-up-to-line": "arrow-bar-up",
  "check-circle-2": "check",
  "check-square": "checkbox",
  "chevron-down-square": "square-chevron-down",
  "circle-dot": "target",
  "circle-help": "circle-info",
  "clipboard-list": "checklist",
  "cookie": "circle",
  "copy-plus": "copy",
  "crosshair": "target",
  "disc": "circle",
  "distribute-horizontal": "layout-distribute-horizontal",
  "distribute-vertical": "layout-distribute-vertical",
  "download-cloud": "cloud-download",
  "edit-3": "edit",
  "file-check": "file-text",
  "file-input": "file-alt",
  "file-json": "file-text",
  "file-spreadsheet": "file-text",
  "file-up": "upload",
  "flask-conical": "test-tube",
  "fold-vertical": "flip-vertical-2",
  "folder-open": "folder",
  "form-input": "text-cursor-input",
  "grip-vertical": "more-vertical",
  "help-circle": "circle-info",
  info: "circle-info",
  "layout-grid": "grid",
  "layout-template": "layout",
  "loader-2": "loader",
  maximize: "expand",
  "maximize-2": "expand",
  "message-square": "message",
  "message-square-plus": "message-plus",
  "minimize-2": "zoom-out",
  "mouse-pointer": "pointer",
  "mouse-pointer-click": "mouse",
  "move-horizontal": "arrows-horizontal",
  "panel-left-close": "layout-sidebar-left",
  "panel-left-open": "layout-sidebar-left",
  "panel-right-close": "layout-sidebar-right",
  "panel-right-open": "layout-sidebar-right",
  "pen-tool": "pencil",
  "plus-circle": "plus",
  "redo-2": "redo",
  scaling: "scale",
  "scan-line": "ai-scan",
  "search-x": "search",
  settings: "settings-cog",
  "share-2": "share",
  "shield-check": "shield",
  "square-dashed": "square-dashed-cursor",
  "stretch-horizontal": "arrows-horizontal",
  tags: "label",
  "trash-2": "trash",
  type: "text-cursor",
  "undo-2": "undo",
  "wand-sparkles": "wand",
};

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    if (entry.isFile() && entry.name.endsWith(".js")) files.push(path);
  }
  return files;
}

async function collectRequiredIcons() {
  const files = [
    ...sourceFiles.map(path => join(root, path)),
    ...await walk(join(root, "js")),
  ];
  const names = new Set();
  for (const file of files) {
    const content = await readFile(file, "utf8");
    for (const match of content.matchAll(/data-pixel-icon=["']([a-z0-9-]+)["']/g)) names.add(match[1]);
    for (const match of content.matchAll(/\bicon:\s*["']([a-z0-9-]+)["']/g)) names.add(match[1]);
  }
  return [...names].sort();
}

async function buildPixelIcons() {
  const collection = require("@iconify-json/pixelarticons/icons.json");
  const required = await collectRequiredIcons();
  const unresolved = required.filter(name => !collection.icons[aliases[name] || name]);
  if (unresolved.length) {
    throw new Error(`Missing Pixelarticons mappings: ${unresolved.join(", ")}`);
  }

  const icons = Object.fromEntries(required.map(name => {
    const resolvedName = aliases[name] || name;
    return [resolvedName, collection.icons[resolvedName]];
  }));

  const bundle = `/*! Pixelarticons (MIT) - https://pixelarticons.com/ */\n(() => {\n  const icons = ${JSON.stringify(icons)};\n  const aliases = ${JSON.stringify(aliases)};\n  const namespace = "http://www.w3.org/2000/svg";\n\n  function renderIcon(node) {\n    const requestedName = node.getAttribute("data-pixel-icon");\n    const icon = icons[aliases[requestedName] || requestedName];\n    if (!icon) throw new Error(\`Missing Pixelarticon: \${requestedName}\`);\n    const svg = document.createElementNS(namespace, "svg");\n    for (const attribute of node.attributes) {\n      svg.setAttribute(attribute.name, attribute.value);\n    }\n    svg.classList.add("pixel-icon");\n    svg.setAttribute("viewBox", \`0 0 \${icon.width || 24} \${icon.height || 24}\`);\n    svg.setAttribute("fill", "none");\n    svg.setAttribute("focusable", "false");\n    if (!svg.hasAttribute("aria-label")) svg.setAttribute("aria-hidden", "true");\n    svg.innerHTML = icon.body;\n    node.replaceWith(svg);\n  }\n\n  function renderPixelIcons(root = document) {\n    if (root instanceof Element && root.matches("i[data-pixel-icon]")) renderIcon(root);\n    const nodes = root.querySelectorAll ? root.querySelectorAll("i[data-pixel-icon]") : [];\n    nodes.forEach(renderIcon);\n  }\n\n  window.renderPixelIcons = renderPixelIcons;\n  window.pixelarticons = { renderPixelIcons };\n  if (document.readyState === "loading") {\n    document.addEventListener("DOMContentLoaded", () => renderPixelIcons());\n  } else {\n    renderPixelIcons();\n  }\n})();\n`;
  await writeFile(output, bundle);
}

if (require.main === module) {
  buildPixelIcons().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { buildPixelIcons };
