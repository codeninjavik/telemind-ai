import { create } from "zustand";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

let csrf = "";
export const setCsrf = (t: string | null) => { csrf = t ?? ""; };

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...(method !== "GET" && csrf ? { "x-csrf-token": csrf } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? "error", data?.error?.message ?? `Request failed (${res.status})`);
  return data as T;
}
export const get = <T = any>(p: string) => api<T>("GET", p);
export const post = <T = any>(p: string, b?: unknown) => api<T>("POST", p, b ?? {});
export const patch = <T = any>(p: string, b: unknown) => api<T>("PATCH", p, b);
export const del = <T = any>(p: string) => api<T>("DELETE", p);

interface Toast { id: number; kind: "ok" | "err"; text: string }
export const useToasts = create<{ items: Toast[]; push: (kind: Toast["kind"], text: string) => void; drop: (id: number) => void }>((set) => ({
  items: [],
  push: (kind, text) => {
    const id = Date.now() + Math.random();
    set((s) => ({ items: [...s.items.slice(-3), { id, kind, text }] }));
    setTimeout(() => set((s) => ({ items: s.items.filter((t) => t.id !== id) })), 5000);
  },
  drop: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));
export const toast = {
  ok: (t: string) => useToasts.getState().push("ok", t),
  err: (e: unknown) => useToasts.getState().push("err", e instanceof Error ? e.message : String(e)),
};

export const ago = (iso: string | null | undefined) => {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
};
