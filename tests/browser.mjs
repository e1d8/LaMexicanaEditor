// Runs an actual Chrome browser against temporary data. Never writes to the real menu.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createEditorServer } from "../server.mjs";

const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const fixture = process.env.MENU_FIXTURE ? await readFile(process.env.MENU_FIXTURE) : await readFile(new URL("./fixtures/menu.json", import.meta.url));
const initial = JSON.parse(fixture);
const expectedCount = initial.sections.reduce((count, section) => count + section.items.length, 0);
const temp = await mkdtemp(path.join(tmpdir(), "mexicana-browser-"));
const menuPath = path.join(temp, "menu.json");
await writeFile(menuPath, fixture);
await mkdir(path.join(temp, "assets"));
await cp(new URL("../public/assets/allergens", import.meta.url), path.join(temp, "assets/allergens"), { recursive: true });
const server = createEditorServer({ menuPath, backupDir: path.join(temp, "backups") });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const chrome = spawn(chromePath, ["--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--remote-debugging-port=0", `--user-data-dir=${path.join(temp, "chrome")}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
let ws;
try {
  const endpoint = await new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error("Chrome did not start")), 15000);
    chrome.stderr.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
    chrome.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Chrome exited: ${code}`)); });
  });
  ws = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
  let counter = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Page.javascriptDialogOpening") {
      const id = ++counter;
      ws.send(JSON.stringify({ id, method: "Page.handleJavaScriptDialog", params: { accept: true }, sessionId: message.sessionId }));
    }
    if (message.id) {
      const target = pending.get(message.id);
      if (!target) return;
      pending.delete(message.id);
      if (message.error) target.reject(new Error(message.error.message)); else target.resolve(message.result);
    }
  });
  const command = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++counter; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetId } = await command("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await command("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params) => command(method, params, sessionId);
  await send("Page.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.editorRequests = [];
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (url, options = {}) => {
      window.editorRequests.push({ url: String(url), method: options.method || "GET", authorization: new Headers(options.headers).get("Authorization") });
      if (window.simulateSaveFailure && options.method === "PUT") return new Response(JSON.stringify({ message: "Servicio de guardado temporalmente no disponible." }), { status: 503, headers: { "Content-Type": "application/json" } });
      return originalFetch(url, options);
    };
    try { sessionStorage.setItem('mexicana-session:', 'legacy-session-to-remove'); } catch {}
  ` });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async (expression) => {
    const until = Date.now() + 10000;
    while (Date.now() < until) {
      if (await evaluate(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error(`Timed out: ${expression}`);
  };
  const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const fill = (selector, value) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const submit = () => evaluate("document.querySelector('#dialog form').requestSubmit()");
  const dialogButton = (text) => evaluate(`Array.from(document.querySelectorAll('#dialog button')).find(b => b.textContent === ${JSON.stringify(text)}).click()`);
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: origin });
  await waitFor("!document.querySelector('#editor').hidden");
  assert.equal(await evaluate("Number(document.querySelector('#total-products').textContent)"), expectedCount);
  assert.equal(await evaluate("document.querySelector('#save').disabled"), true);
  assert.equal(await evaluate("document.querySelector('#login-panel, #login-link, #logout')"), null);
  assert.ok(await evaluate("editorRequests.length === 1 && editorRequests[0].url.endsWith('/api/menu') && !editorRequests[0].authorization"));
  assert.equal(await evaluate("sessionStorage.getItem('mexicana-session:')"), null);
  const desktop = await send("Page.captureScreenshot", { format: "png" });
  await writeFile("/tmp/lamexicana-editor-desktop.png", Buffer.from(desktop.data, "base64"));
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.ok(await evaluate("document.documentElement.scrollWidth <= 390"), "Mobile layout must not overflow");
  const mobile = await send("Page.captureScreenshot", { format: "png" });
  await writeFile("/tmp/lamexicana-editor-mobile.png", Buffer.from(mobile.data, "base64"));
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
  console.log("PASS: actual menu, pristine state, desktop and mobile layout");

  await click("#add-product");
  await fill("#field-name", "Producto de prueba");
  await fill("#field-price", "-2");
  await submit();
  assert.ok(await evaluate("document.querySelector('#dialog .form-error').textContent.includes('precio')"));
  assert.equal(await evaluate("Number(document.querySelector('#total-products').textContent)"), expectedCount);
  await fill("#field-price", "3,80");
  await fill("#field-description", "Texto <b>literal</b> y ñ");
  await click("#dialog fieldset input");
  await submit();
  assert.equal(await evaluate("Number(document.querySelector('#total-products').textContent)"), expectedCount + 1);
  assert.ok(await evaluate("!document.querySelector('#save').disabled"));
  await fill("#search", "Producto de prueba");
  assert.equal(await evaluate("document.querySelectorAll('.product-card').length"), 1);
  assert.equal(await evaluate("document.querySelector('.product-price').textContent"), "3.80€");
  assert.ok(await evaluate("!document.querySelector('.product-info b')"));
  await click(".product-actions .edit");
  await fill("#field-name", "Producto editado");
  await submit();
  await fill("#search", "Producto editado");
  assert.equal(await evaluate("document.querySelector('.product-info h3').textContent"), "Producto editado");
  console.log("PASS: guided product creation, invalid price blocked, edit, search, safe text rendering");

  await click("#allergens");
  await evaluate("document.querySelector('#dialog .manage-row button').click()");
  await fill("#field-allergen-name", "Alérgeno revisado");
  await submit();
  await dialogButton("Listo");
  assert.ok(await evaluate("document.querySelector('.allergen-chips').textContent.includes('Alérgeno revisado')"));
  await click("#allergens");
  await dialogButton("＋ Añadir alérgeno");
  await fill("#field-allergen-name", "Prueba de catálogo");
  await evaluate("const select = document.querySelector('#allergen-icon'); select.value = select.options[1].value; select.dispatchEvent(new Event('change', { bubbles: true }));");
  await submit();
  assert.equal(await evaluate("document.querySelectorAll('#dialog .manage-row').length"), Object.keys(initial.allergens).length + 1);
  await evaluate("Array.from(document.querySelectorAll('#dialog .manage-row')).at(-1).querySelector('.danger-link').click()");
  await dialogButton("Eliminar");
  assert.equal(await evaluate("document.querySelectorAll('#dialog .manage-row').length"), Object.keys(initial.allergens).length);
  await evaluate("document.querySelector('#dialog .manage-row .danger-link').click()");
  assert.ok(await evaluate("!document.querySelector('#notice').hidden && document.querySelector('#notice').textContent.includes('asignado')"));
  assert.ok(await evaluate("!document.querySelector('#dialog').open"));
  await click(".product-actions .edit");
  await evaluate("document.querySelector('#field-price').closest('.form-field').nextElementSibling.querySelector('input').click()");
  await fill("#field-destination", initial.sections[1].id);
  await submit();
  await fill("#search", "Producto editado");
  assert.equal(await evaluate("document.querySelector('.product-price').textContent"), "A consultar");
  console.log("PASS: allergen catalog editing, adding/removing unused allergens, referenced allergen protection, move product and price on request");


  await click("#preview");
  assert.ok(await evaluate("document.querySelector('.preview-menu').textContent.includes('Producto editado')"));
  await dialogButton("Seguir editando");
  await click(".product-actions .delete");
  assert.ok(await evaluate("document.querySelector('#dialog-title').textContent.includes('Eliminar')"));
  await dialogButton("Eliminar");
  assert.equal(await evaluate("Number(document.querySelector('#total-products').textContent)"), expectedCount);
  console.log("PASS: preview and confirmed removal");

  await click("#add-section");
  await fill("#field-section-name", "Especiales de prueba");
  await submit();
  assert.ok(await evaluate("document.querySelector('#save').disabled"), "Empty sections must not be saved");
  await fill("#field-name", "Taco de prueba");
  await fill("#field-price", "9,30");
  await submit();
  assert.ok(await evaluate("!document.querySelector('#save').disabled"));
  await click("#organize");
  await evaluate("Array.from(document.querySelectorAll('#dialog .manage-row')).at(-1).querySelector('button').click()");
  await dialogButton("Listo");
  assert.equal(await evaluate("Number(document.querySelector('#total-sections').textContent)"), initial.sections.length + 1);
  console.log("PASS: sections, required first product and ordering");

  await send("Page.reload");
  await waitFor("!document.querySelector('#editor').hidden && document.querySelector('#notice').textContent.includes('última visita')");
  await evaluate("Array.from(document.querySelectorAll('#notice button')).find(b => b.textContent === 'Recuperar cambios').click()");
  assert.equal(await evaluate("Number(document.querySelector('#total-products').textContent)"), expectedCount + 1);
  console.log("PASS: recovering a draft after reload");
  await evaluate("window.simulateSaveFailure = true");
  await click("#save");
  await dialogButton("Sí, guardar cambios");
  await waitFor("!document.querySelector('#dialog .form-error').hidden");
  assert.ok(await evaluate("document.querySelector('#dialog .form-error').textContent.includes('no disponible')"));
  assert.ok(await evaluate("!document.querySelector('#dialog .form-error a')"));
  assert.ok(await evaluate("Object.keys(localStorage).some(key => key.startsWith('mexicana-draft:'))"));
  assert.deepEqual(JSON.parse(await readFile(menuPath)), initial);
  await evaluate("window.simulateSaveFailure = false");
  await dialogButton("Sí, guardar cambios");
  await waitFor("!document.querySelector('#dialog').open && document.querySelector('#notice').textContent.includes('guardados')");
  const saved = JSON.parse(await readFile(menuPath));
  assert.ok(saved.sections.some((section) => section.items.some((item) => item.name === "Taco de prueba" && item.price === "9.30€")));
  assert.equal(await evaluate("document.querySelector('#save').disabled"), true);
  console.log("PASS: real local save, updated file, clean state");

  await click("#add-product");
  await fill("#field-name", "Conflicto conservado"); await fill("#field-price", "2"); await submit();
  saved.sections[0].name = "Cambio externo"; await writeFile(menuPath, JSON.stringify(saved, null, 2));
  await click("#save"); await dialogButton("Sí, guardar cambios");
  await waitFor("!document.querySelector('#dialog .form-error').hidden && document.querySelector('#dialog .form-error').textContent.includes('ha cambiado')");
  assert.ok(!(await readFile(menuPath, "utf8")).includes("Conflicto conservado"));
  assert.ok(await evaluate("document.querySelector('#total-products').textContent === '" + (expectedCount + 2) + "'"));
  console.log("PASS: conflicting external changes are never overwritten; edits retained");
  assert.ok(await evaluate("editorRequests.every(request => !request.authorization && !request.url.includes('/api/session') && !request.url.includes('/auth/'))"));
  console.log("PASS: anonymous browser requests, no login UI, service errors preserve drafts and retry succeeds");
  console.log("All browser checks passed. Screenshots: /tmp/lamexicana-editor-desktop.png and /tmp/lamexicana-editor-mobile.png");
} finally {
  ws?.close();
  // This is the isolated test browser, never an existing user browser.
  chrome.kill("SIGKILL");
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => setTimeout(resolve, 800));
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
