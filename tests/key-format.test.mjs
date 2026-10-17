import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("documented OpenSSL conversion accepts a GitHub-style PKCS#1 key and produces a Web Crypto-compatible PKCS#8 key", async (t) => {
  const temp = await mkdtemp(path.join(tmpdir(), "mexicana-key-format-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const input = path.join(temp, "download.pem"), output = path.join(temp, "converted.pem");
  await writeFile(input, privateKey.export({ type: "pkcs1", format: "pem" }), { mode: 0o600 });
  execFileSync("openssl", ["pkcs8", "-topk8", "-nocrypt", "-in", input, "-out", output], { stdio: "pipe" });
  execFileSync("openssl", ["rsa", "-in", output, "-noout", "-check"], { stdio: "pipe" });
  const pem = await readFile(output, "utf8");
  assert.ok(pem.startsWith("-----BEGIN PRIVATE KEY-----"));
  const bytes = Buffer.from(pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, ""), "base64");
  const key = await crypto.subtle.importKey("pkcs8", bytes, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  assert.equal(key.type, "private");
});
