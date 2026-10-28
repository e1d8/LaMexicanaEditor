import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createWorker } from "../worker.mjs";

const fixture = JSON.parse(await readFile(new URL("./fixtures/menu.json", import.meta.url)));
const keyPair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const privateKey = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(await crypto.subtle.exportKey("pkcs8", keyPair.privateKey)).toString("base64")}\n-----END PRIVATE KEY-----`;
const env = { EDITOR_URL: "https://editor.example/LaMexicanaEditor/", GITHUB_OWNER: "owner", GITHUB_REPO: "menu", GITHUB_BRANCH: "main", GITHUB_APP_ID: "123", GITHUB_INSTALLATION_ID: "456", GITHUB_PRIVATE_KEY: privateKey };
const version = "a".repeat(40), nextVersion = "b".repeat(40);
const iconEntries = Object.values(fixture.allergens).map((item) => ({ type: "file", path: item.icon }));
const request = (pathname = "/api/menu", options = {}) => new Request(`https://api.example${pathname}`, { ...options, headers: { Origin: "https://editor.example", ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers } });
const put = (menu, fileVersion = version, headers = {}) => request("/api/menu", { method: "PUT", body: JSON.stringify({ version: fileVersion, menu }), headers });
function apiMock(overrides = {}) {
  const calls = [];
  let issues = 0;
  let successfulWrites = 0;
  let menu = structuredClone(overrides.menu || fixture);
  let fileVersion = overrides.version || version;
  const clock = overrides.now || (() => Date.now());
  return {
    calls,
    now: clock,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (overrides.networkError) throw new TypeError("offline");
      if (url.includes("/app/installations/") && url.endsWith("/access_tokens")) {
        issues++;
        if (overrides.tokenStatus) return Response.json({}, { status: overrides.tokenStatus });
        return Response.json(overrides.tokenResponse || { token: `installation-token-${issues}`, expires_at: new Date(clock() + 3600000).toISOString() });
      }
      if (overrides.rejectCredentials === "always" || (overrides.rejectCredentials === "first" && options.headers.Authorization === "Bearer installation-token-1") || (overrides.rejectWriteFirst && options.method === "PUT" && options.headers.Authorization === "Bearer installation-token-1")) return Response.json({}, { status: 401 });
      if (overrides.readStatus && options.method !== "PUT") return Response.json({}, { status: overrides.readStatus });
      if (url.includes("/contents/assets/allergens")) return Response.json(iconEntries);
      if (url.includes("/contents/menu.json") && options.method !== "PUT") return Response.json({ type: "file", encoding: "base64", content: Buffer.from(JSON.stringify(menu)).toString("base64"), size: 500, sha: fileVersion });
      if (url.endsWith("/contents/menu.json") && options.method === "PUT") {
        if (overrides.writeStatus) return Response.json({}, { status: overrides.writeStatus });
        const body = JSON.parse(options.body);
        if (body.sha !== fileVersion) return Response.json({}, { status: 409 });
        menu = JSON.parse(Buffer.from(body.content, "base64").toString("utf8"));
        fileVersion = (++successfulWrites + 10).toString(16).repeat(40);
        return Response.json({ content: { sha: fileVersion } });
      }
      throw new Error(`Unexpected network request: ${url}`);
    }
  };
}
const tokenCalls = (mock) => mock.calls.filter((call) => call.url.includes("/access_tokens"));
const writes = (mock) => mock.calls.filter((call) => call.options.method === "PUT");

test("anonymous visitors can read the menu without cookies, headers or user lookups", async () => {
  const mock = apiMock(); const worker = createWorker(mock);
  const response = await worker.fetch(request(), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.menu, fixture);
  assert.equal(body.version, version);
  assert.equal(body.mode, "github");
  assert.ok(body.icons.includes("assets/allergens/lacteo.svg"));
  assert.ok(!JSON.stringify(body).includes("installation-token"));
  assert.ok(!JSON.stringify(body).includes("PRIVATE KEY"));
  assert.equal(response.headers.get("Set-Cookie"), null);
  assert.equal(mock.calls.filter((call) => call.url.endsWith("/user")).length, 0);
  assert.equal((await worker.fetch(new Request("https://api.example/api/menu"), env)).status, 200);
});
test("installation credentials use a valid RSA JWT and are scoped to the configured repository", async () => {
  const time = Date.now(); const mock = apiMock({ now: () => time });
  const response = await createWorker(mock).fetch(request(), env);
  assert.equal(response.status, 200);
  const [issuance] = tokenCalls(mock);
  assert.equal(issuance.url, "https://api.github.com/app/installations/456/access_tokens");
  assert.deepEqual(JSON.parse(issuance.options.body), { repositories: ["menu"], permissions: { contents: "write" } });
  const jwt = issuance.options.headers.Authorization.slice(7);
  const [header, payload, signature] = jwt.split(".");
  assert.equal(JSON.parse(Buffer.from(header, "base64url")).alg, "RS256");
  const claims = JSON.parse(Buffer.from(payload, "base64url"));
  assert.equal(claims.iss, "123");
  assert.equal(claims.iat, Math.floor(time / 1000) - 60);
  assert.ok(claims.exp <= Math.floor(time / 1000) + 600);
  assert.ok(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", keyPair.publicKey, Buffer.from(signature, "base64url"), new TextEncoder().encode(`${header}.${payload}`)));
});
test("concurrent anonymous reads share a token and reuse it until its renewal window", async () => {
  let time = Date.now(); const mock = apiMock({ now: () => time }); const worker = createWorker(mock);
  const responses = await Promise.all([worker.fetch(request(), env), worker.fetch(request(), env)]);
  assert.ok(responses.every((response) => response.status === 200));
  assert.equal(tokenCalls(mock).length, 1);
  time += 3500000;
  assert.equal((await worker.fetch(request(), env)).status, 200);
  assert.equal(tokenCalls(mock).length, 1);
  time += 50000;
  assert.equal((await worker.fetch(request(), env)).status, 200);
  assert.equal(tokenCalls(mock).length, 2);
});
test("a rejected token is renewed automatically once, without prompting the visitor", async () => {
  const mock = apiMock({ rejectCredentials: "first" }); const worker = createWorker(mock);
  assert.equal((await worker.fetch(request(), env)).status, 200);
  assert.equal(tokenCalls(mock).length, 2);
  const rejected = apiMock({ rejectCredentials: "always" });
  const response = await createWorker(rejected).fetch(request(), env);
  assert.equal(response.status, 503);
  assert.ok(!JSON.stringify(await response.json()).match(/sesión|entrar|login|installation-token|PRIVATE KEY/i));
  assert.ok(tokenCalls(rejected).length <= 2);
});
test("an expired permission during a save is renewed once and the save succeeds", async () => {
  const mock = apiMock({ rejectWriteFirst: true }); const worker = createWorker(mock);
  const menu = structuredClone(fixture); menu.sections[0].items[0].name = "Saved after renewal";
  assert.equal((await worker.fetch(put(menu), env)).status, 200);
  assert.equal(tokenCalls(mock).length, 2);
  assert.equal(writes(mock).length, 2);
  assert.equal((await (await worker.fetch(request(), env)).json()).menu.sections[0].items[0].name, "Saved after renewal");
});
test("changing installation configuration cannot reuse credentials for a different repository", async () => {
  const mock = apiMock(); const worker = createWorker(mock);
  assert.equal((await worker.fetch(request(), env)).status, 200);
  assert.equal((await worker.fetch(request(), { ...env, GITHUB_APP_ID: "789" })).status, 200);
  assert.equal(tokenCalls(mock).length, 2);
});
test("CORS allows the editor without Authorization and rejects unrelated browser origins", async () => {
  const worker = createWorker(apiMock());
  const response = await worker.fetch(request(), env);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://editor.example");
  assert.equal(response.headers.get("Access-Control-Allow-Headers"), "Content-Type");
  const preflight = await worker.fetch(request("/api/menu", { method: "OPTIONS" }), env);
  assert.equal(preflight.status, 204);
  const rejected = await worker.fetch(request("/api/menu", { headers: { Origin: "https://other.example" } }), env);
  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers.get("Access-Control-Allow-Origin"), null);
});
test("former login, callback and session routes are removed even before configuration", async () => {
  const mock = apiMock(); const worker = createWorker(mock);
  for (const route of ["/api/session", "/auth/login", "/auth/callback?code=old&state=old"]) {
    const response = await worker.fetch(new Request(`https://api.example${route}`), {});
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("Location"), null);
    assert.equal(response.headers.get("Set-Cookie"), null);
  }
  assert.equal(mock.calls.length, 0);
});
test("anonymous save writes only menu.json, preserves Unicode and records the application", async () => {
  const mock = apiMock(); const worker = createWorker(mock);
  const menu = structuredClone(fixture);
  menu.sections[0].items.push({ name: "Piña y ñandú", price: "5.00€", custom: { preserved: true } });
  const response = await worker.fetch(put(menu), env);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.version, nextVersion);
  assert.equal(result.menu._editor.saveNumber, 1);
  const [write] = writes(mock);
  assert.equal(write.url, "https://api.github.com/repos/owner/menu/contents/menu.json");
  const body = JSON.parse(write.options.body);
  assert.equal(body.branch, "main"); assert.equal(body.sha, version);
  assert.match(body.message, /^#1 - Cambios del \d{1,2} de [A-ZÁÉÍÓÚ][a-záéíóú]+$/);
  const stored = JSON.parse(Buffer.from(body.content, "base64").toString("utf8"));
  assert.deepEqual(stored, result.menu);
  delete stored._editor;
  assert.deepEqual(stored, menu);
});
test("two visitors using the same initial version cannot overwrite one another", async () => {
  const mock = apiMock(); const worker = createWorker(mock);
  const first = structuredClone(fixture); first.sections[0].items[0].name = "Visitor one";
  const second = structuredClone(fixture); second.sections[0].items[0].name = "Visitor two";
  const responses = await Promise.all([worker.fetch(put(first), env), worker.fetch(put(second), env)]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const winner = responses[0].status === 200 ? "Visitor one" : "Visitor two";
  assert.equal((await (await worker.fetch(request(), env)).json()).menu.sections[0].items[0].name, winner);
});
test("save rejects invalid products, stale versions and nonexistent icons without writing", async () => {
  for (const scenario of ["invalid", "stale", "icon"]) {
    const mock = apiMock(); const worker = createWorker(mock); const menu = structuredClone(fixture);
    if (scenario === "invalid") menu.sections[0].items[0].price = "-2€";
    if (scenario === "icon") menu.allergens.lacteo.icon = "assets/allergens/missing.svg";
    const response = await worker.fetch(put(menu, scenario === "stale" ? nextVersion : version), env);
    assert.equal(response.status, scenario === "stale" ? 409 : 422);
    assert.equal(writes(mock).length, 0);
  }
});
test("save requires the editor origin and valid JSON and limits request size", async () => {
  const worker = createWorker(apiMock());
  assert.equal((await worker.fetch(put(fixture, version, { Origin: "" }), env)).status, 403);
  assert.equal((await worker.fetch(put(fixture, version, { "Content-Type": "text/plain" }), env)).status, 415);
  assert.equal((await worker.fetch(request("/api/menu", { method: "PUT", body: "{", headers: { "Content-Type": "application/json" } }), env)).status, 400);
  const huge = JSON.stringify({ menu: fixture, version, padding: "x".repeat(1024 * 1024) });
  assert.equal((await worker.fetch(request("/api/menu", { method: "PUT", body: huge }), env)).status, 413);
});
test("service setup failures remain useful, anonymous errors and never expose secrets", async () => {
  for (const changes of [{ GITHUB_APP_ID: "" }, { GITHUB_INSTALLATION_ID: "" }, { GITHUB_PRIVATE_KEY: "" }, { GITHUB_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----" }, { GITHUB_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nINVALID\n-----END PRIVATE KEY-----" }]) {
    const response = await createWorker(apiMock()).fetch(request(), { ...env, ...changes });
    assert.equal(response.status, 503);
    const body = JSON.stringify(await response.json());
    assert.ok(!body.includes(privateKey));
    assert.ok(!body.match(/entrar|sesión|login/i));
  }
  for (const overrides of [{ tokenStatus: 401 }, { tokenResponse: { token: "bad", expires_at: "invalid" } }, { readStatus: 403 }, { networkError: true }]) {
    const response = await createWorker(apiMock(overrides)).fetch(request(), env);
    assert.ok([502, 503].includes(response.status));
    assert.ok(!JSON.stringify(await response.json()).match(/entrar|sesión|login|installation-token|PRIVATE KEY/i));
  }
});
test("a failed token request does not prevent a later retry", async () => {
  let failing = true;
  const mock = apiMock();
  const worker = createWorker({ fetchImpl: async (...args) => failing ? Response.json({}, { status: 500 }) : mock.fetchImpl(...args) });
  assert.equal((await worker.fetch(request(), env)).status, 503);
  failing = false;
  assert.equal((await worker.fetch(request(), env)).status, 200);
});
test("GitHub write conflicts are returned without automatic overwrite", async () => {
  const mock = apiMock({ writeStatus: 409 }); const worker = createWorker(mock);
  const menu = structuredClone(fixture); menu.sections[0].items[0].name = "Changed";
  assert.equal((await worker.fetch(put(menu), env)).status, 409);
  assert.equal(writes(mock).length, 1);
});


test("save titles use Madrid dates and successive successful saves keep a single authoritative counter", async () => {
  const mock = apiMock({ now: () => Date.parse("2026-10-17T22:30:00Z") }); const worker = createWorker(mock);
  const edited = structuredClone(fixture); edited.sections[0].name = "First edit";
  edited._editor = { saveNumber: 999, savedAt: "2000-01-01T00:00:00Z" };
  const first = await (await worker.fetch(put(edited), env)).json();
  assert.equal(first.menu._editor.saveNumber, 1);
  assert.equal(first.menu._editor.savedAt, "2026-10-17T22:30:00.000Z");
  assert.equal(JSON.parse(writes(mock)[0].options.body).message, "#1 - Cambios del 18 de Octubre");
  // A client with old metadata must still be able to make the next real edit.
  delete edited._editor; edited.sections[0].name = "Second edit";
  const second = await (await worker.fetch(put(edited, first.version), env)).json();
  assert.equal(second.menu._editor.saveNumber, 2);
  assert.notEqual(second.version, first.version);
  assert.equal(JSON.parse(writes(mock)[1].options.body).message, "#2 - Cambios del 18 de Octubre");
  const unchanged = await (await worker.fetch(put(edited, second.version), env)).json();
  assert.equal(unchanged.menu._editor.saveNumber, 2);
  assert.equal(writes(mock).length, 2);
});
test("invalid saves, conflicts and failed writes do not consume save numbers", async () => {
  const options = { writeStatus: 500 }; const mock = apiMock(options); const worker = createWorker(mock);
  const edited = structuredClone(fixture); edited.sections[0].name = "A real edit";
  assert.equal((await worker.fetch(put(edited), env)).status, 502);
  assert.equal((await (await worker.fetch(request(), env)).json()).menu._editor, undefined);
  options.writeStatus = 0;
  const result = await (await worker.fetch(put(edited), env)).json();
  assert.equal(result.menu._editor.saveNumber, 1);
  assert.equal((await worker.fetch(put(edited), env)).status, 409);
  assert.equal((await (await worker.fetch(request(), env)).json()).menu._editor.saveNumber, 1);
});
test("metadata-only changes and reordered object keys do not create a commit", async () => {
  const menu = structuredClone(fixture);
  menu._editor = { saveNumber: 4, savedAt: "2026-10-17T12:00:00.000Z" };
  const mock = apiMock({ menu }); const worker = createWorker(mock);
  const edited = { _editor: { saveNumber: 999 }, sections: menu.sections, allergens: menu.allergens };
  const response = await worker.fetch(put(edited), env);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).menu._editor, menu._editor);
  assert.equal(writes(mock).length, 0);
});
test("a concurrent rejected save does not create gaps in the committed sequence", async () => {
  const mock = apiMock(); const worker = createWorker(mock);
  const first = structuredClone(fixture); first.sections[0].name = "One";
  const second = structuredClone(fixture); second.sections[0].name = "Two";
  const responses = await Promise.all([worker.fetch(put(first), env), worker.fetch(put(second), env)]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const current = await (await worker.fetch(request(), env)).json();
  assert.equal(current.menu._editor.saveNumber, 1);
  current.menu.sections[0].name = "Next real edit";
  const next = await (await worker.fetch(put(current.menu, current.version), env)).json();
  assert.equal(next.menu._editor.saveNumber, 2);
});
