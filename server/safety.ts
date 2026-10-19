// Heuristics that keep sensitive data and manipulation attempts away from automatic replies.
const CARD = /\b(?:\d[ -]?){13,19}\b/g;
const OTP = /\b(?:otp|one[- ]time|verification code|login code|security code|pin)\b[^\n]{0,30}?\b\d{4,8}\b/i;
const KEY = /(gsk_[A-Za-z0-9]{10,}|sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b[a-f0-9]{32}\b)/i;
const SECRETWORD = /\b(password|passcode|cvv|seed phrase|private key|api[_ ]?key|secret key)\b\s*(?:is|=|:)\s*\S+/i;
const INJECTION =
  /(ignore (?:all |any |the )?(?:previous|above|prior) (?:instructions|rules|prompts)|disregard (?:your|the) (?:instructions|rules)|system prompt|reveal (?:your|the) (?:prompt|instructions|key|secret)|you are now |act as (?:an? )?(?:admin|developer|root)|jailbreak|developer mode|print (?:your )?(?:api|secret) ?key)/i;

function luhn(d: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = +d[i];
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function hasCardNumber(text: string): boolean {
  for (const m of text.matchAll(CARD)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) return true;
  }
  return false;
}

const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Why an incoming message must not be handled automatically, or null. */
export function sensitiveIncoming(text: string, terms: string[]): string | null {
  const low = text.toLowerCase();
  for (const t of terms) {
    if (t && new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRx(t)}(?![\\p{L}\\p{N}_])`, "u").test(low)) return `sensitive term: ${t}`;
  }
  if (hasCardNumber(text)) return "contains a card number";
  if (OTP.test(text)) return "contains a one-time code";
  if (KEY.test(text) || SECRETWORD.test(text)) return "contains a secret";
  return null;
}

/** Why a generated reply must not be sent automatically, or null. */
export function sensitiveReply(text: string): string | null {
  if (hasCardNumber(text)) return "reply contains a card number";
  if (OTP.test(text)) return "reply contains a one-time code";
  if (KEY.test(text) || SECRETWORD.test(text)) return "reply contains a secret";
  return null;
}

export const injectionSignals = (text: string) => INJECTION.test(text);
