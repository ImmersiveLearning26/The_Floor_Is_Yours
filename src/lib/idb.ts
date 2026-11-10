// Local recovery copy of the one recording, kept only until the server confirms receipt.
const DB = 'floor-is-yours', STORE = 'recordings';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => { resolve(r.result); db.close(); };
    t.onerror = () => { reject(t.error); db.close(); };
  });
}
export type LocalRecording = { runId: string; blob: Blob; duration: number; savedAt: string };
export const localRecordings = {
  save: (rec: LocalRecording) => tx('readwrite', s => s.put(rec, rec.runId)).then(() => true),
  get: (runId: string) => tx<LocalRecording | undefined>('readonly', s => s.get(runId)).catch(() => undefined),
  remove: (runId: string) => tx('readwrite', s => s.delete(runId)).catch(() => undefined),
};
