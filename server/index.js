import http from "node:http";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { campus, publicConfig } from "./data.js";
import { findRoute } from "./routing.js";

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const publicRoot = resolve(fileURLToPath(new URL("../app/", import.meta.url)));
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 100_000) throw new Error("Request too large");
  }
  return body ? JSON.parse(body) : {};
}

export async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/health") return json(res, 200, { status: "ok" });
    if (url.pathname === "/api/config") return json(res, 200, publicConfig());
    if (url.pathname === "/api/campus") return json(res, 200, campus);
    if (url.pathname === "/api/pois") return json(res, 200, campus.pois);
    if (url.pathname === "/api/routes" && req.method === "POST") {
      const body = await readJson(req);
      const destination = campus.pois.find((poi) => poi.id === body.destinationPoiId);
      if (!destination) return json(res, 400, { error: "Unknown destination" });
      return json(res, 200, findRoute(campus, body.startNodeId, destination.nodeId, body.profile));
    }
    if (url.pathname.startsWith("/api/")) return json(res, 404, { error: "Not found" });

    const requested = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = resolve(publicRoot, `.${requested}`);
    if (filePath !== publicRoot && !filePath.startsWith(publicRoot + sep)) return json(res, 403, { error: "Forbidden" });
    const file = await readFile(filePath);
    res.writeHead(200, { "content-type": mime[extname(filePath)] || "application/octet-stream" });
    res.end(file);
  } catch (error) {
    if (error.code === "ENOENT") return json(res, 404, { error: "Not found" });
    json(res, 400, { error: error.message });
  }
}

// Vercel invokes handler per request; local npm start still listens normally.
if (!process.env.VERCEL) {
  http.createServer(handler).listen(port, host, () => {
    console.log(`Severance navigation running at http://${host}:${port}`);
  });
}

