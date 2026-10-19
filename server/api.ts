import { z } from "zod";
import { AIError, splitKeys } from "./ai";
import { mask, randomToken, safeEqual, sign } from "./crypto";
import * as svc from "./service";
import { ServiceError, type Deps } from "./service";
import { ContactPatchSchema, RuleInSchema, SettingsPatchSchema } from "./types";

const COOKIE = "tm_session";
const SESSION_DAYS = 7;
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", ...headers },
  });
const fail = (status: number, code: string, message: string, headers?: Record<string, string>) => json({ error: { code, message } }, status, headers);

// ---------------------------------------------------------------- session cookie (stateless, signed)
function readCookie(req: Request): string | null {
  const raw = req.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return v.join("=");
  }
  return null;
}
function parseSession(d: Deps, token: string | null): { csrf: string } | null {
  if (!token || !d.env.appSecret) return null;
  const [exp, csrf, sig] = token.split(".");
  if (!exp || !csrf || !sig) return null;
  if (!safeEqual(sig, sign(`${exp}.${csrf}`, d.env.appSecret))) return null;
  if (Number(exp) < d.now().getTime()) return null;
  return { csrf };
}
function makeSession(d: Deps) {
  const exp = d.now().getTime() + SESSION_DAYS * 86_400_000;
  const csrf = randomToken(18);
  return { token: `${exp}.${csrf}.${sign(`${exp}.${csrf}`, d.env.appSecret!)}`, csrf };
}
const cookieHeader = (req: Request, value: string, maxAge: number) =>
  `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${new URL(req.url).protocol === "https:" ? "; Secure" : ""}`;

async function readBody<T extends z.ZodTypeAny>(req: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown = {};
  const text = await req.text();
  if (text.length > 64_000) throw new ServiceError(413, "too_large", "Request body is too large.");
  if (text) {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new ServiceError(400, "bad_json", "Request body is not valid JSON.");
    }
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new ServiceError(400, "invalid", r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ").slice(0, 300));
  return r.data;
}

// ---------------------------------------------------------------- login throttling
async function loginGuard(d: Deps) {
  const rec = await d.store.get<{ fails: number; until: number }>("login/fails");
  if (rec && rec.until > d.now().getTime()) throw new ServiceError(429, "locked", `Too many wrong passwords. Try again in ${Math.ceil((rec.until - d.now().getTime()) / 60000)} min.`);
}
async function loginFailed(d: Deps) {
  const now = d.now().getTime();
  await d.store.update<{ fails: number; until: number; last: number }>("login/fails", (cur) => {
    const fails = (cur && cur.last + 3_600_000 > now ? cur.fails : 0) + 1; // failures older than an hour are forgotten
    return { fails, last: now, until: fails >= 5 ? now + 5 * 60_000 : 0 };
  });
}

const num = (s: string) => {
  const n = Number(s);
  if (!Number.isSafeInteger(n)) throw new ServiceError(400, "invalid", "Bad id.");
  return n;
};

const toConversationOut = async (d: Deps, c: Awaited<ReturnType<typeof svc.listConvs>>[number], contacts: Map<number, Awaited<ReturnType<typeof svc.listContacts>>[number]>) => ({
  peerId: c.peerId, title: c.title, username: c.username, lastAt: c.lastAt, preview: c.preview, unread: c.unread, paused: c.paused, excluded: c.excluded,
  blocked: contacts.get(c.peerId)?.blocked ?? false, allowlisted: contacts.get(c.peerId)?.allowlisted ?? false,
  pending: c.messages.filter((m) => m.dir === "in" && m.status === "pending_approval").length,
  needsAttention: c.messages.filter((m) => m.dir === "in" && (m.status === "pending_approval" || m.status === "failed")).length,
});

export async function handle(req: Request, d: Deps): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");
  const method = req.method;
  try {
    if (path === "/api/health") return json({ ok: true, time: d.now().toISOString() });

    const configured = { password: !!d.env.adminPassword, secret: !!d.env.appSecret && d.env.appSecret.length >= 16, telegram: !!(d.env.tgApiId && d.env.tgApiHash), ai: !!d.env.groqKey };
    const session = parseSession(d, readCookie(req));

    if (path === "/api/session" && method === "GET") return json({ authenticated: !!session, csrf: session?.csrf ?? null, configured });

    if (path === "/api/login" && method === "POST") {
      if (!configured.password || !configured.secret) return fail(503, "not_configured", "Set ADMIN_PASSWORD and APP_SECRET (16+ characters) in the site environment variables.");
      const origin = req.headers.get("origin");
      if (origin && origin !== url.origin) return fail(403, "bad_origin", "Cross-site request blocked.");
      await loginGuard(d);
      const { password } = await readBody(req, z.object({ password: z.string().min(1).max(200) }));
      if (!safeEqual(password, d.env.adminPassword!)) {
        await loginFailed(d);
        return fail(401, "bad_password", "Wrong password.");
      }
      await d.store.del("login/fails");
      const s = makeSession(d);
      return json({ authenticated: true, csrf: s.csrf, configured }, 200, { "set-cookie": cookieHeader(req, s.token, SESSION_DAYS * 86_400) });
    }
    if (path === "/api/logout" && method === "POST") return json({ ok: true }, 200, { "set-cookie": cookieHeader(req, "", 0) });

    // everything below needs a session
    if (!session) return fail(401, "no_session", "Please sign in.");
    if (!SAFE.has(method)) {
      const origin = req.headers.get("origin");
      if (origin && origin !== url.origin) return fail(403, "bad_origin", "Cross-site request blocked.");
      const header = req.headers.get("x-csrf-token");
      if (!header || !safeEqual(header, session.csrf)) return fail(403, "csrf", "Missing or invalid CSRF token. Reload the page.");
    }

    let m: RegExpMatchArray | null;

    // ---- dashboard
    if (path === "/api/dashboard/stats" && method === "GET") {
      const [tg, st, s] = await Promise.all([svc.getTg(d), svc.getState(d), svc.getSettings(d)]);
      const days = await svc.statsRange(d, 30);
      const sum = (k: keyof (typeof days)[number]["s"]) => days.reduce((n, x) => n + x.s[k], 0);
      const today = days[days.length - 1].s;
      const convs = await svc.listConvs(d);
      return json({
        incoming: sum("incoming"), drafts: sum("drafts"), sentAuto: sum("sentAuto"), sentManual: sum("sentManual"), skipped: sum("skipped"), aiFailed: sum("aiFailed"),
        today: { incoming: today.incoming, sent: today.sentAuto + today.sentManual },
        awaiting: convs.reduce((n, c) => n + c.messages.filter((x) => x.dir === "in" && x.status === "pending_approval").length, 0),
        telegram: tg.status, aiConfigured: configured.ai, running: st.running, mode: s.mode, lastPollAt: st.lastPollAt, lastError: st.lastError, sentToday: st.day.sent,
        autoConfirmed: !!st.autoConfirmedAt,
      });
    }

    // ---- telegram
    if (path === "/api/telegram/status" && method === "GET") return json({ ...(await svc.getTg(d)), apiConfigured: configured.telegram });
    if (path === "/api/telegram/request-code" && method === "POST") {
      const { phone } = await readBody(req, z.object({ phone: z.string().regex(/^\+\d{7,15}$/, "use international format, e.g. +919876543210") }));
      return json(await svc.requestCode(d, phone));
    }
    if (path === "/api/telegram/verify-code" && method === "POST") {
      const body = await readBody(req, z.object({ code: z.string().regex(/^\d{4,8}$/).optional(), password: z.string().min(1).max(256).optional() }));
      return json(await svc.verifyCode(d, body));
    }
    if (path === "/api/telegram/disconnect" && method === "POST") {
      const { revoke } = await readBody(req, z.object({ revoke: z.boolean().default(false) }));
      return json(await svc.disconnectTg(d, revoke));
    }
    if (path === "/api/sync" && method === "POST") return json(await svc.sync(d, { startWithinMs: 3500 })); // a manual check must end inside the 10 s function limit

    // ---- conversations & messages
    if (path === "/api/conversations" && method === "GET") {
      const contacts = new Map((await svc.listContacts(d)).map((c) => [c.peerId, c]));
      return json(await Promise.all((await svc.listConvs(d)).map((c) => toConversationOut(d, c, contacts))));
    }
    if ((m = path.match(/^\/api\/conversations\/(-?\d+)$/))) {
      const peer = num(m[1]);
      if (method === "GET") {
        const c = await svc.getConv(d, peer);
        if (!c) return fail(404, "not_found", "Conversation not found.");
        return json({ ...c, contact: await svc.getContact(d, peer) });
      }
      if (method === "PATCH") {
        const patch = await readBody(req, z.object({ paused: z.boolean().optional(), excluded: z.boolean().optional() }).strict());
        return json(await svc.patchConv(d, peer, patch));
      }
    }
    if ((m = path.match(/^\/api\/messages\/(-?\d+)\/(\d+)\/(generate-draft|approve|skip)$/)) && method === "POST") {
      const [peer, id] = [num(m[1]), num(m[2])];
      if (m[3] === "generate-draft") {
        const { tone } = await readBody(req, z.object({ tone: z.enum(["friendly", "casual", "professional"]).optional() }));
        return json(await svc.generateDraft(d, peer, id, tone));
      }
      if (m[3] === "approve") {
        const { text } = await readBody(req, z.object({ text: z.string().min(1).max(4000).optional() }));
        return json(await svc.approve(d, peer, id, text));
      }
      return json(await svc.skip(d, peer, id));
    }
    if (path === "/api/studio" && method === "POST") {
      const b = await readBody(req, z.object({ sample: z.string().min(1).max(1000), contactName: z.string().max(60).default("Friend"), tone: z.enum(["friendly", "casual", "professional"]).optional() }));
      try {
        return json(await svc.studio(d, b.sample, b.contactName, b.tone));
      } catch (e) {
        if (e instanceof AIError) throw new ServiceError(e.kind === "rate_limit" ? 429 : e.kind === "auth" || e.kind === "not_configured" ? 409 : 502, `ai_${e.kind}`, e.message);
        throw e;
      }
    }

    // ---- contacts
    if (path === "/api/contacts" && method === "GET") {
      const convs = new Map((await svc.listConvs(d)).map((c) => [c.peerId, c]));
      return json((await svc.listContacts(d)).map((c) => ({ ...c, paused: convs.get(c.peerId)?.paused ?? false })));
    }
    if ((m = path.match(/^\/api\/contacts\/(-?\d+)$/)) && method === "PATCH") {
      return json(await svc.patchContact(d, num(m[1]), await readBody(req, ContactPatchSchema)));
    }

    // ---- settings & AI
    if (path === "/api/settings" && method === "GET") {
      const st = await svc.getState(d);
      return json({ settings: await svc.getSettings(d), autoConfirmed: !!st.autoConfirmedAt, ai: { configured: configured.ai, keyHint: mask(splitKeys(d.env.groqKey ?? "")[0]), keyCount: splitKeys(d.env.groqKey ?? "").length }, telegram: { configured: configured.telegram } });
    }
    if (path === "/api/settings" && method === "PATCH") {
      const sent = (await req.clone().json().catch(() => ({}))) as Record<string, unknown>;
      const parsed = await readBody(req, SettingsPatchSchema);
      // the schema fills defaults for missing keys; only what the client actually sent may change
      const patch = Object.fromEntries(Object.entries(parsed).filter(([k]) => k in sent));
      const settings = await svc.saveSettings(d, patch);
      return json({ settings, autoConfirmed: !!(await svc.getState(d)).autoConfirmedAt });
    }
    if (path === "/api/ai/models" && method === "GET") {
      const ai = d.ai();
      if (!ai) return fail(409, "ai_not_configured", "Set GROQ_API_KEY in the site environment variables first.");
      try {
        return json({ models: await ai.listModels() });
      } catch (e) {
        if (e instanceof AIError) return fail(409, `ai_${e.kind}`, e.message);
        throw e;
      }
    }
    if (path === "/api/ai/test" && method === "POST") {
      const ai = d.ai();
      if (!ai) return json({ ok: false, errorKind: "not_configured", message: "GROQ_API_KEY is not set." });
      const s = await svc.getSettings(d);
      try {
        const r = await ai.generate("Reply with the single word: ok", [{ role: "user", content: "ping" }], { model: s.model, temperature: 0, maxTokens: 64 });
        return json({ ok: true, model: r.model, latencyMs: r.ms, message: "The AI provider answered." });
      } catch (e) {
        if (e instanceof AIError) return json({ ok: false, model: s.model, errorKind: e.kind, message: e.message });
        throw e;
      }
    }

    // ---- assistant
    if (path === "/api/assistant" && method === "GET") return json(await svc.getState(d));
    if (path === "/api/assistant/start" && method === "POST") return json(await svc.startAssistant(d));
    if (path === "/api/assistant/stop" && method === "POST") return json(await svc.stopAssistant(d));
    if (path === "/api/assistant/emergency-stop" && method === "POST") return json(await svc.stopAssistant(d, true));

    // ---- history & analytics
    if (path === "/api/history" && method === "GET") {
      const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
      return json(await svc.listLog(d, page, 25));
    }
    if (path === "/api/history" && method === "DELETE") {
      await svc.clearHistory(d);
      return json({ ok: true });
    }
    if (path === "/api/analytics" && method === "GET") {
      const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 14));
      const pts = await svc.statsRange(d, days);
      const sum = (k: keyof (typeof pts)[number]["s"]) => pts.reduce((n, x) => n + x.s[k], 0);
      return json({
        points: pts.map((p) => ({ day: p.day, incoming: p.s.incoming, drafts: p.s.drafts, sentAuto: p.s.sentAuto, sentManual: p.s.sentManual, skipped: p.s.skipped, aiFailed: p.s.aiFailed })),
        totals: { incoming: sum("incoming"), drafts: sum("drafts"), sentAuto: sum("sentAuto"), sentManual: sum("sentManual"), skipped: sum("skipped"), aiFailed: sum("aiFailed") },
        avgGenerationMs: sum("aiOk") ? Math.round(sum("aiMs") / sum("aiOk")) : null,
      });
    }

    // ---- rules
    if (path === "/api/rules" && method === "GET") return json(await svc.listRules(d));
    if (path === "/api/rules" && method === "POST") {
      const input = await readBody(req, RuleInSchema);
      const rules = await svc.listRules(d);
      if (rules.length >= 40) throw new ServiceError(400, "too_many", "Rule limit reached.");
      const rule = { ...input, id: svc.newRuleId(), createdAt: d.now().toISOString() };
      await svc.saveRules(d, [...rules, rule]);
      return json(rule, 201);
    }
    if ((m = path.match(/^\/api\/rules\/([\w-]+)$/))) {
      const rules = await svc.listRules(d);
      const i = rules.findIndex((r) => r.id === m![1]);
      if (i < 0) return fail(404, "not_found", "Rule not found.");
      if (method === "DELETE") {
        await svc.saveRules(d, rules.filter((_, j) => j !== i));
        return json({ ok: true });
      }
      if (method === "PATCH") {
        const { enabled } = await readBody(req, z.object({ enabled: z.boolean() }).strict());
        rules[i] = { ...rules[i], enabled };
        await svc.saveRules(d, rules);
        return json(rules[i]);
      }
    }

    return fail(404, "not_found", "Unknown endpoint.");
  } catch (e) {
    if (e instanceof ServiceError) return fail(e.status, e.code, e.message);
    console.error("api error:", e instanceof Error ? e.name : "unknown"); // never log message bodies or credentials
    return fail(500, "internal", "Something went wrong on the server.");
  }
}
