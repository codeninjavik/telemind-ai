import { GroqProvider } from "./ai";
import type { Deps, Env } from "./service";
import { BlobStore } from "./store";
import { GramGateway } from "./telegram";

export function readEnv(e: Record<string, string | undefined> = process.env): Env {
  const id = Number(e.TG_API_ID);
  return {
    adminPassword: e.ADMIN_PASSWORD || undefined,
    appSecret: e.APP_SECRET || undefined,
    tgApiId: Number.isSafeInteger(id) && id > 0 ? id : undefined,
    tgApiHash: e.TG_API_HASH || undefined,
    groqKey: e.GROQ_API_KEY || undefined,
  };
}

export function liveDeps(): Deps {
  const env = readEnv();
  return {
    store: new BlobStore(),
    env,
    gateway: () => (env.tgApiId && env.tgApiHash ? new GramGateway(env.tgApiId, env.tgApiHash) : null),
    ai: () => (env.groqKey ? new GroqProvider(env.groqKey) : null),
    now: () => new Date(),
  };
}
