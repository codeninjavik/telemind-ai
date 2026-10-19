import { AIError, buildSystemPrompt, buildTurns, cleanReply, type AIProvider } from "./ai";
import { randomToken, seal, unseal } from "./crypto";
import { injectionSignals, sensitiveIncoming, sensitiveReply } from "./safety";
import type { Store } from "./store";
import { TgError, type Connection, type Gateway, type Incoming } from "./telegram";
import {
  DEFAULT_BUSINESS, DEFAULT_VIDEO_LINKS, dayKey, initialState, initialTg, SettingsSchema,
  type AssistantState, type Contact, type Conv, type Draft, type LogEntry, type Msg, type Rule, type Settings, type TgMeta,
} from "./types";

export interface Env {
  adminPassword?: string;
  appSecret?: string;
  tgApiId?: number;
  tgApiHash?: string;
  groqKey?: string;
}
export interface Deps {
  store: Store;
  env: Env;
  gateway: () => Gateway | null;
  ai: () => AIProvider | null;
  now: () => Date;
}

export class ServiceError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

const MAX_MSGS = 80;

// ---------------------------------------------------------------- settings / state
// Model ids that stopped working for this deployment's keys are replaced by the current default.
const RETIRED_MODELS = new Set(["llama-3.3-70b-versatile"]);
export async function getSettings(d: Deps): Promise<Settings> {
  let s = SettingsSchema.parse((await d.store.get("settings")) ?? {});
  if (RETIRED_MODELS.has(s.model)) s = { ...s, model: SettingsSchema.shape.model.parse(undefined) };
  // A copy saved before the defaults were extended gets the new links (once; a link you remove later stays removed).
  if (s.business.name === DEFAULT_BUSINESS.name && s.business.v < DEFAULT_BUSINESS.v) {
    const have = new Set(s.business.links.map((l) => l.url));
    s = { ...s, business: { ...s.business, v: DEFAULT_BUSINESS.v, links: [...s.business.links, ...DEFAULT_VIDEO_LINKS.filter((l) => !have.has(l.url))] } };
  }
  return s;
}
export async function getState(d: Deps): Promise<AssistantState> {
  return { ...initialState(), ...((await d.store.get<AssistantState>("state")) ?? {}) };
}
const patchState = (d: Deps, fn: (s: AssistantState) => void) =>
  d.store.update<AssistantState>("state", (cur) => {
    const s = { ...initialState(), ...(cur ?? {}) };
    fn(s);
    return s;
  }) as Promise<AssistantState>;

export async function saveSettings(d: Deps, patch: Record<string, unknown>): Promise<Settings> {
  const before = await getSettings(d);
  const { confirmAuto, ...rest } = patch as { confirmAuto?: boolean } & Record<string, unknown>;
  const next = SettingsSchema.parse({ ...before, ...rest });
  if (next.mode === "auto" && before.mode !== "auto") {
    if (!confirmAuto) throw new ServiceError(400, "confirm_required", "Automatic sending needs your explicit confirmation.");
    await patchState(d, (s) => { s.autoConfirmedAt = d.now().toISOString(); });
  }
  if (next.mode !== "auto") await patchState(d, (s) => { s.autoConfirmedAt = null; });
  await d.store.set("settings", next);
  return next;
}

export async function startAssistant(d: Deps): Promise<AssistantState> {
  if ((await getTg(d)).status !== "connected") throw new ServiceError(409, "telegram_not_connected", "Connect Telegram first.");
  if (!d.ai()) throw new ServiceError(409, "ai_not_configured", "Set GROQ_API_KEY in the site environment variables first.");
  const s = await getSettings(d);
  const st = await getState(d);
  if (s.mode === "auto" && !st.autoConfirmedAt) throw new ServiceError(409, "confirm_required", "Confirm automatic sending in Settings first.");
  return patchState(d, (x) => { x.running = true; x.startedAt = d.now().toISOString(); x.lastError = null; });
}
export async function stopAssistant(d: Deps, emergency = false): Promise<AssistantState> {
  if (emergency) {
    const s = await getSettings(d);
    if (s.mode === "auto") await d.store.set("settings", { ...s, mode: "draft" });
  }
  return patchState(d, (x) => { x.running = false; if (emergency) x.autoConfirmedAt = null; });
}

// ---------------------------------------------------------------- telegram connection
export async function getTg(d: Deps): Promise<TgMeta> {
  return { ...initialTg(), ...((await d.store.get<TgMeta>("tg/meta")) ?? {}) };
}
const setTg = async (d: Deps, patch: Partial<TgMeta>) => {
  const next = { ...(await getTg(d)), ...patch };
  await d.store.set("tg/meta", next);
  return next;
};
const secret = (d: Deps) => {
  if (!d.env.appSecret) throw new ServiceError(503, "not_configured", "APP_SECRET is not set.");
  return d.env.appSecret;
};
const gw = (d: Deps) => {
  const g = d.gateway();
  if (!g) throw new ServiceError(409, "telegram_not_configured", "Set TG_API_ID and TG_API_HASH in the site environment variables first.");
  return g;
};
const tgFail = (e: unknown): never => {
  if (e instanceof TgError) throw new ServiceError(e.kind === "flood" ? 429 : e.kind === "network" ? 502 : 400, `tg_${e.kind}`, e.message);
  throw e;
};

export async function requestCode(d: Deps, phone: string) {
  try {
    const r = await gw(d).sendCode(phone);
    await d.store.set("tg/pending", { blob: seal(JSON.stringify({ session: r.session, phone, hash: r.phoneCodeHash }), secret(d)), at: d.now().toISOString() });
    return setTg(d, { status: "awaiting_code", phoneHint: `${phone.slice(0, 3)}••••${phone.slice(-2)}`, lastError: null });
  } catch (e) {
    return tgFail(e);
  }
}
async function pending(d: Deps) {
  const p = await d.store.get<{ blob: string; at: string }>("tg/pending");
  const data = p ? unseal(p.blob, secret(d)) : null;
  if (!p || !data || d.now().getTime() - Date.parse(p.at) > 15 * 60_000) throw new ServiceError(409, "no_pending_login", "No login in progress, or it expired. Request a new code.");
  return JSON.parse(data) as { session: string; phone: string; hash: string };
}
async function complete(d: Deps, session: string, account: { id: number; name: string; username: string | null }) {
  await d.store.set("tg/session", { blob: seal(session, secret(d)) });
  await d.store.del("tg/pending");
  return setTg(d, { status: "connected", accountId: account.id, accountName: account.name, username: account.username, connectedAt: d.now().toISOString(), lastError: null });
}
export async function verifyCode(d: Deps, input: { code?: string; password?: string }) {
  const p = await pending(d);
  try {
    if (input.password) {
      const r = await gw(d).signInPassword(p.session, input.password);
      return await complete(d, r.session, r.account);
    }
    if (!input.code) throw new ServiceError(400, "code_required", "Enter the login code.");
    const r = await gw(d).signIn(p.session, p.phone, p.hash, input.code);
    if (r.needPassword) {
      await d.store.set("tg/pending", { blob: seal(JSON.stringify({ ...p, session: r.session }), secret(d)), at: d.now().toISOString() });
      return setTg(d, { status: "awaiting_password" });
    }
    return await complete(d, r.session, r.account!);
  } catch (e) {
    return tgFail(e);
  }
}
export async function disconnectTg(d: Deps, revoke: boolean) {
  await stopAssistant(d);
  if (revoke) {
    try {
      const c = await openConn(d);
      await c.logOut();
      await c.close();
    } catch {
      /* the local session is removed either way */
    }
  }
  await d.store.del("tg/session");
  await d.store.del("tg/pending");
  return setTg(d, { ...initialTg() });
}
async function openConn(d: Deps): Promise<Connection> {
  const rec = await d.store.get<{ blob: string }>("tg/session");
  const session = rec ? unseal(rec.blob, secret(d)) : null;
  if (!session) throw new ServiceError(409, "telegram_not_connected", "Telegram is not connected.");
  try {
    return await gw(d).open(session);
  } catch (e) {
    if (e instanceof TgError && e.kind === "auth_lost") {
      await setTg(d, { status: "error", lastError: e.message });
      await patchState(d, (s) => { s.running = false; });
    }
    return tgFail(e);
  }
}

// ---------------------------------------------------------------- conversations / contacts
const preview = (t: string) => t.replace(/\s+/g, " ").slice(0, 120);

export async function getConv(d: Deps, peerId: number) {
  return d.store.get<Conv>(`conv/${peerId}`);
}
export async function listConvs(d: Deps): Promise<Conv[]> {
  const keys = await d.store.list("conv/");
  const all = await Promise.all(keys.map((k) => d.store.get<Conv>(k)));
  return all.filter((c): c is Conv => !!c).sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
}
export async function getContact(d: Deps, peerId: number) {
  return d.store.get<Contact>(`contact/${peerId}`);
}
export async function listContacts(d: Deps): Promise<Contact[]> {
  const keys = await d.store.list("contact/");
  const all = await Promise.all(keys.map((k) => d.store.get<Contact>(k)));
  return all.filter((c): c is Contact => !!c).sort((a, b) => (b.lastInteraction ?? "").localeCompare(a.lastInteraction ?? ""));
}
const newContact = (i: Incoming): Contact => ({
  peerId: i.peerId, name: i.title, username: i.username, automation: true, allowlisted: false, blocked: false,
  language: null, tone: null, instructions: "", notes: "", lastInteraction: null, count: 0,
});

/** Merges fetched messages into the stored conversation. Returns the incoming messages that were new. */
async function ingest(d: Deps, items: Incoming[], unread: Record<number, number>): Promise<{ peerId: number; fresh: number[] }[]> {
  const byPeer = new Map<number, Incoming[]>();
  for (const i of items) byPeer.set(i.peerId, [...(byPeer.get(i.peerId) ?? []), i]);
  const out: { peerId: number; fresh: number[] }[] = [];
  for (const [peerId, list] of byPeer) {
    const fresh: number[] = [];
    const first = list[0];
    await d.store.update<Conv>(`conv/${peerId}`, (cur) => {
      const c: Conv = cur ?? { peerId, accessHash: first.accessHash, title: first.title, username: first.username, lastAt: null, preview: "", unread: 0, paused: false, excluded: false, messages: [] };
      c.accessHash = first.accessHash;
      c.title = first.title;
      c.username = first.username;
      const have = new Map(c.messages.map((m) => [`${m.dir}${m.id}`, m]));
      for (const i of list) {
        const dir = i.outgoing ? "out" : "in";
        if (have.has(`${dir}${i.msgId}`)) continue;
        const m: Msg = { id: i.msgId, dir, text: i.text, at: i.at, ...(dir === "in" ? { status: "received" as const } : {}) };
        c.messages.push(m);
        if (dir === "in") fresh.push(i.msgId);
      }
      c.messages.sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id);
      c.messages = c.messages.slice(-MAX_MSGS);
      const last = c.messages[c.messages.length - 1];
      if (last) { c.lastAt = last.at; c.preview = preview(last.text); }
      c.unread = unread[peerId] ?? c.unread;
      return c;
    });
    await d.store.update<Contact>(`contact/${peerId}`, (cur) => {
      const c = cur ?? newContact(first);
      c.name = first.title;
      c.username = first.username;
      const incoming = list.filter((i) => !i.outgoing);
      if (fresh.length) c.count += fresh.length;
      const latest = list.map((i) => i.at).sort().pop();
      if (latest && (!c.lastInteraction || latest > c.lastInteraction)) c.lastInteraction = latest;
      return incoming.length || !cur ? c : undefined;
    });
    out.push({ peerId, fresh });
  }
  return out;
}

export async function patchConv(d: Deps, peerId: number, patch: { paused?: boolean; excluded?: boolean }) {
  const c = await d.store.update<Conv>(`conv/${peerId}`, (cur) => (cur ? { ...cur, ...patch } : undefined));
  if (!c) throw new ServiceError(404, "not_found", "Conversation not found.");
  return c;
}
export async function patchContact(d: Deps, peerId: number, patch: Partial<Contact> & { paused?: boolean }) {
  const { paused, ...rest } = patch;
  const c = await d.store.update<Contact>(`contact/${peerId}`, (cur) => (cur ? { ...cur, ...rest } : undefined));
  if (!c) throw new ServiceError(404, "not_found", "Contact not found.");
  if (paused !== undefined) await patchConv(d, peerId, { paused });
  return c;
}

// ---------------------------------------------------------------- rules
export async function listRules(d: Deps): Promise<Rule[]> {
  return (await d.store.get<Rule[]>("rules")) ?? [];
}
export const saveRules = (d: Deps, rules: Rule[]) => d.store.set("rules", rules);
export const newRuleId = () => randomToken(8);

function minutesOf(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
export function inQuietHours(now: Date, tz: string, start: string, end: string): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  const cur = minutesOf(parts);
  const a = minutesOf(start), b = minutesOf(end);
  if (a === b) return false;
  return a < b ? cur >= a && cur < b : cur >= a || cur < b;
}

interface RuleVerdict {
  skip: string | null;
  review: string | null;
  needAllowlist: boolean;
  quiet: boolean;
  dailyLimit: number;
  faq: string[];
  tone: string | null;
}
function evalRules(rules: Rule[], text: string, s: Settings, now: Date): RuleVerdict {
  const v: RuleVerdict = { skip: null, review: null, needAllowlist: s.autoAllowlistOnly, quiet: false, dailyLimit: s.dailyLimit, faq: [], tone: null };
  const low = text.toLowerCase();
  const hit = (kw: string[]) => kw.find((k) => low.includes(k));
  if (s.quietHours.enabled) v.quiet = inQuietHours(now, s.timezone, s.quietHours.start, s.quietHours.end);
  for (const r of rules) {
    if (!r.enabled) continue;
    switch (r.type) {
      case "approved_contacts_only": v.needAllowlist = true; break;
      case "skip_keywords": { const k = hit(r.config.keywords); if (k && !v.skip) v.skip = `rule "${r.name}": ${k}`; break; }
      case "approval_keywords": { const k = hit(r.config.keywords); if (k && !v.review) v.review = `rule "${r.name}": ${k}`; break; }
      case "quiet_hours": if (inQuietHours(now, s.timezone, r.config.start, r.config.end)) v.quiet = true; break;
      case "daily_limit": v.dailyLimit = Math.min(v.dailyLimit, r.config.limit); break;
      case "faq": v.faq.push(...r.config.answers); break;
      case "tone": v.tone = r.config.tone; break;
    }
  }
  return v;
}

// ---------------------------------------------------------------- stats / log
type StatKey = "incoming" | "drafts" | "sentAuto" | "sentManual" | "skipped" | "aiFailed" | "aiOk" | "aiMs";
export type DayStats = Record<StatKey, number>;
const zeroStats = (): DayStats => ({ incoming: 0, drafts: 0, sentAuto: 0, sentManual: 0, skipped: 0, aiFailed: 0, aiOk: 0, aiMs: 0 });
async function bump(d: Deps, inc: Partial<DayStats>) {
  const day = dayKey(d.now());
  await d.store.update<DayStats>(`stat/${day}`, (cur) => {
    const s = { ...zeroStats(), ...(cur ?? {}) };
    for (const [k, n] of Object.entries(inc)) s[k as StatKey] += n as number;
    return s;
  });
}
export async function statsRange(d: Deps, days: number): Promise<{ day: string; s: DayStats }[]> {
  const list = Array.from({ length: days }, (_, k) => dayKey(new Date(d.now().getTime() - (days - 1 - k) * 86_400_000)));
  return Promise.all(list.map(async (day) => ({ day, s: { ...zeroStats(), ...((await d.store.get<DayStats>(`stat/${day}`)) ?? {}) } })));
}
async function writeLog(d: Deps, e: Omit<LogEntry, "id" | "at">) {
  const at = d.now().toISOString();
  const id = `${at}-${randomToken(4)}`;
  await d.store.set(`log/${id}`, { id, at, ...e });
}
export async function listLog(d: Deps, page: number, pageSize: number) {
  const keys = (await d.store.list("log/")).reverse();
  const slice = keys.slice((page - 1) * pageSize, page * pageSize);
  const items = (await Promise.all(slice.map((k) => d.store.get<LogEntry>(k)))).filter((x): x is LogEntry => !!x);
  return { items, total: keys.length, page, pageSize };
}

// ---------------------------------------------------------------- drafting
async function recordAi(d: Deps, ok: boolean, ms: number) {
  await bump(d, ok ? { aiOk: 1, aiMs: ms } : { aiFailed: 1 });
}

export async function draftFor(d: Deps, conv: Conv, msg: Msg, opts: { tone?: string | null } = {}): Promise<Draft> {
  const ai = d.ai();
  if (!ai) throw new AIError("not_configured", "Set GROQ_API_KEY in the site environment variables first.");
  const [s, rules, contact] = await Promise.all([getSettings(d), listRules(d), getContact(d, conv.peerId)]);
  const verdict = evalRules(rules, msg.text, s, d.now());
  const idx = conv.messages.findIndex((m) => m.id === msg.id && m.dir === msg.dir);
  const history = conv.messages.slice(Math.max(0, idx - s.historyLimit), Math.max(0, idx)).map((m) => ({ dir: m.dir, text: m.text }));
  const system = buildSystemPrompt(s, {
    contactName: contact?.name ?? conv.title, language: contact?.language, tone: opts.tone ?? contact?.tone ?? verdict.tone,
    instructions: contact?.instructions, faq: verdict.faq, business: s.business,
  });
  let res;
  try {
    res = await ai.generate(system, buildTurns(history, msg.text, contact?.name ?? conv.title), { model: s.model, temperature: s.temperature, maxTokens: s.maxTokens });
  } catch (e) {
    await recordAi(d, false, 0);
    throw e;
  }
  await recordAi(d, true, res.ms);
  const { text, needsReview } = cleanReply(res.text, s.maxChars);
  if (!text) throw new AIError("invalid_response", "The AI returned an empty reply.");
  const reasons: string[] = [];
  if (needsReview) reasons.push("the AI asked for review");
  if (injectionSignals(msg.text)) reasons.push("message tries to instruct the assistant");
  if (verdict.review) reasons.push(verdict.review);
  const leak = sensitiveReply(text);
  if (leak) reasons.push(leak);
  await bump(d, { drafts: 1 });
  return {
    text, model: res.model, ms: res.ms, createdAt: d.now().toISOString(), status: "pending",
    needsReview: reasons.length > 0, reviewReason: reasons.length ? reasons.join("; ").slice(0, 120) : null,
  };
}

export async function studio(d: Deps, sample: string, name: string, tone?: string) {
  const ai = d.ai();
  if (!ai) throw new ServiceError(409, "ai_not_configured", "Set GROQ_API_KEY in the site environment variables first.");
  const conv: Conv = { peerId: 0, accessHash: "0", title: name, username: null, lastAt: null, preview: "", unread: 0, paused: false, excluded: false, messages: [] };
  const msg: Msg = { id: 1, dir: "in", text: sample, at: d.now().toISOString() };
  conv.messages.push(msg);
  const dr = await draftFor(d, conv, msg, { tone });
  return dr;
}

async function mutateMsg(d: Deps, peerId: number, msgId: number, fn: (m: Msg, c: Conv) => void) {
  const c = await d.store.update<Conv>(`conv/${peerId}`, (cur) => {
    if (!cur) return undefined;
    const m = cur.messages.find((x) => x.id === msgId && x.dir === "in");
    if (!m) return undefined;
    fn(m, cur);
    return cur;
  });
  return c;
}

// ---------------------------------------------------------------- sending
/** Sends at most once per incoming message: the claim key is created before the network call. It is only released
 * when the send is known to have failed, and only an explicit manual retry can use it again. */
async function sendOnce(d: Deps, conn: Connection, conv: Conv, msg: Msg, text: string, o: { automatic: boolean; mode: LogEntry["mode"]; draft: string | null }) {
  const claim = await d.store.createOnce(`sent/${conv.peerId}/${msg.id}`, { at: d.now().toISOString() });
  if (!claim) throw new ServiceError(409, "already_replied", "This message was already answered.");
  let sentId: number;
  try {
    sentId = await conn.send(conv.peerId, conv.accessHash, text);
  } catch (e) {
    await mutateMsg(d, conv.peerId, msg.id, (m) => { m.status = "failed"; m.reason = "send failed"; if (m.draft) m.draft.status = "pending"; });
    await writeLog(d, { peerId: conv.peerId, contact: conv.title, msgId: msg.id, incoming: msg.text, draft: o.draft, final: text, mode: o.mode, status: "failed", reason: "send failed", error: e instanceof Error ? e.message : "send failed", automatic: o.automatic });
    await d.store.del(`sent/${conv.peerId}/${msg.id}`).catch(() => undefined); // the send did not happen: allow an explicit retry
    throw e;
  }
  const at = d.now().toISOString();
  await d.store.update<Conv>(`conv/${conv.peerId}`, (cur) => {
    if (!cur) return undefined;
    const m = cur.messages.find((x) => x.id === msg.id && x.dir === "in");
    if (m) { m.status = "replied"; m.reason = null; m.auto = o.automatic; if (m.draft) m.draft.status = "sent"; }
    cur.messages.push({ id: sentId, dir: "out", text, at, auto: o.automatic });
    cur.messages = cur.messages.slice(-MAX_MSGS);
    cur.lastAt = at; cur.preview = preview(text); cur.unread = 0;
    return cur;
  });
  const day = dayKey(d.now());
  await patchState(d, (s) => {
    s.lastSentAt[String(conv.peerId)] = at;
    s.day = s.day.date === day ? { date: day, sent: s.day.sent + 1 } : { date: day, sent: 1 };
  });
  await bump(d, o.automatic ? { sentAuto: 1 } : { sentManual: 1 });
  await writeLog(d, { peerId: conv.peerId, contact: conv.title, msgId: msg.id, incoming: msg.text, draft: o.draft, final: text, mode: o.mode, status: "sent", reason: null, error: null, automatic: o.automatic });
}

// ---------------------------------------------------------------- manual actions
const need = async (d: Deps, peerId: number, msgId: number) => {
  const conv = await getConv(d, peerId);
  const msg = conv?.messages.find((m) => m.id === msgId && m.dir === "in");
  if (!conv || !msg) throw new ServiceError(404, "not_found", "Message not found.");
  return { conv, msg };
};

export async function generateDraft(d: Deps, peerId: number, msgId: number, tone?: string) {
  const { conv, msg } = await need(d, peerId, msgId);
  if (msg.status === "replied") throw new ServiceError(409, "already_replied", "This message was already answered.");
  try {
    const dr = await draftFor(d, conv, msg, { tone });
    await mutateMsg(d, peerId, msgId, (m) => { m.draft = dr; m.status = "pending_approval"; m.reason = null; m.handled = true; });
    return dr;
  } catch (e) {
    if (e instanceof AIError) {
      await mutateMsg(d, peerId, msgId, (m) => { m.status = "failed"; m.reason = `AI error: ${e.kind}`; m.handled = true; });
      throw new ServiceError(e.kind === "rate_limit" ? 429 : e.kind === "auth" || e.kind === "not_configured" ? 409 : 502, `ai_${e.kind}`, e.message);
    }
    throw e;
  }
}

export async function approve(d: Deps, peerId: number, msgId: number, edited?: string) {
  const { conv, msg } = await need(d, peerId, msgId);
  if (msg.status === "replied") throw new ServiceError(409, "already_replied", "This message was already answered.");
  const s = await getSettings(d);
  const text = (edited ?? msg.draft?.text ?? "").trim();
  if (!text) throw new ServiceError(400, "empty", "There is no reply text to send.");
  if (text.length > 4000) throw new ServiceError(400, "too_long", "Telegram messages are limited to 4000 characters.");
  const contact = await getContact(d, peerId);
  if (contact?.blocked) throw new ServiceError(409, "blocked", "This contact is blocked in TeleMind.");
  const conn = await openConn(d);
  try {
    await sendOnce(d, conn, conv, msg, text, { automatic: false, mode: s.mode, draft: msg.draft?.text ?? null });
  } catch (e) {
    return tgFail(e);
  } finally {
    await conn.close();
  }
  return { ok: true };
}

export async function skip(d: Deps, peerId: number, msgId: number) {
  const { conv, msg } = await need(d, peerId, msgId);
  if (msg.status === "replied") throw new ServiceError(409, "already_replied", "This message was already answered.");
  await mutateMsg(d, peerId, msgId, (m) => { m.status = "skipped"; m.reason = "skipped by you"; m.handled = true; if (m.draft) m.draft.status = "discarded"; });
  await bump(d, { skipped: 1 });
  await writeLog(d, { peerId, contact: conv.title, msgId, incoming: msg.text, draft: msg.draft?.text ?? null, final: null, mode: (await getSettings(d)).mode, status: "skipped", reason: "skipped by you", error: null, automatic: false });
  return { ok: true };
}

// ---------------------------------------------------------------- the assistant loop
async function lock(d: Deps, name: string, ttlMs: number): Promise<boolean> {
  let got = false;
  await d.store.update<{ at: number }>(`lock/${name}`, (cur) => {
    if (cur && d.now().getTime() - cur.at < ttlMs) return undefined;
    got = true;
    return { at: d.now().getTime() };
  });
  return got;
}
const unlock = (d: Deps, name: string) => d.store.del(`lock/${name}`);

const MAX_TRIES = 3; // temporary AI failures are retried on the next checks before giving up
const MAX_AUTO_AGE_MS = 6 * 3_600_000; // older messages are never answered automatically
const CONCURRENCY = 4;

type Prepared =
  | { kind: "finished" }
  | { kind: "ready"; conv: Conv; msg: Msg; contact: Contact; draft: Draft; v: RuleVerdict };

/** Phase 1, safe to run in parallel: decide whether to skip, and write the AI draft. */
async function prepare(d: Deps, peerId: number, msgId: number, s: Settings): Promise<Prepared> {
  const conv = (await getConv(d, peerId))!;
  const msg = conv.messages.find((m) => m.id === msgId && m.dir === "in")!;
  const contact = (await getContact(d, peerId))!;
  const rules = await listRules(d);
  const v = evalRules(rules, msg.text, s, d.now());
  const finish = async (status: Msg["status"], reason: string | null, log?: "skipped" | "failed"): Promise<Prepared> => {
    await mutateMsg(d, peerId, msgId, (m) => { m.status = status; m.reason = reason; m.handled = true; });
    if (log) {
      await bump(d, log === "skipped" ? { skipped: 1 } : {});
      await writeLog(d, { peerId, contact: conv.title, msgId, incoming: msg.text, draft: null, final: null, mode: s.mode, status: log, reason, error: log === "failed" ? reason : null, automatic: false });
    }
    return { kind: "finished" };
  };
  // Not decided yet: the message stays queued and the next check picks it up again.
  const wait = async (reason: string): Promise<Prepared> => {
    await mutateMsg(d, peerId, msgId, (m) => { m.status = "received"; m.reason = reason; });
    return { kind: "finished" };
  };

  const skipWhy = contact.blocked ? "contact is blocked" : conv.paused ? "conversation is paused" : conv.excluded ? "conversation is excluded" : !contact.automation ? "automation is off for this contact" : v.skip ?? sensitiveIncoming(msg.text, s.sensitiveTerms);
  if (skipWhy) return finish("skipped", skipWhy, "skipped");

  if (s.mode === "auto") {
    const st = await getState(d);
    const last = st.lastSentAt[String(peerId)];
    if (last && s.cooldownSeconds > 0 && d.now().getTime() - Date.parse(last) < s.cooldownSeconds * 1000) return wait("waiting for the cooldown to end"); // no AI call needed yet
  }

  let draft: Draft;
  try {
    draft = await draftFor(d, conv, msg);
  } catch (e) {
    const kind = e instanceof AIError ? e.kind : "unknown";
    await patchState(d, (x) => { x.lastError = e instanceof Error ? e.message.slice(0, 200) : "AI error"; });
    const transient = kind === "rate_limit" || kind === "network" || kind === "unknown";
    let tries = 0;
    await mutateMsg(d, peerId, msgId, (m) => { tries = m.tries = (m.tries ?? 0) + 1; });
    if (transient && tries < MAX_TRIES) return wait(`AI busy, retrying (${tries}/${MAX_TRIES})`);
    return finish("failed", `AI error: ${kind}`, "failed"); // never invent a reply when the AI fails
  }
  await mutateMsg(d, peerId, msgId, (m) => { m.draft = draft; });
  if (s.mode !== "auto") {
    await mutateMsg(d, peerId, msgId, (m) => { m.status = "pending_approval"; m.reason = draft.reviewReason; m.handled = true; });
    return { kind: "finished" };
  }
  return { kind: "ready", conv, msg, contact, draft, v };
}

/** Phase 2 runs one message at a time so the daily limit and cooldown stay exact: check eligibility, then send. */
async function deliver(d: Deps, conn: Connection, p: Extract<Prepared, { kind: "ready" }>, s: Settings) {
  const { conv, msg, contact, draft, v } = p;
  const st = await getState(d);
  const day = dayKey(d.now());
  const sentToday = st.day.date === day ? st.day.sent : 0;
  const last = st.lastSentAt[String(conv.peerId)];
  const tooOld = d.now().getTime() - Date.parse(msg.at) > MAX_AUTO_AGE_MS;
  const blockers = [
    !st.autoConfirmedAt && "automatic sending not confirmed",
    draft.needsReview && (draft.reviewReason ?? "needs review"),
    v.needAllowlist && !contact.allowlisted && "contact is not on the allowlist",
    tooOld && "message is too old to answer automatically",
    v.quiet && "quiet hours",
    last && s.cooldownSeconds > 0 && d.now().getTime() - Date.parse(last) < s.cooldownSeconds * 1000 && "cooldown for this contact",
    sentToday >= v.dailyLimit && "daily limit reached",
  ].filter(Boolean) as string[];
  const settle = (status: Msg["status"], reason: string | null) => mutateMsg(d, conv.peerId, msg.id, (m) => { m.status = status; m.reason = reason; m.handled = true; });
  if (blockers.length) return settle("pending_approval", blockers[0]);
  try {
    await sendOnce(d, conn, conv, msg, draft.text, { automatic: true, mode: "auto", draft: draft.text });
  } catch (e) {
    if (e instanceof ServiceError && e.code === "already_replied") return settle("pending_approval", "a reply may already have been sent, please check");
    await patchState(d, (x) => { x.lastError = e instanceof Error ? e.message.slice(0, 200) : "send failed"; });
    return settle("failed", "send failed");
  }
}

export interface SyncResult {
  fetched: number;
  newIncoming: number;
  handled: number;
  queued: number;
}
/** startWithinMs: no new message is started after this long, so a run always ends inside the function time limit. */
export async function sync(d: Deps, o: { startWithinMs?: number } = {}): Promise<SyncResult> {
  const tg = await getTg(d);
  if (tg.status !== "connected") throw new ServiceError(409, "telegram_not_connected", "Telegram is not connected.");
  if (!(await lock(d, "sync", 45_000))) return { fetched: 0, newIncoming: 0, handled: 0, queued: 0 };
  const t0 = Date.now();
  const startWithin = o.startWithinMs ?? 13_000;
  let conn: Connection | null = null;
  try {
    conn = await openConn(d);
    const known = new Set((await listConvs(d)).map((c) => c.peerId));
    const { unread, messages } = await conn.recent({ dialogs: 60, perChat: 12, onlyUnread: true, skipKnown: known });
    const fresh = await ingest(d, messages, unread);
    const newIncoming = fresh.reduce((n, f) => n + f.fresh.length, 0);
    if (newIncoming) await bump(d, { incoming: newIncoming });

    const s = await getSettings(d);
    const st = await getState(d);
    let handled = 0;
    let queued = 0;
    if (st.running && s.mode !== "manual" && st.startedAt) {
      // the oldest waiting message goes first, so nobody is starved by a busy chat
      const waiting = (await listConvs(d))
        .map((c) => ({ c, todo: c.messages.filter((m) => m.dir === "in" && !m.handled && m.at >= st.startedAt!) }))
        .filter((x) => x.todo.length)
        .sort((a, b) => a.todo[0].at.localeCompare(b.todo[0].at));
      let chain: Promise<unknown> = Promise.resolve();
      const serial = (fn: () => Promise<unknown>) => (chain = chain.then(fn, fn));
      const next = () => (Date.now() - t0 < startWithin ? waiting.shift() : undefined);
      const worker = async () => {
        for (let item = next(); item; item = next()) {
          const latest = item.todo[item.todo.length - 1];
          for (const older of item.todo.slice(0, -1)) await mutateMsg(d, item.c.peerId, older.id, (m) => { m.status = "skipped"; m.reason = "answered together with the newest message"; m.handled = true; });
          const p = await prepare(d, item.c.peerId, latest.id, s);
          if (p.kind === "ready") await serial(() => deliver(d, conn!, p, s));
          handled++;
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      queued = waiting.length; // not reached in this run, the next check continues
    }
    await patchState(d, (x) => { x.lastPollAt = d.now().toISOString(); });
    await cleanup(d, s);
    return { fetched: messages.length, newIncoming, handled, queued };
  } catch (e) {
    await patchState(d, (x) => { x.lastError = e instanceof Error ? e.message.slice(0, 200) : "sync failed"; });
    throw e;
  } finally {
    await conn?.close();
    await unlock(d, "sync");
  }
}

async function cleanup(d: Deps, s: Settings) {
  const today = dayKey(d.now());
  const st = await getState(d);
  if (s.retentionDays <= 0 || st.lastCleanup === today) return;
  const cutoff = new Date(d.now().getTime() - s.retentionDays * 86_400_000).toISOString();
  for (const k of await d.store.list("log/")) if (k.slice(4) < cutoff) await d.store.del(k);
  await patchState(d, (x) => { x.lastCleanup = today; });
}

/** Local history only. The sent/ markers stay so already answered messages can never be answered twice. */
export async function clearHistory(d: Deps) {
  for (const prefix of ["log/", "conv/", "stat/"]) for (const k of await d.store.list(prefix)) await d.store.del(k);
}
