import { getStore } from "@netlify/blobs";

// Netlify functions are stateless, so every piece of state lives in Netlify Blobs (one JSON value per key).
export interface Store {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  /** Creates the key only if it is new. false means it already existed (the idempotency primitive). */
  createOnce(key: string, value: unknown): Promise<boolean>;
  /** Atomic read-modify-write. fn returns the new value, or undefined to leave it unchanged. */
  update<T>(key: string, fn: (cur: T | null) => T | undefined | Promise<T | undefined>): Promise<T | null>;
}

export class BlobStore implements Store {
  private s = () => getStore({ name: "telemind", consistency: "strong" });
  async get<T>(key: string) {
    return ((await this.s().get(key, { type: "json" })) as T | null) ?? null;
  }
  async set(key: string, value: unknown) {
    await this.s().setJSON(key, value);
  }
  async del(key: string) {
    await this.s().delete(key);
  }
  async list(prefix: string) {
    const out: string[] = [];
    for await (const page of this.s().list({ prefix, paginate: true })) out.push(...page.blobs.map((b) => b.key));
    return out.sort();
  }
  async createOnce(key: string, value: unknown) {
    return (await this.s().setJSON(key, value, { onlyIfNew: true })).modified;
  }
  async update<T>(key: string, fn: (cur: T | null) => T | undefined | Promise<T | undefined>) {
    for (let i = 0; i < 30; i++) {
      const cur = await this.s().getWithMetadata(key, { type: "json" });
      const value = (cur?.data as T | undefined) ?? null;
      const next = await fn(value ? structuredClone(value) : null);
      if (next === undefined) return value;
      const r = cur
        ? await this.s().setJSON(key, next, { onlyIfMatch: cur.etag })
        : await this.s().setJSON(key, next, { onlyIfNew: true });
      if (r.modified) return next;
      await new Promise((res) => setTimeout(res, 5 + Math.random() * 30));
    }
    throw new Error(`could not update ${key} (too much contention)`);
  }
}

export class MemoryStore implements Store {
  private m = new Map<string, string>();
  async get<T>(key: string) {
    const v = this.m.get(key);
    return v === undefined ? null : (JSON.parse(v) as T);
  }
  async set(key: string, value: unknown) {
    this.m.set(key, JSON.stringify(value));
  }
  async del(key: string) {
    this.m.delete(key);
  }
  async list(prefix: string) {
    return [...this.m.keys()].filter((k) => k.startsWith(prefix)).sort();
  }
  async createOnce(key: string, value: unknown) {
    if (this.m.has(key)) return false;
    this.m.set(key, JSON.stringify(value));
    return true;
  }
  async update<T>(key: string, fn: (cur: T | null) => T | undefined | Promise<T | undefined>) {
    const cur = await this.get<T>(key);
    const next = await fn(cur ? structuredClone(cur) : null);
    if (next === undefined) return cur;
    this.m.set(key, JSON.stringify(next));
    return next;
  }
}
