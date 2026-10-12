"use client";

const DB_NAME = "realtimechat-e2ee";
const STORE_NAME = "identity";
const KEY_ID = "p256-identity-v1";

function openKeyDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readIdentity(userId) {
  const db = await openKeyDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(userId + ":" + KEY_ID);
    request.onsuccess = () => { db.close(); resolve(request.result || null); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

async function saveIdentity(userId, identity) {
  const db = await openKeyDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(identity, userId + ":" + KEY_ID);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function loadLocalIdentity(userId) {
  if (!globalThis.crypto?.subtle || !globalThis.indexedDB) throw new Error("This browser does not support secure local key storage. Use a current browser over HTTPS.");
  const stored = await readIdentity(userId);
  if (!stored) return null;
  // New identities keep a non-extractable CryptoKey in IndexedDB. This fallback
  // supports a key created by the first development version of this feature.
  if (stored.privateKey && stored.publicKeyJwk) return stored;
  if (stored.kty && stored.d) {
    const privateKey = await crypto.subtle.importKey("jwk", stored, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    const publicKeyJwk = { kty: stored.kty, crv: stored.crv, x: stored.x, y: stored.y, ext: true, key_ops: [] };
    const identity = { privateKey, publicKeyJwk };
    await saveIdentity(userId, identity);
    return identity;
  }
  throw new Error("The local encryption key could not be read.");
}

export async function createLocalIdentity(userId) {
  if (!globalThis.crypto?.subtle || !globalThis.indexedDB) throw new Error("This browser does not support secure local key storage. Use a current browser over HTTPS.");
  // Private CryptoKey is non-extractable and persisted locally using IndexedDB structured cloning.
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const identity = { privateKey: pair.privateKey, publicKeyJwk };
  await saveIdentity(userId, identity);
  return identity;
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}
function randomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}
function pairContext(roomId, a, b) {
  return "realtimechat-e2ee-v1:" + roomId + ":" + [a, b].sort().join(":");
}

async function deriveAesKey(privateKey, peerPublicJwk, salt, info) {
  const peerPublicKey = await crypto.subtle.importKey("jwk", peerPublicJwk, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const sharedBits = await crypto.subtle.deriveBits({ name: "ECDH", public: peerPublicKey }, privateKey, 256);
  const hkdfKey = await crypto.subtle.importKey("raw", sharedBits, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: new TextEncoder().encode(info) },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptForRecipients({ text, roomId, senderId, recipientIds, privateKey, publicKeyJwk, publicKeys }) {
  const recipients = {};
  const uniqueIds = [...new Set([...recipientIds, senderId])];
  for (const recipientId of uniqueIds) {
    const peerPublicJwk = recipientId === senderId ? publicKeyJwk : publicKeys[recipientId];
    if (!peerPublicJwk) throw new Error("A conversation participant has no encryption key yet. Ask them to open the chat again.");
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = await deriveAesKey(privateKey, peerPublicJwk, salt, pairContext(roomId, senderId, recipientId));
    const aad = new TextEncoder().encode("room:" + roomId + ":users:" + [senderId, recipientId].sort().join(":"));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad, tagLength: 128 }, key, new TextEncoder().encode(text));
    recipients[recipientId] = { salt: bytesToBase64(salt), iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) };
  }
  return { version: 1, algorithm: "ECDH-P256/HKDF-SHA256/AES-256-GCM", senderPublicKey: publicKeyJwk, recipients };
}

export async function decryptForRecipient({ envelope, roomId, senderId, recipientId, privateKey }) {
  if (!envelope || envelope.version !== 1 || !envelope.recipients?.[recipientId] || !envelope.senderPublicKey) {
    throw new Error("This message has no usable encrypted payload for this account.");
  }
  const item = envelope.recipients[recipientId];
  const salt = base64ToBytes(item.salt);
  const iv = base64ToBytes(item.iv);
  const key = await deriveAesKey(privateKey, envelope.senderPublicKey, salt, pairContext(roomId, senderId, recipientId));
  const aad = new TextEncoder().encode("room:" + roomId + ":users:" + [senderId, recipientId].sort().join(":"));
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad, tagLength: 128 }, key, base64ToBytes(item.ciphertext));
  return new TextDecoder().decode(plaintext);
}

export async function fingerprintPublicKey(publicKeyJwk) {
  const canonical = [publicKeyJwk?.kty, publicKeyJwk?.crv, publicKeyJwk?.x, publicKeyJwk?.y].join(":");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("").match(/.{1,4}/g).join(" ");
}
