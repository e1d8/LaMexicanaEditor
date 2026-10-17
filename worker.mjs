import { validateMenu, ICON_PATTERN } from "./public/menu-model.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_BYTES = 1024 * 1024;
const GITHUB_VERSION = "2026-03-10";
function base64(bytes) { return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join("")); }
function unbase64(value) { return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (character) => character.charCodeAt(0)); }
const url64 = (bytes) => base64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const problem = (status, message, errors) => Object.assign(new Error(message), { status, errors });

function configuration(env) {
  let editor;
  try { editor = new URL(env.EDITOR_URL); } catch { throw problem(503, "Falta configurar la dirección del editor."); }
  if (editor.protocol !== "https:" || editor.search || editor.hash
    || !/^[a-zA-Z0-9-]+$/.test(env.GITHUB_OWNER || "")
    || !/^[a-zA-Z0-9_.-]+$/.test(env.GITHUB_REPO || "") || !env.GITHUB_BRANCH) {
    throw problem(503, "La configuración del servicio de guardado está incompleta.");
  }
  if (!/^\d+$/.test(env.GITHUB_APP_ID || "") || !/^\d+$/.test(env.GITHUB_INSTALLATION_ID || "") || !env.GITHUB_PRIVATE_KEY) {
    throw problem(503, "Falta configurar la GitHub App del servicio de guardado. Consulta la guía del proyecto.");
  }
  return { editor, repo: `/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}` };
}

export function createWorker({ fetchImpl = (...args) => fetch(...args), now = () => Date.now() } = {}) {
  // Each isolate reuses credentials only for the matching installation and key.
  // Concurrent requests share one token request; there is no persistent token store.
  let cacheIdentity;
  let keyPromise;
  let cachedToken;
  let tokenPromise;
  function selectCredentials(env) {
    const identity = JSON.stringify([env.GITHUB_APP_ID, env.GITHUB_INSTALLATION_ID, env.GITHUB_OWNER, env.GITHUB_REPO, env.GITHUB_PRIVATE_KEY]);
    if (identity !== cacheIdentity) {
      cacheIdentity = identity; keyPromise = null; cachedToken = null; tokenPromise = null;
    }
    return identity;
  }
  async function appJwt(env) {
    if (!keyPromise) {
      keyPromise = (async () => {
        const pem = env.GITHUB_PRIVATE_KEY.trim();
        if (!pem.startsWith("-----BEGIN PRIVATE KEY-----") || !pem.endsWith("-----END PRIVATE KEY-----")) {
          throw problem(503, "La clave de la GitHub App debe estar en formato PKCS#8. Sigue el paso de preparación de la clave en la guía.");
        }
        try {
          const bytes = unbase64(pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, ""));
          return await crypto.subtle.importKey("pkcs8", bytes, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
        } catch { throw problem(503, "No se puede leer la clave privada de la GitHub App. Revisa el secreto de Cloudflare."); }
      })();
      keyPromise.catch(() => { keyPromise = null; });
    }
    const seconds = Math.floor(now() / 1000);
    const header = url64(encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
    const payload = url64(encoder.encode(JSON.stringify({ iat: seconds - 60, exp: seconds + 9 * 60, iss: env.GITHUB_APP_ID })));
    const input = `${header}.${payload}`;
    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", await keyPromise, encoder.encode(input));
    return `${input}.${url64(new Uint8Array(signature))}`;
  }
  async function installationToken(env) {
    const identity = selectCredentials(env);
    if (cachedToken && cachedToken.expiresAt > now() + 60000) return cachedToken.token;
    if (!tokenPromise) {
      const pending = (async () => {
        const jwt = await appJwt(env);
        let response;
        try {
          response = await fetchImpl(`https://api.github.com/app/installations/${env.GITHUB_INSTALLATION_ID}/access_tokens`, {
            method: "POST", cache: "no-store",
            headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": GITHUB_VERSION, "User-Agent": "LaMexicanaEditor", Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
            body: JSON.stringify({ repositories: [env.GITHUB_REPO], permissions: { contents: "write" } })
          });
        } catch { throw problem(502, "No se puede contactar con GitHub. Vuelve a intentarlo; tus cambios no se han perdido."); }
        if (!response.ok) throw problem(503, "La GitHub App no puede acceder a la carta. Revisa su instalación, permisos y configuración en la guía.");
        const data = await response.json().catch(() => ({}));
        const expiresAt = Date.parse(data.expires_at);
        if (typeof data.token !== "string" || !data.token || !Number.isFinite(expiresAt) || expiresAt <= now() + 60000) {
          throw problem(503, "GitHub no ha proporcionado un permiso válido para guardar. Vuelve a intentarlo.");
        }
        if (cacheIdentity === identity) cachedToken = { token: data.token, expiresAt };
        return data.token;
      })();
      tokenPromise = pending;
      pending.finally(() => { if (tokenPromise === pending) tokenPromise = null; }).catch(() => {});
    }
    return tokenPromise;
  }
  async function github(endpoint, env, options = {}) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await installationToken(env);
      let response;
      try {
        response = await fetchImpl(`https://api.github.com${endpoint}`, {
          ...options,
          headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": GITHUB_VERSION, "User-Agent": "LaMexicanaEditor", Authorization: `Bearer ${token}`, ...(options.body ? { "Content-Type": "application/json" } : {}) },
          cache: "no-store"
        });
      } catch { throw problem(502, "No se puede contactar con GitHub. Vuelve a intentarlo; tus cambios no se han perdido."); }
      if (response.status === 401 && attempt === 0) {
        if (cachedToken?.token === token) cachedToken = null;
        continue;
      }
      if (!response.ok) {
        if (response.status === 401) throw problem(503, "El servicio no ha podido renovar su permiso con GitHub. Revisa la configuración de la aplicación.");
        if (response.status === 403) throw problem(503, "GitHub no permite guardar. Revisa los permisos de la aplicación y los límites de peticiones.");
        if (response.status === 409) throw problem(409, "La carta ha cambiado desde que la abriste. Recárgala antes de guardar.");
        if (response.status === 404) throw problem(404, "No se encuentra la carta. Comprueba el repositorio, la rama y los permisos de la aplicación.");
        if (response.status === 422) throw problem(422, "GitHub ha rechazado el guardado. Comprueba los permisos y la protección de la rama.");
        throw problem(502, "GitHub no ha podido completar la operación. Vuelve a intentarlo.");
      }
      return response.json();
    }
  }
  async function readMenu(env, config) {
    const file = await github(`${config.repo}/contents/menu.json?ref=${encodeURIComponent(env.GITHUB_BRANCH)}`, env);
    if (file.type !== "file" || file.encoding !== "base64" || file.size > MAX_BYTES) throw problem(422, "La carta actual no es un archivo válido o supera 1 MB.");
    let menu;
    try { menu = JSON.parse(decoder.decode(unbase64(file.content.replace(/\s/g, "")))); }
    catch { throw problem(422, "La carta actual no se puede leer. No se ha modificado el archivo."); }
    const errors = validateMenu(menu);
    if (errors.length) throw problem(422, "La carta actual contiene datos que necesitan revisión.", errors);
    return { menu, version: file.sha };
  }
  async function icons(env, config) {
    const entries = await github(`${config.repo}/contents/assets/allergens?ref=${encodeURIComponent(env.GITHUB_BRANCH)}`, env);
    if (!Array.isArray(entries)) throw problem(422, "No se encuentra el catálogo de iconos de la carta.");
    return entries.filter((file) => file.type === "file" && ICON_PATTERN.test(file.path)).map((file) => file.path);
  }
  async function route(request, env) {
    const url = new URL(request.url);
    const editorOrigin = (() => { try { return new URL(env.EDITOR_URL).origin; } catch { return ""; } })();
    const origin = request.headers.get("Origin");
    if (origin && origin !== editorOrigin) throw problem(403, "Origen no autorizado.");
    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      if (!origin || origin !== editorOrigin) throw problem(403, "Origen no autorizado.");
      return new Response(null, { status: 204 });
    }
    // Public assets are read only from the configured, public menu repository.
    if (request.method === "GET" && /^\/icons\/[a-zA-Z0-9_-]+\.(svg|png|webp)$/.test(url.pathname)) {
      if (!env.GITHUB_OWNER || !env.GITHUB_REPO || !env.GITHUB_BRANCH) throw problem(503, "Falta configurar el repositorio.");
      const remote = `https://raw.githubusercontent.com/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/${env.GITHUB_BRANCH.split("/").map(encodeURIComponent).join("/")}/assets/allergens/${url.pathname.split("/").pop()}`;
      const response = await fetchImpl(remote, { cf: { cacheTtl: 3600 } });
      if (!response.ok) throw problem(404, "Icono no encontrado.");
      const extension = url.pathname.split(".").pop();
      return new Response(response.body, { headers: { "Content-Type": { svg: "image/svg+xml", png: "image/png", webp: "image/webp" }[extension], "Cache-Control": "public, max-age=3600", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" } });
    }
    if (url.pathname === "/api/menu" && ["GET", "PUT"].includes(request.method)) {
      const config = configuration(env);
      if (request.method === "GET") {
        const [current, availableIcons] = await Promise.all([readMenu(env, config), icons(env, config)]);
        return Response.json({ ...current, icons: availableIcons, mode: "github" });
      }
      if (origin !== config.editor.origin) throw problem(403, "Guarda los cambios desde la web del editor.");
      if (!request.headers.get("Content-Type")?.startsWith("application/json")) throw problem(415, "El guardado requiere los datos de la carta.");
      if (Number(request.headers.get("Content-Length")) > MAX_BYTES) throw problem(413, "La carta supera el tamaño máximo de 1 MB.");
      // Limit streamed bodies too; Content-Length is not guaranteed to be present.
      const reader = request.body?.getReader();
      if (!reader) throw problem(400, "Falta la información de la carta.");
      const chunks = []; let size = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_BYTES) { await reader.cancel(); throw problem(413, "La carta supera el tamaño máximo de 1 MB."); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      let body;
      try { body = JSON.parse(decoder.decode(bytes)); } catch { throw problem(400, "La información enviada no se puede leer."); }
      if (!body || typeof body.version !== "string" || !/^[a-f0-9]{40,64}$/.test(body.version)) throw problem(400, "Falta una versión válida de la carta.");
      const errors = validateMenu(body.menu);
      if (errors.length) throw problem(422, "Revisa los datos antes de guardar.", errors);
      const [current, availableIcons] = await Promise.all([readMenu(env, config), icons(env, config)]);
      if (current.version !== body.version) throw problem(409, "La carta ha cambiado desde que la abriste. Recárgala antes de guardar.");
      for (const definition of Object.values(body.menu.allergens)) {
        if (!availableIcons.includes(definition.icon)) throw problem(422, `No existe el icono de «${definition.label}».`);
      }
      if (JSON.stringify(current.menu) === JSON.stringify(body.menu)) return Response.json({ version: current.version, message: "La carta ya estaba actualizada." });
      const content = base64(encoder.encode(JSON.stringify(body.menu, null, 2) + "\n"));
      const result = await github(`${config.repo}/contents/menu.json`, env, { method: "PUT", body: JSON.stringify({ message: "Actualizar carta desde el editor público", content, sha: current.version, branch: env.GITHUB_BRANCH }) });
      return Response.json({ version: result.content.sha, message: "Cambios guardados en GitHub. La carta pública puede tardar unos minutos en actualizarse." });
    }
    throw problem(404, "Ruta no encontrada.");
  }
  return {
    async fetch(request, env) {
      let response;
      try { response = await route(request, env); }
      catch (error) { response = Response.json({ message: error.status ? error.message : "No se ha podido completar la operación. Vuelve a intentarlo.", ...(error.errors ? { errors: error.errors } : {}) }, { status: error.status || 500 }); }
      const result = new Response(response.body, response);
      result.headers.set("Cache-Control", response.headers.get("Cache-Control") || "no-store");
      result.headers.set("X-Content-Type-Options", "nosniff");
      result.headers.set("Referrer-Policy", "no-referrer");
      result.headers.set("X-Frame-Options", "DENY");
      let allowedOrigin = "";
      try { allowedOrigin = new URL(env.EDITOR_URL).origin; } catch { /* Unconfigured environments fail closed. */ }
      if (allowedOrigin && request.headers.get("Origin") === allowedOrigin) {
        result.headers.set("Access-Control-Allow-Origin", allowedOrigin);
        result.headers.set("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
        result.headers.set("Access-Control-Allow-Headers", "Content-Type");
        result.headers.set("Vary", "Origin");
      }
      return result;
    }
  };
}
export default createWorker();
