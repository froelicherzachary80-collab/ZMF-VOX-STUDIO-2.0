/** Tiny promise wrapper over IndexedDB. Stores: projects, assets, singers, models, presets. */
const DB_NAME = 'zmf-vox-studio', VERSION = 1;
export type StoreName = 'projects' | 'assets' | 'singers' | 'models' | 'presets';
let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, VERSION);
    r.onupgradeneeded = () => { for (const s of ['projects', 'assets', 'singers', 'models', 'presets']) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function put<T>(store: StoreName, key: string, value: T) { const d = await open(); return req(d.transaction(store, 'readwrite').objectStore(store).put(value, key)); }
export async function get<T>(store: StoreName, key: string): Promise<T | undefined> { const d = await open(); return req(d.transaction(store).objectStore(store).get(key)); }
export async function del(store: StoreName, key: string) { const d = await open(); return req(d.transaction(store, 'readwrite').objectStore(store).delete(key)); }
export async function keys(store: StoreName): Promise<string[]> { const d = await open(); return (await req(d.transaction(store).objectStore(store).getAllKeys())) as string[]; }
export async function all<T>(store: StoreName): Promise<T[]> { const d = await open(); return req(d.transaction(store).objectStore(store).getAll()); }

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
