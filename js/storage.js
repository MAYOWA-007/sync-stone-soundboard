import { REVISION_KEY, ROOM_KEY, STORAGE_KEY, createDefaultBoard, createRoomCode, normalizeBoard } from "./core.js";

const DB_NAME = "sync-stone-soundboard-public-audio-v1";
const DB_VERSION = 1;
const ASSET_STORE = "assets";

let databasePromise;

export function loadBoard() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? normalizeBoard(JSON.parse(saved)) : createDefaultBoard();
  } catch {
    return createDefaultBoard();
  }
}

export function saveBoard(board) {
  const normalized = normalizeBoard(board);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function loadRevision() {
  try {
    const saved = localStorage.getItem(REVISION_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

export function saveRevision(revision) {
  localStorage.setItem(REVISION_KEY, JSON.stringify(revision));
  return revision;
}

export function getRoomCode(requestedCode) {
  const cleaned = String(requestedCode || "").toUpperCase().replace(/[^23456789ABCDEFGHJKMNPQRSTUVWXYZ]/g, "").slice(0, 8);
  if (cleaned.length === 8) {
    localStorage.setItem(ROOM_KEY, cleaned);
    return cleaned;
  }
  const saved = localStorage.getItem(ROOM_KEY);
  if (saved?.length === 8) return saved;
  const generated = createRoomCode();
  localStorage.setItem(ROOM_KEY, generated);
  return generated;
}

export async function putAsset(asset) {
  const database = await openDatabase();
  return transactionPromise(database, "readwrite", (store) => store.put(asset));
}

export async function getAsset(assetId) {
  const database = await openDatabase();
  return transactionPromise(database, "readonly", (store) => store.get(assetId));
}

export async function deleteAsset(assetId) {
  const database = await openDatabase();
  return transactionPromise(database, "readwrite", (store) => store.delete(assetId));
}

export async function listAssets() {
  const database = await openDatabase();
  return transactionPromise(database, "readonly", (store) => store.getAll());
}

export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return { supported: false, persisted: false };
  const persisted = await navigator.storage.persist();
  const estimate = navigator.storage.estimate ? await navigator.storage.estimate() : {};
  return { supported: true, persisted, ...estimate };
}

function openDatabase() {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.addEventListener("upgradeneeded", () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(ASSET_STORE)) {
          const store = database.createObjectStore(ASSET_STORE, { keyPath: "id" });
          store.createIndex("createdAt", "createdAt");
        }
      });
      request.addEventListener("success", () => resolve(request.result), { once: true });
      request.addEventListener("error", () => reject(request.error || new Error("Audio storage could not be opened.")), { once: true });
      request.addEventListener("blocked", () => reject(new Error("Audio storage is blocked by another tab.")), { once: true });
    });
  }
  return databasePromise;
}

function transactionPromise(database, mode, action) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(ASSET_STORE, mode);
    const store = transaction.objectStore(ASSET_STORE);
    const request = action(store);
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error || new Error("Audio storage operation failed.")), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error || new Error("Audio storage transaction was aborted.")), { once: true });
  });
}
