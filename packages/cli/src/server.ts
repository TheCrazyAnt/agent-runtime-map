import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export interface ViewerServerOptions {
  graphFile: string;
  rawGraphFile?: string;
  host?: string;
  port?: number;
}

export interface ViewerServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export async function startViewerServer(options: ViewerServerOptions): Promise<ViewerServer> {
  const viewerDirectory = await resolveViewerDirectory();
  const host = options.host ?? "127.0.0.1";
  const preferredPort = options.port ?? 4173;
  const server = createServer((request, response) => {
    void handleRequest(server, viewerDirectory, options, request.url ?? "/", request.method ?? "GET", response);
  });
  const port = await listenOnAvailablePort(server, host, preferredPort);
  const publicHost = host === "0.0.0.0" || host === "::" ? "localhost" : host;
  const url = `http://${publicHost}:${port}`;
  return {
    url,
    port,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

export function openBrowser(url: string): boolean {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.on("error", () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function handleRequest(
  _server: Server,
  viewerDirectory: string,
  options: ViewerServerOptions,
  rawUrl: string,
  method: string,
  response: import("node:http").ServerResponse,
): Promise<void> {
  setSecurityHeaders(response);
  if (method !== "GET" && method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end("Method Not Allowed");
    return;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(rawUrl, "http://localhost").pathname);
  } catch {
    response.writeHead(400);
    response.end("Bad Request");
    return;
  }

  if (pathname === "/healthz") {
    sendText(response, 200, JSON.stringify({ status: "ok" }), "application/json; charset=utf-8", method);
    return;
  }
  if (pathname === "/graph.json") {
    await sendFile(response, options.graphFile, method, "no-store");
    return;
  }
  if (pathname === "/raw-graph.json") {
    if (!options.rawGraphFile) {
      sendText(response, 404, "Raw graph was not generated.", "text/plain; charset=utf-8", method);
      return;
    }
    await sendFile(response, options.rawGraphFile, method, "no-store");
    return;
  }

  const relativeRequest = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const file = path.resolve(viewerDirectory, relativeRequest);
  if (file !== viewerDirectory && !file.startsWith(`${viewerDirectory}${path.sep}`)) {
    sendText(response, 403, "Forbidden", "text/plain; charset=utf-8", method);
    return;
  }
  await sendFile(response, file, method, relativeRequest === "index.html" ? "no-cache" : "public, max-age=31536000, immutable", viewerDirectory);
}

async function sendFile(
  response: import("node:http").ServerResponse,
  file: string,
  method: string,
  cacheControl: string,
  fallbackDirectory?: string,
): Promise<void> {
  try {
    const details = await stat(file);
    if (!details.isFile()) throw new Error("Not a file");
    response.writeHead(200, {
      "Cache-Control": cacheControl,
      "Content-Length": details.size,
      "Content-Type": MIME_TYPES[path.extname(file)] ?? "application/octet-stream",
    });
    if (method === "HEAD") response.end();
    else createReadStream(file).on("error", () => response.destroy()).pipe(response);
  } catch {
    if (fallbackDirectory) {
      const index = path.join(fallbackDirectory, "index.html");
      if (file !== index) {
        await sendFile(response, index, method, "no-cache");
        return;
      }
    }
    sendText(response, 404, "Not Found", "text/plain; charset=utf-8", method);
  }
}

function sendText(
  response: import("node:http").ServerResponse,
  status: number,
  body: string,
  contentType: string,
  method: string,
): void {
  response.writeHead(status, { "Content-Type": contentType, "Content-Length": Buffer.byteLength(body) });
  response.end(method === "HEAD" ? undefined : body);
}

function setSecurityHeaders(response: import("node:http").ServerResponse): void {
  response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "SAMEORIGIN");
}

async function listenOnAvailablePort(server: Server, host: string, preferredPort: number): Promise<number> {
  if (preferredPort === 0) {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, host, () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Could not resolve the assigned viewer port.");
    return address.port;
  }
  for (let port = preferredPort; port < Math.min(preferredPort + 20, 65_536); port += 1) {
    const result = await new Promise<"listening" | "in-use">((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException) => {
        server.off("listening", onListening);
        if (error.code === "EADDRINUSE") resolve("in-use");
        else reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve("listening");
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, host);
    });
    if (result === "listening") return port;
  }
  throw new Error(`No available port found between ${preferredPort} and ${preferredPort + 19}.`);
}

async function resolveViewerDirectory(): Promise<string> {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(moduleDirectory, "viewer"),
    path.resolve(moduleDirectory, "../../../apps/viewer/dist"),
    path.resolve(process.cwd(), "apps/viewer/dist"),
  ];
  for (const candidate of candidates) {
    try {
      await access(path.join(candidate, "index.html"));
      return candidate;
    } catch {
      // Try the next development or packaged location.
    }
  }
  throw new Error("Viewer assets are missing. Run `npm run build` before starting the viewer.");
}
