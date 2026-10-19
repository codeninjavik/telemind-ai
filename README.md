# TeleMind AI

An AI assistant for the replies in your own private Telegram chats. It runs on **Netlify** (React + TypeScript dashboard, Netlify Functions, Netlify Blobs) and uses the **Groq** API to write replies.

> Only connect a Telegram account that you own or are authorized to manage.

## Status: what is and is not tested

| Part | Tested |
| --- | --- |
| API, auth, CSRF, rules, safety checks, draft/approve/auto flows, send-once guarantee | Yes, 30 automated tests with a fake Telegram and a fake AI (`npm test`) |
| Dashboard UI: sign-in, navigation, settings, automatic-mode warning | Yes, in a browser against `netlify dev` |
| **Real Telegram login, reading and sending messages (GramJS)** | **No. Needs your account and API credentials. Try it in AI draft mode first.** |
| **Real Groq replies** | **No. Needs your Groq key.** |

## How it works on Netlify

Netlify Functions cannot keep a live Telegram connection open, so there are no WebSockets or instant replies here:

- While the assistant is **on**, a scheduled function checks Telegram **once a minute**, stores new private messages, drafts replies and (only if you allow it) sends them.
- The dashboard refreshes itself every few seconds.
- Your Telegram session is stored **encrypted** (AES-256-GCM, key derived from `APP_SECRET`) in Netlify Blobs and is never sent to the browser.

If you need instant replies, this design is the wrong one: a small always-on server is required for that.

## Setup

1. Get Telegram API credentials at <https://my.telegram.org> (API development tools). You get an `api_id` and an `api_hash`.
2. Get a Groq key at <https://console.groq.com/keys>.
3. Create the site and set the variables (never commit them):

   ```bash
   npm install
   npx netlify init            # or: npx netlify sites:create
   npx netlify env:set ADMIN_PASSWORD "a long password"
   npx netlify env:set APP_SECRET "32+ random characters"
   npx netlify env:set TG_API_ID "123456"
   npx netlify env:set TG_API_HASH "..."
   npx netlify env:set GROQ_API_KEY "gsk_..."
   npx netlify deploy --prod --build
   ```

   See `.env.example`. The browser never receives `TG_API_HASH`, `GROQ_API_KEY` or the session; only a masked hint of the Groq key is shown.
4. Open the site, sign in, go to **Telegram**, enter your phone number, then the code Telegram sends to your other device (and your two-step password if you set one).
5. In **Settings** pick a model and press **Test the connection**. Use **Reply Studio** to try the personality on made-up messages.
6. Press **Start assistant**. Start with **AI draft** mode and check the drafts in **Inbox**.

### Run it locally

```bash
npm run dev     # builds, then serves the site and functions at http://localhost:8888
npm test        # automated tests
```

For local runs put the variables in a `.env` file (git-ignored).

## Modes

- **Manual:** the AI is never called. You write replies in the Inbox.
- **AI draft:** a draft is written for each new message; you edit and approve it.
- **Automatic:** replies are sent without asking. Turning it on shows a warning and needs your explicit confirmation. A red bar stays on screen while it is active and **Emergency stop** switches it off immediately.

Automatic replies are held back for your review when any of these is true: the contact is not allowlisted (default), the message or reply looks sensitive (one-time codes, card numbers, keys, your sensitive words), the message tries to instruct the AI, the AI asks for review, quiet hours, the per-contact cooldown, the daily limit, or a rule says so. The assistant ignores your own messages, bots, groups, channels and non-text messages, answers only the newest of several unanswered messages, sends at most one reply per incoming message, and **never invents a reply when the AI fails**. It does not do bulk messaging.

## Security notes

- The dashboard is on the public internet, so it has a password (`ADMIN_PASSWORD`), a signed HttpOnly `SameSite=Strict` session cookie, a CSRF header on every change, Origin checks, and a lockout after 5 wrong passwords.
- Incoming messages are treated as untrusted: they are quoted inside tags and the model is told never to follow instructions found in them.
- Login codes and passwords are used once and are never stored or logged.
- Use a long `ADMIN_PASSWORD`. Anyone who gets into the dashboard can use your account through the assistant.

## Troubleshooting

- **"The server is not set up yet"** on the sign-in page: `ADMIN_PASSWORD` or `APP_SECRET` is missing or shorter than 16 characters. Set it and redeploy.
- **Code never arrives:** Telegram sends it to your other logged-in Telegram app, not always by SMS.
- **"Telegram asks you to wait N seconds":** you requested too many codes. Wait.
- **Session no longer valid:** the session was revoked in Telegram. Connect again.
- **Groq rate limit or model error:** choose another model in Settings.
- **Nothing happens while the assistant is on:** scheduled functions only run on the published deploy, not on deploy previews.

## Desktop app (optional)

Not included. If you want a Windows app later, wrap the built `dist/` in Electron and point it at your Netlify site.
