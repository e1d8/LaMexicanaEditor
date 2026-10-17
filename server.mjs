import http from "node:http";
import { readFile, readdir, stat, mkdir, open, rename, copyFile, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { validateMenu, ICON_PATTERN } from "./public/menu-model.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MAX_BYTES = 1024 * 1024;
const hash = (content) => createHash("sha256").update(content).digest("hex");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2" };

export function createEditorServer({ menuPath = path.resolve(ROOT, "../LaMexicana/menu.json"), backupDir = path.join(ROOT, ".backups") } = {}) {
  menuPath = path.resolve(menuPath);
  let saveQueue = Promise.resolve();
  const json = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  };
  async function readMenu() {
    const bytes = await readFile(menuPath);
    if (bytes.length > MAX_BYTES) throw Object.assign(new Error("La carta supera el tamaño máximo de 1 MB."), { status: 413 });
    let menu;
    try { menu = JSON.parse(bytes.toString("utf8")); }
    catch { throw Object.assign(new Error("La carta actual tiene un formato incorrecto. No se ha modificado."), { status: 422 }); }
    const errors = validateMenu(menu);
    if (errors.length) throw Object.assign(new Error("La carta actual contiene datos que necesitan revisión."), { status: 422, errors });
    return { bytes, menu, version: hash(bytes) };
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const expectedHost = `127.0.0.1:${server.address().port}`;
    if (![expectedHost, `localhost:${server.address().port}`].includes(req.headers.host)) return json(res, 403, { message: "Dirección local no permitida." });
    const origin = `http://${req.headers.host}`;
    if (req.headers.origin && req.headers.origin !== origin) return json(res, 403, { message: "Origen de la petición no permitido." });
    if (req.headers["sec-fetch-site"] === "cross-site") return json(res, 403, { message: "Petición externa no permitida." });
    const url = new URL(req.url, origin);
    try {
      if (req.method === "GET" && url.pathname === "/api/menu") {
        const current = await readMenu();
        const names = await readdir(path.join(path.dirname(menuPath), "assets/allergens"));
        const icons = names.map((name) => `assets/allergens/${name}`).filter((name) => ICON_PATTERN.test(name));
        return json(res, 200, { menu: current.menu, version: current.version, icons, mode: "local" });
      }
      if (req.method === "PUT" && url.pathname === "/api/menu") {
        if (!req.headers["content-type"]?.startsWith("application/json")) return json(res, 415, { message: "El guardado requiere datos de la carta." });
        if (!req.headers.origin || req.headers.origin !== origin) return json(res, 403, { message: "Solo se puede guardar desde el editor local." });
        const chunks = []; let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > MAX_BYTES) return json(res, 413, { message: "La carta supera el tamaño máximo de 1 MB." });
          chunks.push(chunk);
        }
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
        catch { return json(res, 400, { message: "La información enviada no se puede leer." }); }
        if (!body || typeof body.version !== "string") return json(res, 400, { message: "Falta la versión de la carta. Vuelve a abrirla." });
        const errors = validateMenu(body.menu);
        if (errors.length) return json(res, 422, { message: "Revisa los datos antes de guardar.", errors });
        const save = async () => {
          const current = await readMenu();
          if (body.version !== current.version) return json(res, 409, { message: "Otra persona ha cambiado la carta. Vuelve a abrirla antes de guardar." });
          for (const definition of Object.values(body.menu.allergens)) {
            const file = path.join(path.dirname(menuPath), definition.icon);
            if (!(await stat(file).catch(() => null))?.isFile()) return json(res, 422, { message: `No existe el icono de «${definition.label}».` });
          }
          const bytes = Buffer.from(JSON.stringify(body.menu, null, 2) + "\n");
          if (hash(bytes) === current.version) return json(res, 200, { version: current.version, message: "La carta ya estaba actualizada." });
          await mkdir(backupDir, { recursive: true });
          const backup = path.join(backupDir, `${new Date().toISOString().replace(/:/g, "-")}-${randomUUID()}.json`);
          await copyFile(menuPath, backup);
          const temporary = `${menuPath}.${randomUUID()}.tmp`;
          try {
            const mode = (await stat(menuPath)).mode;
            const handle = await open(temporary, "wx", mode);
            try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
            // Recheck after preparing the file so external edits are not overwritten.
            if (hash(await readFile(menuPath)) !== current.version) return json(res, 409, { message: "La carta ha cambiado. Vuelve a abrirla antes de guardar." });
            await rename(temporary, menuPath);
          } finally { await unlink(temporary).catch(() => {}); }
          return json(res, 200, { version: hash(bytes), message: "Cambios guardados. La carta de este ordenador ya está actualizada." });
        };
        const task = saveQueue.then(save);
        saveQueue = task.catch(() => {});
        await task;
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { message: "Acción no permitida." });
      let file;
      if (/^\/icons\/[a-zA-Z0-9_-]+\.(svg|png|webp)$/.test(url.pathname)) file = path.join(path.dirname(menuPath), "assets/allergens", path.basename(url.pathname));
      else {
        const relative = decodeURIComponent(url.pathname) === "/" ? "index.html" : decodeURIComponent(url.pathname).slice(1);
        file = path.resolve(ROOT, "public", relative);
        if (!file.startsWith(path.join(ROOT, "public") + path.sep)) return json(res, 404, { message: "Página no encontrada." });
      }
      const data = await readFile(file);
      res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : data);
    } catch (error) {
      const status = error.status || (error.code === "ENOENT" ? 404 : 500);
      json(res, status, { message: error.status ? error.message : error.code === "ENOENT" ? "No se ha encontrado la carta o el recurso solicitado. Comprueba la carpeta de La Mexicana." : "No se ha podido completar la operación. La carta anterior se conserva.", ...(error.errors ? { errors: error.errors } : {}) });
    }
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const menuFlag = process.argv.indexOf("--menu");
  const menuPath = menuFlag >= 0 ? process.argv[menuFlag + 1] : undefined;
  const port = Number(process.env.PORT || 8787);
  const server = createEditorServer({ ...(menuPath ? { menuPath } : {}) });
  server.listen(port, "127.0.0.1", () => console.log(`Editor disponible en http://127.0.0.1:${port}`));
}
