import { AIError, type AIProvider, type AIResult, type Turn } from "../server/ai";
import { handle } from "../server/api";
import type { Deps } from "../server/service";
import { MemoryStore } from "../server/store";
import { TgError, type Account, type Connection, type Gateway, type Incoming } from "../server/telegram";

export class FakeAI implements AIProvider {
  calls: { system: string; turns: Turn[] }[] = [];
  next: (() => string | AIError) | null = null;
  reply = "Sure, I will check and get back to you.";
  async generate(system: string, turns: Turn[]): Promise<AIResult> {
    this.calls.push({ system, turns });
    const r = this.next ? this.next() : this.reply;
    if (r instanceof AIError) throw r;
    return { text: r, model: "fake-model", ms: 12 };
  }
  async listModels() {
    return ["fake-model"];
  }
}

export class FakeTelegram implements Gateway {
  sent: { peerId: number; text: string }[] = [];
  inbox: Incoming[] = [];
  unread: Record<number, number> = {};
  failSend = false;
  codeOk = "12345";
  needPassword = false;
  account: Account = { id: 111, name: "Owner", username: "owner" };
  async sendCode() {
    return { session: "s0", phoneCodeHash: "hash" };
  }
  async signIn(_s: string, _p: string, _h: string, code: string) {
    if (code !== this.codeOk) throw new TgError("bad_code", "That code is not correct.");
    return this.needPassword ? { session: "s1", needPassword: true } : { session: "s2", account: this.account };
  }
  async signInPassword(_s: string, pw: string) {
    if (pw !== "pw") throw new TgError("bad_password", "Two-step verification password is wrong.");
    return { session: "s2", account: this.account };
  }
  async open(): Promise<Connection> {
    return {
      me: async () => this.account,
      recent: async () => ({ unread: this.unread, messages: this.inbox }),
      send: async (peerId, _h, text) => {
        if (this.failSend) throw new TgError("network", "Could not reach Telegram. Try again.");
        this.sent.push({ peerId, text });
        return 9000 + this.sent.length;
      },
      logOut: async () => undefined,
      close: async () => undefined,
    };
  }
}

export interface Ctx {
  d: Deps;
  tg: FakeTelegram;
  ai: FakeAI;
  clock: { t: number };
  call: (method: string, path: string, body?: unknown, o?: { noAuth?: boolean; noCsrf?: boolean; origin?: string }) => Promise<{ status: number; body: any; res: Response }>;
}

export function makeCtx(over: Partial<Deps["env"]> = {}): Ctx {
  const tg = new FakeTelegram();
  const ai = new FakeAI();
  const clock = { t: Date.parse("2026-03-10T10:00:00Z") };
  const d: Deps = {
    store: new MemoryStore(),
    env: { adminPassword: "correct horse", appSecret: "x".repeat(40), tgApiId: 1, tgApiHash: "h".repeat(32), groqKey: "gsk_" + "k".repeat(30), ...over },
    gateway: () => tg,
    ai: () => ai,
    now: () => new Date(clock.t),
  };
  let cookie = "";
  let csrf = "";
  const call: Ctx["call"] = async (method, path, body, o = {}) => {
    const headers: Record<string, string> = { "content-type": "application/json", host: "localhost:8888" };
    if (cookie && !o.noAuth) headers.cookie = cookie;
    if (csrf && !o.noAuth && !o.noCsrf && method !== "GET") headers["x-csrf-token"] = csrf;
    if (o.origin) headers.origin = o.origin;
    const res = await handle(new Request("http://localhost:8888" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), d);
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : null;
    const sc = res.headers.get("set-cookie");
    if (sc && path === "/api/login") {
      cookie = sc.split(";")[0];
      csrf = parsed.csrf;
    }
    return { status: res.status, body: parsed, res };
  };
  return { d, tg, ai, clock, call };
}

export async function login(c: Ctx) {
  const r = await c.call("POST", "/api/login", { password: "correct horse" });
  if (r.status !== 200) throw new Error("login failed in test setup");
}

export async function connect(c: Ctx) {
  await login(c);
  await c.call("POST", "/api/telegram/request-code", { phone: "+919876543210" });
  const r = await c.call("POST", "/api/telegram/verify-code", { code: "12345" });
  if (r.body.status !== "connected") throw new Error("connect failed in test setup");
}

export const incoming = (peerId: number, msgId: number, text: string, at: string, over: Partial<Incoming> = {}): Incoming => ({
  peerId, accessHash: "77", title: `Friend ${peerId}`, username: null, msgId, text, at, outgoing: false, ...over,
});
