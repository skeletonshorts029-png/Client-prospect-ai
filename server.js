const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const {
  dispatchLead,
  getConfigPayload,
  getErrorDetails,
  loadEnvFile,
  parseJsonString,
  searchPlaces,
} = require("./lib/sitecraft-core");

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const ENV_FILE = path.join(ROOT_DIR, ".env");

loadEnvFile(ENV_FILE);

const PORT = Number.parseInt(process.env.PORT || "3000", 10);

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/config") {
      return sendJson(res, 200, getConfigPayload());
    }

    if (req.method === "POST" && url.pathname === "/api/search") {
      const body = await readJsonBody(req);
      const payload = await searchPlaces(body || {});
      return sendJson(res, 200, payload);
    }

    if (req.method === "POST" && url.pathname === "/api/dispatch") {
      const body = await readJsonBody(req);
      const payload = await dispatchLead(body || {});
      return sendJson(res, 200, payload);
    }

    if (req.method === "GET") {
      return serveStatic(url.pathname, res);
    }

    sendJson(res, 405, { error: "Method not allowed." });
  } catch (error) {
    const response = getErrorDetails(error);
    sendJson(res, response.statusCode, response.payload);
  }
});

server.listen(PORT, () => {
  console.log(`SiteCraft Prospect AI running on http://localhost:${PORT}`);
});

async function serveStatic(pathname, res) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendJson(res, 403, { error: "Forbidden." });
  }

  try {
    const stat = await fsp.stat(filePath);
    if (stat.isDirectory()) {
      return serveStatic(path.join(pathname, "index.html"), res);
    }
    const ext = path.extname(filePath);
    const mimeType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": mimeType });
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    sendJson(res, 404, { error: "Not found." });
  }
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body).toString(),
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > 1024 * 1024) {
      const error = new Error("Request body is too large.");
      error.statusCode = 400;
      error.publicMessage = "Request body is too large.";
      throw error;
    }
    chunks.push(chunk);
  }

  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  return parseJsonString(raw);
}
