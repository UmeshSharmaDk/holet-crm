/**
 * Standalone production server for Expo static builds.
 *
 * Serves the output of build.js (static-build/) with two special routes:
 * - GET / or /manifest with expo-platform header → platform manifest JSON
 * - GET / without expo-platform → landing page HTML
 * Everything else falls through to static file serving from ./static-build/.
 *
 * Zero external dependencies — uses only Node.js built-ins (http, fs, path).
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const STATIC_ROOT = path.resolve(__dirname, "..", "static-build");
const TEMPLATE_PATH = path.resolve(__dirname, "templates", "landing-page.html");
const basePath = (process.env.BASE_PATH || "/").replace(/\/+$/, "");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".map": "application/json",
};

function getAppName() {
  try {
    const appJsonPath = path.resolve(__dirname, "..", "app.json");
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf-8"));
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}

function serveManifest(platform, res) {
  const manifestPath = path.join(STATIC_ROOT, platform, "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ error: `Manifest not found for platform: ${platform}` }),
    );
    return;
  }

  const manifest = fs.readFileSync(manifestPath, "utf-8");
  res.writeHead(200, {
    "content-type": "application/json",
    "expo-protocol-version": "1",
    "expo-sfv-version": "0",
  });
  res.end(manifest);
}

/**
 * A hostname[:port], and nothing else.
 *
 * The host is taken from request headers, which any client controls. It is
 * interpolated into an HTML attribute and into a JavaScript string literal in
 * the landing page, so a value containing a quote could break out of either and
 * run script on the origin that holds the app's session token. Restricting the
 * value to this character set leaves nothing that is significant in either
 * context.
 */
const HOST_RE = /^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/;
const PROTO_RE = /^https?$/;

const FALLBACK_HOST = process.env.PUBLIC_HOST || "localhost";

function safeHost(req) {
  const candidates = [req.headers["x-forwarded-host"], req.headers["host"]];
  for (const raw of candidates) {
    // A forwarded header may carry a comma-separated chain; the first hop is ours.
    const value = String(raw || "").split(",")[0].trim();
    if (HOST_RE.test(value)) return value;
  }
  return FALLBACK_HOST;
}

function safeProto(req) {
  const value = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  return PROTO_RE.test(value) ? value : "https";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Replaces with a function so `$&`-style patterns in the value are not expanded. */
function fill(template, placeholder, value) {
  return template.replace(new RegExp(placeholder, "g"), () => value);
}

function serveLandingPage(req, res, landingPageTemplate, appName) {
  const protocol = safeProto(req);
  const host = safeHost(req);
  const baseUrl = `${protocol}://${host}`;

  let html = fill(landingPageTemplate, "BASE_URL_PLACEHOLDER", baseUrl);
  html = fill(html, "EXPS_URL_PLACEHOLDER", host);
  html = fill(html, "APP_NAME_PLACEHOLDER", escapeHtml(appName));

  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  res.end(html);
}

function serveStaticFile(urlPath, res) {
  const safePath = path.normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = path.join(STATIC_ROOT, safePath);

  if (!filePath.startsWith(STATIC_ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const content = fs.readFileSync(filePath);
  res.writeHead(200, { "content-type": contentType });
  res.end(content);
}

const landingPageTemplate = fs.readFileSync(TEMPLATE_PATH, "utf-8");
const appName = getAppName();

const server = http.createServer((req, res) => {
  let pathname;
  try {
    // Parsed against a fixed base: an invalid Host header must not throw here.
    pathname = new URL(req.url || "/", "http://placeholder.invalid").pathname;
  } catch {
    res.writeHead(400, { "content-type": "text/plain" });
    res.end("Bad Request");
    return;
  }

  if (basePath && pathname.startsWith(basePath)) {
    pathname = pathname.slice(basePath.length) || "/";
  }

  if (pathname === "/" || pathname === "/manifest") {
    const platform = req.headers["expo-platform"];
    if (platform === "ios" || platform === "android") {
      return serveManifest(platform, res);
    }

    if (pathname === "/") {
      return serveLandingPage(req, res, landingPageTemplate, appName);
    }
  }

  serveStaticFile(pathname, res);
});

const port = parseInt(process.env.PORT || "3000", 10);
server.listen(port, "0.0.0.0", () => {
  console.log(`Serving static Expo build on port ${port}`);
});
