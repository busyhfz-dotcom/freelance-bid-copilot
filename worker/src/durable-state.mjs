import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// Serialize writes per file: a slow earlier snapshot cannot replace newer state.
export function createAtomicWriter() {
  const writes = new Map();
  let sequence = 0;
  return function atomicWrite(file, value) {
    const previous = writes.get(file) || Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temporary = file + "." + process.pid + "." + (++sequence) + ".tmp";
      let handle;
      try {
        handle = await fs.open(temporary, "wx", 0o600);
        await handle.writeFile(value);
        await handle.sync();
        await handle.close();
        handle = null;
        // Windows readers/virus scanners can briefly deny replacement.
        // Retry only transient sharing errors; never unlink the last good file.
        for (let attempt = 0; ; attempt++) {
          try { await fs.rename(temporary, file); break; }
          catch (error) {
            if (process.platform !== "win32" || !["EPERM", "EBUSY", "EACCES"].includes(error.code) || attempt >= 5) throw error;
            await delay(20 * (attempt + 1));
          }
        }
        // Persist the rename on Linux volumes as well as the file contents.
        if (process.platform !== "win32") {
          const directory = await fs.open(path.dirname(file), "r");
          try { await directory.sync(); } finally { await directory.close(); }
        }
      } finally {
        await handle?.close().catch(() => {});
        await fs.unlink(temporary).catch(() => {});
      }
    });
    writes.set(file, current);
    void current.finally(() => { if (writes.get(file) === current) writes.delete(file); }).catch(() => {});
    return current;
  };
}
