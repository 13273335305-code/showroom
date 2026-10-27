import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".bmp": "image/bmp", ".jpg": "image/jpeg", ".png": "image/png", ".md": "text/plain; charset=utf-8" };
const server = http.createServer((req, res) => {
  const requestPath = decodeURIComponent((req.url || "/").split("?")[0]);
  const relative = requestPath === "/" ? "/web-demo/index.html" : requestPath;
  let full = path.resolve(root, "." + relative);
  if (full.endsWith(path.sep) || (fs.existsSync(full) && fs.statSync(full).isDirectory())) full = path.join(full, "index.html");
  if (!full.startsWith(root) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); res.end("Not found"); return; }
  res.writeHead(200, { "Content-Type": mime[path.extname(full).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache" });
  fs.createReadStream(full).pipe(res);
});
server.listen(5173, "127.0.0.1", () => console.log("Fabric renderer: http://127.0.0.1:5173/web-demo/"));
