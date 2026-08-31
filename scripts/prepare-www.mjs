import * as esbuild from "esbuild";
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const www = join(root, "www");

rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });

const files = [
  "index.html",
  "app.js",
  "styles.css",
  "manifest.webmanifest",
  "sw.js",
  "favicon.ico",
  "favicon.svg",
  "favicon-32.png",
  "apple-touch-icon.png",
];

for (const file of files) {
  const src = join(root, file);
  if (existsSync(src)) cpSync(src, join(www, file));
}

cpSync(join(root, "icons"), join(www, "icons"), { recursive: true });

const soundsDir = join(root, "sounds");
if (existsSync(soundsDir)) {
  mkdirSync(join(www, "sounds"));
  for (const name of readdirSync(soundsDir)) {
    if (name.endsWith(".wav") || name.endsWith(".md")) {
      cpSync(join(soundsDir, name), join(www, "sounds", name));
    }
  }
}

await esbuild.build({
  entryPoints: [join(root, "native-bridge.js")],
  bundle: true,
  format: "esm",
  platform: "browser",
  outfile: join(www, "native-bridge.js"),
  external: [],
});

const htmlPath = join(www, "index.html");
let html = readFileSync(htmlPath, "utf8");
if (!html.includes("native-bridge.js")) {
  html = html.replace(
    '<script src="./app.js',
    '<script type="module" src="./native-bridge.js"></script>\n    <script src="./app.js',
  );
  writeFileSync(htmlPath, html);
}

console.log("www ready");
