import { z } from "zod";

export const DEFAULT_PROMPT =
  "You write replies for the account owner in their private Telegram chats. Sound like a real person: short, warm and natural, never robotic. Answer only what was asked. If you are not sure of a fact, a price, a date or a promise, say you will check and get back, instead of guessing.";
export const DEFAULT_SENSITIVE = ["otp", "password", "cvv", "pin code", "bank account", "card number", "aadhaar", "seed phrase", "private key"];
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "use HH:MM (24 hour)");

const httpUrl = z.string().trim().url().max(300).refine((u) => /^https?:\/\//i.test(u), "use a link starting with http:// or https://");
export const BusinessSchema = z.object({
  name: z.string().trim().max(80).default(""),
  about: z.string().trim().max(1500).default(""),
  facts: z.array(z.string().trim().min(1).max(500)).max(80).default([]), // approved facts the AI may state
  links: z.array(z.object({ label: z.string().trim().min(1).max(80), url: httpUrl })).max(30).default([]),
  v: z.number().int().default(1), // version of the pre-filled defaults this copy was last merged with
});
export type Business = z.infer<typeof BusinessSchema>;

export const DEFAULT_VIDEO_LINKS = [
  { label: "API setup video (how to get and add the API keys)", url: "https://youtu.be/A_4LBZHH8nE" },
  { label: "Full setup video (complete installation and setup of MYRA / Jarvis)", url: "https://youtu.be/UZ6yWzH8aGI" },
];

// Pre-filled from the public pages of codeninjavik.in. Edit it in Settings. Anything not listed here is never stated by the AI.
export const DEFAULT_BUSINESS: Business = {
  name: "codeninjavik",
  about: "codeninjavik sells two AI voice assistants: Jarvis for Windows and MYRA for Android. Both are one-time purchases with lifetime updates and no subscription.",
  facts: [
    "MYRA for Android is a voice-first assistant for Android 8.0 or newer. It can call people by voice, send WhatsApp messages and SMS by dictation, open and control apps, read the screen and answer questions about it, and answer questions about what the camera sees (Visual Lens).",
    "MYRA lets you bring your own AI (Gemini, Groq, OpenAI, Claude, Perplexity), has Classic, Energy and Neon orb styles, remembers your preferences, understands Hindi and English, and can control a Windows PC from the phone after pairing.",
    "MYRA for Android costs Rs 999, a one-time lifetime purchase (the download page lists this price). You get an access key and the APK.",
    "Jarvis 2.0 for Windows is an AI assistant for Windows 10/11 (64-bit): voice control, task automation, system control, file manager, live web answers read aloud, code assistant, screenshot AI, media control, notes and OCR, app launcher, clipboard AI and AI memory. Its price is on the pricing page and is not known here, so send people to the pricing page instead of guessing.",
    "Source code plans exist on the pricing page: Jarvis 2.0 source, MYRA 2.0 source, and a Jarvis + MYRA bundle with a commercial license. They include Python and automation scripts, documentation and a customization guide. Prices are on the pricing page.",
    "How to buy: sign in or create an account on the website, pay once with Razorpay (UPI, cards or netbanking). The payment ID and access key appear in the dashboard. Android buyers get the access key and APK right away. For Jarvis, support confirms activation.",
    "How to install MYRA: 1) sign in on the website, 2) buy once with Razorpay, the key shows in your dashboard, 3) download the APK from the Download page and install it, 4) open the app and activate it with your access key.",
    "MYRA PC Controller is a free Windows 10/11 companion app (no login needed on the PC) that connects to MYRA on Android. If Windows SmartScreen shows a warning, click More info, then Run anyway.",
    "Each license works on one device.",
    "Refunds can be requested within 7 days of payment for: a double charge, no key or download within 24 hours, a technical problem on our side not fixed after 48 hours, cancelling a key that is not activated, or a product very different from its description. An activated key, used software and delivered source code are not refundable. To ask, email from the purchase address with the Razorpay payment ID and the reason; replies take 3 to 5 business days.",
    "Support: email codeninjavik@gmail.com or message @codeninjavik_official on Telegram. Support replies within a day.",
  ],
  links: [
    { label: "Website", url: "https://codeninjavik.in" },
    { label: "Pricing and buy", url: "https://codeninjavik.in/pricing" },
    { label: "Download and install", url: "https://codeninjavik.in/download" },
    { label: "Features", url: "https://codeninjavik.in/features" },
    { label: "Dashboard (keys and downloads)", url: "https://codeninjavik.in/dashboard" },
    { label: "Contact", url: "https://codeninjavik.in/contact" },
    { label: "Refund policy", url: "https://codeninjavik.in/refund-policy" },
    { label: "Telegram support", url: "https://t.me/codeninjavik_official" },
    ...DEFAULT_VIDEO_LINKS,
  ],
  v: 2,
};

export const SettingsSchema = z.object({
  mode: z.enum(["manual", "draft", "auto"]).default("draft"),
  model: z.string().min(2).max(80).default("openai/gpt-oss-120b"),
  maxTokens: z.number().int().min(32).max(1024).default(300),
  maxChars: z.number().int().min(40).max(4000).default(600),
  temperature: z.number().min(0).max(1.5).default(0.6),
  systemPrompt: z.string().max(4000).default(DEFAULT_PROMPT),
  language: z.enum(["auto", "english", "hindi", "hinglish"]).default("auto"),
  tone: z.enum(["friendly", "casual", "professional"]).default("friendly"),
  historyLimit: z.number().int().min(0).max(30).default(10),
  autoAllowlistOnly: z.boolean().default(true),
  cooldownSeconds: z.number().int().min(0).max(86_400).default(60),
  dailyLimit: z.number().int().min(0).max(1000).default(30),
  quietHours: z.object({ enabled: z.boolean().default(false), start: hhmm.default("22:00"), end: hhmm.default("08:00") }).default({ enabled: false, start: "22:00", end: "08:00" }),
  timezone: z
    .string()
    .default("Asia/Kolkata")
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "unknown time zone"),
  retentionDays: z.number().int().min(0).max(3650).default(90),
  business: BusinessSchema.default(DEFAULT_BUSINESS),
  sensitiveTerms: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(100).default(DEFAULT_SENSITIVE),
});
export type Settings = z.infer<typeof SettingsSchema>;
export const SettingsPatchSchema = SettingsSchema.partial().extend({ confirmAuto: z.boolean().optional() }).strict();

export type MsgStatus = "received" | "pending_approval" | "replied" | "skipped" | "failed";
export interface Draft {
  text: string;
  model: string;
  needsReview: boolean;
  reviewReason: string | null;
  ms: number;
  createdAt: string;
  status: "pending" | "sent" | "discarded";
}
export interface Msg {
  id: number; // Telegram message id
  dir: "in" | "out";
  text: string;
  at: string;
  status?: MsgStatus; // incoming only
  reason?: string | null;
  draft?: Draft | null;
  auto?: boolean;
  handled?: boolean; // the assistant has made its decision about this incoming message
  tries?: number; // AI attempts that failed for a temporary reason
}
export interface Conv {
  peerId: number;
  accessHash: string;
  title: string;
  username: string | null;
  lastAt: string | null;
  preview: string;
  unread: number;
  paused: boolean;
  excluded: boolean;
  messages: Msg[]; // oldest first, capped
}
export interface Contact {
  peerId: number;
  name: string;
  username: string | null;
  automation: boolean;
  allowlisted: boolean;
  blocked: boolean;
  language: "english" | "hindi" | "hinglish" | null;
  tone: "friendly" | "casual" | "professional" | null;
  instructions: string;
  notes: string;
  lastInteraction: string | null;
  count: number;
}
export const ContactPatchSchema = z
  .object({
    automation: z.boolean(),
    allowlisted: z.boolean(),
    blocked: z.boolean(),
    language: z.enum(["english", "hindi", "hinglish"]).nullable(),
    tone: z.enum(["friendly", "casual", "professional"]).nullable(),
    instructions: z.string().max(1500),
    notes: z.string().max(3000),
    paused: z.boolean(),
  })
  .partial()
  .strict();

export interface LogEntry {
  id: string;
  at: string;
  peerId: number;
  contact: string;
  msgId: number;
  incoming: string;
  draft: string | null;
  final: string | null;
  mode: "manual" | "draft" | "auto";
  status: "sent" | "failed" | "skipped";
  reason: string | null;
  error: string | null;
  automatic: boolean;
}

export interface AssistantState {
  running: boolean;
  startedAt: string | null;
  autoConfirmedAt: string | null;
  lastPollAt: string | null;
  lastError: string | null;
  lastSentAt: Record<string, string>;
  day: { date: string; sent: number };
  lastCleanup?: string;
}
export const initialState = (): AssistantState => ({
  running: false, startedAt: null, autoConfirmedAt: null, lastPollAt: null, lastError: null, lastSentAt: {}, day: { date: "", sent: 0 },
});

export const RuleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("approved_contacts_only"), config: z.object({}).default({}) }),
  z.object({ type: z.literal("skip_keywords"), config: z.object({ keywords: z.array(z.string().trim().toLowerCase().min(1).max(60)).min(1).max(50) }) }),
  z.object({ type: z.literal("approval_keywords"), config: z.object({ keywords: z.array(z.string().trim().toLowerCase().min(1).max(60)).min(1).max(50) }) }),
  z.object({ type: z.literal("quiet_hours"), config: z.object({ start: hhmm, end: hhmm }) }),
  z.object({ type: z.literal("daily_limit"), config: z.object({ limit: z.number().int().min(0).max(1000) }) }),
  z.object({ type: z.literal("faq"), config: z.object({ answers: z.array(z.string().trim().min(1).max(400)).min(1).max(30) }) }),
  z.object({ type: z.literal("tone"), config: z.object({ tone: z.enum(["friendly", "casual", "professional"]) }) }),
]);
export const RuleInSchema = z.intersection(RuleSchema, z.object({ name: z.string().trim().min(1).max(80), enabled: z.boolean().default(true) }));
export type RuleIn = z.infer<typeof RuleInSchema>;
export type Rule = RuleIn & { id: string; createdAt: string };

export type TgStatus = "disconnected" | "awaiting_code" | "awaiting_password" | "connected" | "error";
export interface TgMeta {
  status: TgStatus;
  accountId: number | null;
  accountName: string | null;
  username: string | null;
  phoneHint: string | null;
  connectedAt: string | null;
  lastError: string | null;
}
export const initialTg = (): TgMeta => ({ status: "disconnected", accountId: null, accountName: null, username: null, phoneHint: null, connectedAt: null, lastError: null });

export const dayKey = (d: Date, tz = "UTC") => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
