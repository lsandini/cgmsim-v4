/**
 * IndexedDB session persistence for CGMSIM v4.
 *
 * Stores:
 *   - SimulationState: the full serialised WorkerState snapshot
 *   - SessionHistory:  append-only CGM + event log (for future AGP)
 *
 * Uses the native IndexedDB API directly (no idb library dependency)
 * so the standalone HTML has no extra imports.
 */
const DB_NAME = 'cgmsim-v4';
const DB_VERSION = 1;
const STORE_STATE = 'simulation-state';
const STORE_HISTORY = 'session-history';
const STATE_KEY = 'current';
// ── DB open ───────────────────────────────────────────────────────────────────
let _db = null;
function openDB() {
    if (_db)
        return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_STATE)) {
                db.createObjectStore(STORE_STATE);
            }
            if (!db.objectStoreNames.contains(STORE_HISTORY)) {
                db.createObjectStore(STORE_HISTORY, { autoIncrement: true });
            }
        };
        req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
        req.onerror = () => reject(req.error);
    });
}
// ── Save / Load state ─────────────────────────────────────────────────────────
export async function saveState(state) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_STATE, 'readwrite');
        const req = tx.objectStore(STORE_STATE).put(state, STATE_KEY);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}
export async function loadState() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_STATE, 'readonly');
        const req = tx.objectStore(STORE_STATE).get(STATE_KEY);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
    });
}
export async function clearState() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_STATE, 'readwrite');
        const req = tx.objectStore(STORE_STATE).delete(STATE_KEY);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}
// ── Export / Import (JSON file) ───────────────────────────────────────────────
export function exportSession(state) {
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: Date.now(), state }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cgmsim-session-${new Date().toISOString().slice(0, 16).replace('T', '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
}
export function importSession() {
    return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.onchange = () => {
            const file = input.files?.[0];
            if (!file) {
                reject(new Error('No file selected'));
                return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const parsed = JSON.parse(reader.result);
                    if (!parsed.state)
                        throw new Error('Invalid session file');
                    resolve(parsed.state);
                }
                catch (e) {
                    reject(e);
                }
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsText(file);
        };
        input.click();
    });
}
//# sourceMappingURL=storage.js.map