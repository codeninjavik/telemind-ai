# TeleMind on Termux (24/7)

`telemind_termux.py` is a single Python file. It signs in to **your own** Telegram account, reads new private messages the moment they arrive, and answers with Groq: as drafts you approve, or automatically if you allow it. Only connect an account you own or are authorized to manage.

Install Termux from **F-Droid** (the Play Store build is outdated).

## 1. Install

```bash
pkg update && pkg upgrade -y
pkg install python git -y
pip install telethon
termux-setup-storage          # optional
```

Copy `telemind_termux.py` to the phone (for example `~/telemind/`) and `cd` into it.

## 2. First time setup

```bash
python telemind_termux.py setup
```

It asks for:
- **API ID and API hash** from <https://my.telegram.org> → API development tools
- **Groq key(s)** from <https://console.groq.com/keys> (several keys separated by commas are rotated automatically)
- your phone number, the login code Telegram sends to your Telegram app, and your two-step password if you have one

Everything is saved in `~/.telemind` (files are `chmod 600`). Keys, hashes, codes and phone numbers are never printed or logged.

## 3. Your products and settings

```bash
python telemind_termux.py menu
```

Add products (name, price, details, links such as a setup video), business info, mode, who may get automatic replies, limits, quiet hours, language and tone, skip and review words. The assistant only states product details from this list; anything missing becomes "I will check". It talks about the business only when someone asks.

## 4. Run

```bash
python telemind_termux.py run
```

Start in **draft** mode. Each message that needs a decision shows up in your Telegram **Saved Messages** as a card with the draft. Reply to the card with `/send`, `/send your own text`, or `/skip`.

**Your own personality:** tell the assistant who you are and how you talk, for example `/persona Main friendly hu, chhote Hinglish messages likhta hu, emoji kam.` (also option 8 in `menu`; `/persona clear` removes it). It writes in that voice but never invents facts and never breaks the safety rules.

**Your bio and links:** `/bio Main Vikash hu, Gujarat se, AI tools banata hu.` (the assistant says only this about you), `/link Instagram | https://instagram.com/you`, `/links`, `/unlink 1`. They are also in `menu` option 2. Links are shared only when they answer what someone asked, and never any link that is not on your list.

Commands (type them in Saved Messages): `/help`, `/status`, `/persona`, `/bio`, `/links`, `/link`, `/unlink`, `/on`, `/off`, `/mode draft`, `/mode auto confirm`, `/who allowed`, `/who all confirm`, `/allow @user`, `/block @user`, `/pause @user`, `/limit 100`, `/cooldown 30`, `/quiet 22:00-08:00`, `/products`, `/stop` (emergency: off, back to draft).

If you reply to someone yourself, the assistant stays out of that message.

## 5. Keep it running 24/7

Android kills background apps, so do all of these:

1. In Android settings, set battery for **Termux** to *Unrestricted / Don't optimize*, and lock Termux in the recent apps list.
2. Hold the wake lock (the script also tries it): `termux-wake-lock`
3. Run it in a session that survives closing the window:

```bash
pkg install tmux -y
tmux new -s telemind
python telemind_termux.py run
# detach with Ctrl+b then d; come back with: tmux attach -t telemind
```

4. Optional, start after a reboot: install **Termux:Boot** (F-Droid), open it once, then create `~/.termux/boot/telemind.sh`:

```bash
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
cd ~/telemind
tmux new-session -d -s telemind "python telemind_termux.py run"
```

then `chmod +x ~/.termux/boot/telemind.sh`.

The script reconnects by itself after network drops. Logs: `~/.telemind/telemind.log`.

After changing settings in `menu`, restart the process (Ctrl+C, then `run` again). Changes made from Saved Messages apply at once.

## Before you use or share it

- Use **your own account** and your **own** Telegram API ID/hash and Groq key. Never give them to anyone, and never paste them into a chat.
- It is an unofficial tool, not made by Telegram. Automating your own account is at your own risk: too many automatic messages can get an account limited. Keep the daily limit low and start in draft mode.
- Messages (and the text of photos) that need an answer are sent to Groq to write the reply. Do not use it for chats that must stay private.
- Automatic replies go out in your name and people will believe you wrote them. Turn on automatic mode only after the drafts have been good for a few days.
- You can end the login any time in Telegram: Settings, Devices, "TeleMind Termux".

## What it will not do

It ignores groups, channels, bots and messages without text. It never invents a reply when the AI fails (you get a note instead), answers each message once, holds one-time codes, card numbers and secrets for you, and does no bulk messaging. Automatic mode needs `/mode auto confirm` (or the confirmation in the menu).

## Tests

```bash
python -m unittest test_telemind_termux -v
```

The tests use a fake Telegram and a fake AI. Real Telegram login and sending were not tested by the author: try it in draft mode first.
