// Build a "lite" Chrome Web Store package WITHOUT the Gmail integration.
//
// It reuses the same source in extension/, but produces a manifest that drops
// the gmail-bridge content script and the mail.google.com host permission, and
// omits gmail-bridge.js from the package. Output:
//   getaibd-page-assistant-lite-v1.0.0.zip
import {
  mkdirSync,
  rmSync,
  cpSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ext = resolve(root, "extension");
const out = resolve(root, "build/lite");
const zipPath = resolve(root, "getaibd-page-assistant-lite-v1.0.0.zip");

// Fresh build dir.
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// Files that make up the lite build (note: no gmail-bridge.js).
const files = [
  "background.js",
  "panel.js",
  "options.html",
  "options.css",
  "options.js",
];
for (const f of files) cpSync(resolve(ext, f), resolve(out, f));
cpSync(resolve(ext, "icons"), resolve(out, "icons"), { recursive: true });

// Lite manifest: drop the Gmail content script + host permission.
const manifest = JSON.parse(readFileSync(resolve(ext, "manifest.json"), "utf8"));
delete manifest.content_scripts;
manifest.host_permissions = (manifest.host_permissions || []).filter(
  (h) => !h.includes("mail.google.com")
);
manifest.description =
  "AI assistant that answers questions about the web page you are viewing.";
writeFileSync(resolve(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

// Zip with manifest.json at the archive root.
rmSync(zipPath, { force: true });
execSync(`cd "${out}" && zip -r "${zipPath}" . -x "*.DS_Store"`, { stdio: "inherit" });
console.log("\nBuilt lite package:", zipPath);
