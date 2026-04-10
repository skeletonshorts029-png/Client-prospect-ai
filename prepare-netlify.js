const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT_DIR = __dirname;
const DIST_DIR = path.join(ROOT_DIR, "dist");
const DIST_ASSETS_DIR = path.join(DIST_DIR, "assets");
const FUNCTIONS_DIR = path.join(ROOT_DIR, "functions-dist");

const FRONTEND_FILES = ["index.html", "app.js", "styles.css"];
const ASSET_FILES = [
  "hero-scene.svg",
  "process-scene.svg",
  "cafe-preview.svg",
  "clinic-preview.svg",
  "salon-preview.svg",
];
const FUNCTION_FILES = ["config.js", "search.js", "dispatch.js"];

async function main() {
  await fs.rm(DIST_DIR, { recursive: true, force: true });
  await fs.rm(FUNCTIONS_DIR, { recursive: true, force: true });

  await fs.mkdir(DIST_ASSETS_DIR, { recursive: true });
  await fs.mkdir(FUNCTIONS_DIR, { recursive: true });

  for (const fileName of FRONTEND_FILES) {
    const source = await resolveSource([fileName, path.join("public", fileName)]);
    await copyFile(source, path.join(DIST_DIR, fileName));
  }

  for (const fileName of ASSET_FILES) {
    const source = await resolveSource([
      fileName,
      path.join("assets", fileName),
      path.join("public", "assets", fileName),
    ]);
    await copyFile(source, path.join(DIST_ASSETS_DIR, fileName));
  }

  const coreSource = await resolveSource([
    "sitecraft-core.js",
    path.join("lib", "sitecraft-core.js"),
  ]);
  await copyFile(coreSource, path.join(FUNCTIONS_DIR, "sitecraft-core.js"));

  for (const fileName of FUNCTION_FILES) {
    const source = await resolveSource([
      fileName,
      path.join("netlify", "functions", fileName),
    ]);
    const contents = await fs.readFile(source, "utf8");
    const patched = contents.replace(
      /require\("\.\.\/\.\.\/lib\/sitecraft-core"\)/g,
      'require("./sitecraft-core")'
    );
    await fs.writeFile(path.join(FUNCTIONS_DIR, fileName), patched, "utf8");
  }

  console.log("Prepared Netlify build output in dist/ and functions-dist/.");
}

async function resolveSource(relativeCandidates) {
  for (const relativePath of relativeCandidates) {
    const absolutePath = path.join(ROOT_DIR, relativePath);
    try {
      const stat = await fs.stat(absolutePath);
      if (stat.isFile()) {
        return absolutePath;
      }
    } catch (error) {
      // Keep checking the next candidate.
    }
  }

  throw new Error(`Could not find any source file for: ${relativeCandidates.join(", ")}`);
}

async function copyFile(source, destination) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
