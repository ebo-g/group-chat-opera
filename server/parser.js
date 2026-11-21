// WhatsApp .txt export parser + selection of the "most dramatic" stretch.

const DATE = String.raw`\d{1,2}[/.]\d{1,2}[/.]\d{2,4}`;
const TIME = String.raw`\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp]\.?[Mm]\.?)?`;
// Android: "DD/MM/YYYY, HH:MM - rest"
const ANDROID = new RegExp(`^(${DATE}),?\\s+(${TIME})\\s+-\\s+(.*)$`);
// iOS: "[DD/MM/YYYY, HH:MM:SS] rest"
const IOS = new RegExp(`^\\[(${DATE}),?\\s+(${TIME})\\]\\s+(.*)$`);

const SYSTEM_TEXT =
  /(end-to-end encrypted|created group|added you|^you were added|joined using|joined via|\bleft$|\bremoved\b|changed the (subject|group|this group|icon|description)|changed their phone number|security code changed|messages and calls|deleted this group|pinned a message|^you're now an admin|is now an admin)/i;
const MEDIA = /^(<media omitted>|<attached:.*>|\S*(image|video|audio|sticker|gif|document|contact card) omitted|\(file attached\)|this message was deleted|you deleted this message|missed (voice|video) call|null)$/i;

const INVISIBLE = /[‎‏‪-‮  ﻿]/g;
const PHONE = /\+?\d[\d\s\-().]{7,}\d/g;

export function stripPhones(s) {
  return s.replace(PHONE, '').replace(/\s{2,}/g, ' ').trim();
}

// "Name: message" -> {sender, text}, or null for system lines (no sender).
function splitSender(rest) {
  const m = rest.match(/^([^:]{1,60}?):\s?([\s\S]*)$/);
  if (!m) return null;
  if (SYSTEM_TEXT.test(rest)) return null;
  return { sender: m[1].trim(), text: m[2] };
}

/** Parse an export into [{sender, text}] (chronological). */
export function parseChat(raw) {
  const lines = raw.replace(INVISIBLE, ' ').replace(/\r\n?/g, '\n').split('\n');
  const msgs = [];
  let cur = null;
  const flush = () => {
    if (cur) msgs.push(cur);
    cur = null;
  };

  for (const line of lines) {
    const m = line.match(ANDROID) || line.match(IOS);
    if (m) {
      flush();
      const rest = m[3];
      const parsed = splitSender(rest);
      if (parsed) cur = { sender: parsed.sender, text: parsed.text };
      // system line: cur stays null, so continuation lines are dropped too
    } else if (cur) {
      cur.text += '\n' + line; // multi-line message continuation
    }
  }
  flush();

  const out = [];
  for (const m of msgs) {
    const text = stripPhones(m.text.trim());
    if (!text || MEDIA.test(text)) continue;
    let sender = m.sender.replace(/^~\s*/, '');
    // senders that are just phone numbers -> anonymise
    if (/^\+?[\d\s\-().]{7,}$/.test(sender)) sender = 'Mystery Guest';
    out.push({ sender, text });
  }
  return out;
}

/** Keep the N most active senders and (up to) `limit` messages from the most dramatic stretch. */
export function selectDramatic(messages, { maxSenders = 5, limit = 120 } = {}) {
  const counts = new Map();
  for (const m of messages) counts.set(m.sender, (counts.get(m.sender) || 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxSenders).map(([n]) => n);
  const keep = new Set(top);
  const kept = messages.filter((m) => keep.has(m.sender));
  if (kept.length <= limit) return { senders: top, messages: kept };

  const scores = kept.map(drama);
  let sum = scores.slice(0, limit).reduce((a, b) => a + b, 0);
  let best = sum;
  let bestStart = 0;
  for (let i = limit; i < kept.length; i++) {
    sum += scores[i] - scores[i - limit];
    if (sum > best) {
      best = sum;
      bestStart = i - limit + 1;
    }
  }
  return { senders: top, messages: kept.slice(bestStart, bestStart + limit) };
}

function drama(m) {
  const t = m.text;
  const excl = (t.match(/!/g) || []).length;
  const ques = (t.match(/\?/g) || []).length;
  const caps = (t.match(/\b[A-Z]{3,}\b/g) || []).length;
  const emoji = (t.match(/\p{Extended_Pictographic}/gu) || []).length;
  const stretch = (t.match(/(.)\1{3,}/g) || []).length; // "nooooo"
  const len = Math.min(t.length, 200) / 100;
  return Math.min(excl, 5) + Math.min(ques, 3) * 0.5 + caps * 1.5 + Math.min(emoji, 4) * 0.7 + stretch * 1.5 + len;
}
