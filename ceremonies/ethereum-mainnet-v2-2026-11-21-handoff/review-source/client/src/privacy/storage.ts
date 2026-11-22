/** localStorage helpers with bigint-safe JSON. Never store decrypted secrets here. */

const BIG = "$bigint";

export function serialize(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? { [BIG]: v.toString() } : v));
}

export function deserialize<T>(text: string): T {
  return JSON.parse(text, (_k, v) => (v && typeof v === "object" && BIG in v ? BigInt(v[BIG]) : v)) as T;
}

export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? deserialize<T>(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, serialize(value));
  } catch (err) {
    console.warn("[privacy] failed to persist", key, err);
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
