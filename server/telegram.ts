import bigInt from "big-integer";
import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

export interface Account {
  id: number;
  name: string;
  username: string | null;
}
export interface Incoming {
  peerId: number;
  accessHash: string;
  title: string;
  username: string | null;
  msgId: number;
  text: string;
  at: string;
  outgoing: boolean;
}
export type TgErrorKind = "bad_code" | "expired_code" | "bad_password" | "flood" | "bad_phone" | "auth_lost" | "network" | "unknown";
export class TgError extends Error {
  constructor(public kind: TgErrorKind, message: string, public waitSeconds?: number) {
    super(message);
  }
}
export interface Connection {
  me(): Promise<Account>;
  /** Recent private chats with their latest messages. Bots, groups, channels and service accounts are left out. */
  recent(opts: { dialogs: number; perChat: number; onlyUnread: boolean; skipKnown?: Set<number> }): Promise<{ unread: Record<number, number>; messages: Incoming[] }>;
  send(peerId: number, accessHash: string, text: string): Promise<number>;
  logOut(): Promise<void>;
  close(): Promise<void>;
}
export interface Gateway {
  sendCode(phone: string): Promise<{ session: string; phoneCodeHash: string }>;
  signIn(session: string, phone: string, phoneCodeHash: string, code: string): Promise<{ session: string; account?: Account; needPassword?: boolean }>;
  signInPassword(session: string, password: string): Promise<{ session: string; account: Account }>;
  open(session: string): Promise<Connection>;
}

function mapError(e: any): TgError {
  const m = String(e?.errorMessage ?? e?.message ?? e);
  if (/PHONE_CODE_INVALID/.test(m)) return new TgError("bad_code", "That code is not correct.");
  if (/PHONE_CODE_EXPIRED/.test(m)) return new TgError("expired_code", "That code expired. Request a new one.");
  if (/PASSWORD_HASH_INVALID/.test(m)) return new TgError("bad_password", "Two-step verification password is wrong.");
  if (/PHONE_NUMBER_INVALID|PHONE_NUMBER_BANNED/.test(m)) return new TgError("bad_phone", "Telegram did not accept that phone number.");
  if (/AUTH_KEY|SESSION_REVOKED|USER_DEACTIVATED/.test(m)) return new TgError("auth_lost", "The Telegram session is no longer valid. Connect again.");
  const flood = /FLOOD_WAIT_(\d+)|(?:A wait of )(\d+)/.exec(m);
  if (flood) return new TgError("flood", `Telegram asks you to wait ${flood[1] ?? flood[2]} seconds.`, Number(flood[1] ?? flood[2]));
  if (/ETIMEDOUT|ECONN|ENOTFOUND|timeout|Connection closed/i.test(m)) return new TgError("network", "Could not reach Telegram. Try again.");
  return new TgError("unknown", "Telegram returned an error.");
}

const displayName = (u: Api.User) => [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.username || String(u.id);
const toAccount = (u: Api.User): Account => ({ id: Number(u.id.toString()), name: displayName(u), username: u.username ?? null });

export class GramGateway implements Gateway {
  constructor(private apiId: number, private apiHash: string) {}

  private client(session: string) {
    return new TelegramClient(new StringSession(session), this.apiId, this.apiHash, { connectionRetries: 2, useWSS: false, deviceModel: "TeleMind AI", appVersion: "1.0" });
  }
  private async finish(c: TelegramClient) {
    try {
      await c.destroy();
    } catch {
      /* already closed */
    }
  }

  async sendCode(phone: string) {
    const c = this.client("");
    try {
      await c.connect();
      const r = await c.sendCode({ apiId: this.apiId, apiHash: this.apiHash }, phone);
      return { session: String(c.session.save()), phoneCodeHash: r.phoneCodeHash };
    } catch (e) {
      throw mapError(e);
    } finally {
      await this.finish(c);
    }
  }

  async signIn(session: string, phone: string, phoneCodeHash: string, code: string) {
    const c = this.client(session);
    try {
      await c.connect();
      try {
        const r = await c.invoke(new Api.auth.SignIn({ phoneNumber: phone, phoneCodeHash, phoneCode: code }));
        if (r instanceof Api.auth.AuthorizationSignUpRequired) throw new TgError("bad_phone", "This number has no Telegram account.");
        return { session: String(c.session.save()), account: toAccount((r as Api.auth.Authorization).user as Api.User) };
      } catch (e: any) {
        if (/SESSION_PASSWORD_NEEDED/.test(String(e?.errorMessage ?? e?.message))) return { session: String(c.session.save()), needPassword: true };
        throw e;
      }
    } catch (e) {
      throw e instanceof TgError ? e : mapError(e);
    } finally {
      await this.finish(c);
    }
  }

  async signInPassword(session: string, password: string) {
    const c = this.client(session);
    try {
      await c.connect();
      await c.signInWithPassword({ apiId: this.apiId, apiHash: this.apiHash }, { password: async () => password, onError: async (err) => { throw err; } });
      const me = (await c.getMe()) as Api.User;
      return { session: String(c.session.save()), account: toAccount(me) };
    } catch (e) {
      throw mapError(e);
    } finally {
      await this.finish(c);
    }
  }

  async open(session: string): Promise<Connection> {
    const c = this.client(session);
    try {
      await c.connect();
    } catch (e) {
      await this.finish(c);
      throw mapError(e);
    }
    return {
      me: async () => {
        try {
          return toAccount((await c.getMe()) as Api.User);
        } catch (e) {
          throw mapError(e);
        }
      },
      recent: async ({ dialogs, perChat, onlyUnread, skipKnown }) => {
        try {
          const list = await c.getDialogs({ limit: dialogs });
          const unread: Record<number, number> = {};
          const messages: Incoming[] = [];
          const targets: { u: Api.User; peerId: number; limit: number }[] = [];
          for (const d of list) {
            const u = d.entity;
            if (!d.isUser || !(u instanceof Api.User) || u.bot || u.self || u.deleted || u.support || u.id.toString() === "777000") continue;
            const peerId = Number(u.id.toString());
            unread[peerId] = d.unreadCount;
            if (onlyUnread && d.unreadCount === 0 && skipKnown?.has(peerId)) continue;
            targets.push({ u, peerId, limit: d.unreadCount > 0 ? Math.min(Math.max(d.unreadCount + 4, 6), 20) : perChat });
          }
          for (let i = 0; i < targets.length; i += 6) {
            // a few chats at a time over the same connection keeps a busy inbox fast
            const batch = await Promise.all(targets.slice(i, i + 6).map(async (t) => ({ t, msgs: await c.getMessages(t.u, { limit: t.limit }) })));
            for (const { t, msgs } of batch) {
              for (const m of msgs) {
                if (!(m instanceof Api.Message) || m.action) continue;
                const text = (m.message ?? "").trim();
                if (!text) continue; // media-only messages are unsupported and ignored
                messages.push({
                  peerId: t.peerId, accessHash: (t.u.accessHash ?? bigInt.zero).toString(), title: displayName(t.u), username: t.u.username ?? null,
                  msgId: m.id, text, at: new Date(m.date * 1000).toISOString(), outgoing: !!m.out,
                });
              }
            }
          }
          return { unread, messages };
        } catch (e) {
          throw mapError(e);
        }
      },
      send: async (peerId, accessHash, text) => {
        try {
          const peer = new Api.InputPeerUser({ userId: bigInt(peerId), accessHash: bigInt(accessHash) });
          const m = await c.sendMessage(peer, { message: text });
          return m.id;
        } catch (e) {
          throw mapError(e);
        }
      },
      logOut: async () => {
        try {
          await c.invoke(new Api.auth.LogOut());
        } catch {
          /* revoking is best effort */
        }
      },
      close: () => this.finish(c),
    };
  }
}
