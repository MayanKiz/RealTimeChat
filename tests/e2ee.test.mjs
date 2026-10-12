import test from "node:test";
import assert from "node:assert/strict";
test("E2EE module uses the required browser cryptography primitives", async()=>{const source=await (await import('node:fs/promises')).readFile(new URL('../src/lib/e2ee.js',import.meta.url),'utf8');assert.match(source,/ECDH/);assert.match(source,/HKDF/);assert.match(source,/AES-GCM/);assert.match(source,/indexedDB/);});
