// IndexedDB persistence for guides and screenshots. Everything stays in the
// extension's own origin on this device. Used by the service worker (while
// recording) and by the app page (editing and exporting).
import type { Guide } from "./guide.ts";
import { imageIdsOf } from "./guide.ts";

const DB_NAME = "stepsmith";
const DB_VERSION = 1;
const GUIDES = "guides";
const IMAGES = "images";

export interface StoredImage {
  id: string;
  blob: Blob;
  width: number;
  height: number;
}

let opened: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore(GUIDES, { keyPath: "id" });
      db.createObjectStore(IMAGES, { keyPath: "id" });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        opened = undefined;
      };
      resolve(db);
    };
    request.onerror = () => {
      opened = undefined;
      reject(request.error ?? new Error("Could not open the guide database"));
    };
  });
  return opened;
}

async function run<T>(
  stores: string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const request = work(tx);
    tx.oncomplete = () => resolve(request === undefined ? undefined : request.result);
    tx.onerror = () => reject(tx.error ?? new Error("Database error"));
    tx.onabort = () => reject(tx.error ?? new Error("Database transaction aborted"));
  });
}

export async function saveGuide(guide: Guide): Promise<void> {
  await run([GUIDES], "readwrite", (tx) => tx.objectStore(GUIDES).put(guide));
}

export async function getGuide(id: string): Promise<Guide | undefined> {
  return (await run([GUIDES], "readonly", (tx) => tx.objectStore(GUIDES).get(id))) as
    | Guide
    | undefined;
}

/** Newest first. */
export async function listGuides(): Promise<Guide[]> {
  const all = ((await run([GUIDES], "readonly", (tx) =>
    tx.objectStore(GUIDES).getAll(),
  )) ?? []) as Guide[];
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveImage(image: StoredImage): Promise<void> {
  await run([IMAGES], "readwrite", (tx) => tx.objectStore(IMAGES).put(image));
}

export async function getImage(id: string): Promise<StoredImage | undefined> {
  return (await run([IMAGES], "readonly", (tx) => tx.objectStore(IMAGES).get(id))) as
    | StoredImage
    | undefined;
}

export async function deleteImages(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await run([IMAGES], "readwrite", (tx) => {
    for (const id of ids) tx.objectStore(IMAGES).delete(id);
  });
}

export async function deleteGuide(guide: Guide): Promise<void> {
  await run([GUIDES, IMAGES], "readwrite", (tx) => {
    tx.objectStore(GUIDES).delete(guide.id);
    for (const id of imageIdsOf(guide)) tx.objectStore(IMAGES).delete(id);
  });
}

/** Wipes every guide and screenshot. Backs the "Delete all my data" button. */
export async function clearEverything(): Promise<void> {
  await run([GUIDES, IMAGES], "readwrite", (tx) => {
    tx.objectStore(GUIDES).clear();
    tx.objectStore(IMAGES).clear();
  });
}
