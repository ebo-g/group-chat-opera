import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { config } from './config.js';
import { parseChat, selectDramatic } from './parser.js';
import { complete } from './llm.js';

const VOICES = ['soprano', 'alto', 'tenor', 'baritone', 'bass'];
const CONFIDENCES = ['high', 'low'];
const SEXES = ['female', 'male'];
const FEMALE_VOICES = ['soprano', 'alto'];

/**
 * Every cast member gets an explicit `sex` (drives the singer's body on stage).
 * Fills it in from the voice register when missing (also for old cached librettos),
 * and keeps voice and sex consistent: sex wins if the model contradicted itself.
 */
export function normalizeCast(l) {
  for (const c of Array.isArray(l?.cast) ? l.cast : []) {
    if (!SEXES.includes(c.sex)) c.sex = FEMALE_VOICES.includes(c.voice) ? 'female' : 'male';
    const isFemaleVoice = FEMALE_VOICES.includes(c.voice);
    if (c.sex === 'female' && !isFemaleVoice) c.voice = 'alto';
    if (c.sex === 'male' && isFemaleVoice) c.voice = 'tenor';
  }
  return l;
}
const MOODS = ['tense', 'romantic', 'comic', 'tragic', 'triumphant'];
const STUB_CACHE_VERSION = 'stub-lyrics-v2';

const SYSTEM = `You are a brilliant comic-opera librettist. You rewrite group chats as comic operas.
Reply with JSON ONLY: no markdown, no code fences, no commentary.`;
const SYSTEM_RAP = `You are a rap battle lyricist who writes only in Shakespearean English. You rewrite group chats as rap battles.
Reply with JSON ONLY: no markdown, no code fences, no commentary.`;

export const GENRES = ['opera', 'rap'];

function buildRapPrompt(senders, transcript) {
  return `Rewrite this group chat as a RAP BATTLE written entirely in SHAKESPEAREAN ENGLISH (thee/thou/thy, doth, 'tis, wherefore, prithee, forsooth, knave...), but with real rap flow: punchy bars, internal rhymes, end-rhyme couplets, boasts, insults and comebacks.

People (the MCs): ${senders.join(', ')}

Requirements:
- Give each person a clear MC persona from how they behave in the chat (the boaster, the villain, the underdog, the hype man, the one who never replies...).
- Exactly 3 scenes (rounds), each with 6-10 lines, with an arc (opening cyphers, a heated exchange, a closing flex). Each "lyric" is a couplet of two rhyming bars, rhythmic and speakable, about 8-14 words.
- Quote or paraphrase REAL messages from the chat where funny, turned into Shakespearean bars.
- Keep it playful and PG-13: roast the behaviour, never attack a person's body or identity.
- Use only these people, one cast entry each. ids "c1", "c2", ... in the order given.
- "voice": one of soprano, alto, tenor, baritone, bass: pick by the person's likely sex and vocal feel (soprano/alto = female, tenor/baritone/bass = male; use the name and pronoun clues in the chat; if unsure pick alto or tenor).
- "sex": "female" or "male", consistent with the voice. "voiceConfidence": "high" if the name/pronouns make it clear, otherwise "low".
- "color": distinct #rrggbb hex.
- "mood" per scene: one of tense, romantic, comic, tragic, triumphant (it sets the beat).
- "direction" = a short stage direction (a gesture or mic move); "emotion" = one word.
- Never include phone numbers or other personal details.

Output JSON ONLY in exactly this shape:
{"title": string,
 "cast": [{"id": "c1", "name": string, "role": string, "voice": string, "sex": "female"|"male", "voiceConfidence": "high"|"low", "color": "#hex"}],
 "scenes": [{"title": string, "mood": string,
   "lines": [{"cast": "c1", "lyric": string, "direction": string, "emotion": string}]}]}

CHAT:
${transcript}`;
}

/** Returns an array of problems; empty array = valid. */
export function validateLibretto(l) {
  const errs = [];
  const str = (v) => typeof v === 'string' && v.trim().length > 0;
  if (!l || typeof l !== 'object') return ['not an object'];
  if (!str(l.title)) errs.push('title missing');
  if (!Array.isArray(l.cast) || l.cast.length < 1) errs.push('cast must be a non-empty array');
  const ids = new Set();
  for (const [i, c] of (Array.isArray(l.cast) ? l.cast : []).entries()) {
    if (!str(c?.id)) errs.push(`cast[${i}].id`);
    else ids.add(c.id);
    if (!str(c?.name)) errs.push(`cast[${i}].name`);
    if (!str(c?.role)) errs.push(`cast[${i}].role`);
    if (!VOICES.includes(c?.voice)) errs.push(`cast[${i}].voice must be one of ${VOICES}`);
    if (c?.sex !== undefined && !SEXES.includes(c.sex)) errs.push(`cast[${i}].sex must be one of ${SEXES}`);
    if (!CONFIDENCES.includes(c?.voiceConfidence)) errs.push(`cast[${i}].voiceConfidence must be one of ${CONFIDENCES}`);
    if (!/^#[0-9a-fA-F]{6}$/.test(c?.color ?? '')) errs.push(`cast[${i}].color must be #rrggbb`);
  }
  if (!Array.isArray(l.scenes) || l.scenes.length !== 3) errs.push('scenes must be an array of exactly 3');
  for (const [i, s] of (Array.isArray(l.scenes) ? l.scenes : []).entries()) {
    if (!str(s?.title)) errs.push(`scenes[${i}].title`);
    if (!MOODS.includes(s?.mood)) errs.push(`scenes[${i}].mood must be one of ${MOODS}`);
    const n = Array.isArray(s?.lines) ? s.lines.length : 0;
    if (n < 6 || n > 10) errs.push(`scenes[${i}].lines must have 6-10 lines (got ${n})`);
    for (const [j, ln] of (Array.isArray(s?.lines) ? s.lines : []).entries()) {
      if (!ids.has(ln?.cast)) errs.push(`scenes[${i}].lines[${j}].cast "${ln?.cast}" not in cast`);
      for (const k of ['lyric', 'direction', 'emotion']) {
        if (!str(ln?.[k])) errs.push(`scenes[${i}].lines[${j}].${k}`);
      }
    }
  }
  return errs;
}

function buildPrompt(senders, messages, genre = 'opera') {
  const transcript = messages.map((m) => `${m.sender}: ${m.text.replace(/\n/g, ' / ')}`).join('\n');
  if (genre === 'rap') return buildRapPrompt(senders, transcript);
  return `Rewrite this group chat as a COMIC OPERA.

People (the cast): ${senders.join(', ')}

Requirements:
- Give each person a clear operatic character (villain, tragic hero, comic relief, scheming servant, grand diva...) based on how they behave in the chat.
- Exactly 3 scenes, each with 6-10 lines, telling a coherent story with an arc (setup, crisis, resolution).
- Lyrics must RHYME (couplets), be short enough to sing, and quote real messages from the chat where funny.
- Use only these people, one cast entry each. ids "c1", "c2", ... in the order given.
- "voice": one of soprano, alto, tenor, baritone, bass. Choose it using the person's name AND clues in the chat (pronouns others use for them, e.g. "he said", "tell her"). Soprano/alto for likely female, tenor/baritone/bass for likely male. If unsure, pick alto or tenor.
- "sex": "female" or "male": the person's likely sex from their name and pronoun clues (it picks their on-stage body). It must match the voice: soprano/alto = female, tenor/baritone/bass = male.
- "voiceConfidence": "high" if the name and/or pronoun clues clearly indicate gender, otherwise "low".
- "color": distinct #rrggbb hex.
- "mood" per scene: one of tense, romantic, comic, tragic, triumphant.
- "direction" = a short stage direction; "emotion" = one word.
- Never include phone numbers or other personal details.

Output JSON ONLY in exactly this shape:
{"title": string,
 "cast": [{"id": "c1", "name": string, "role": string, "voice": string, "sex": "female"|"male", "voiceConfidence": "high"|"low", "color": "#hex"}],
 "scenes": [{"title": string, "mood": string,
   "lines": [{"cast": "c1", "lyric": string, "direction": string, "emotion": string}]}]}

CHAT:
${transcript}`;
}

function extractJson(text) {
  const t = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error('response is not JSON');
  }
}

async function generate(senders, messages, genre = 'opera') {
  const prompt = buildPrompt(senders, messages, genre);
  let user = prompt;
  let lastErr = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await complete({ system: genre === 'rap' ? SYSTEM_RAP : SYSTEM, user, senders, messages });
    try {
      const l = extractJson(raw);
      lastErr = validateLibretto(l);
      if (lastErr.length === 0) return l;
    } catch (e) {
      lastErr = [e.message];
    }
    user = `${prompt}\n\nYour previous answer was invalid: ${lastErr.slice(0, 8).join('; ')}. Fix these and output the JSON only.`;
  }
  const err = new Error('Model returned an invalid libretto: ' + lastErr.slice(0, 5).join('; '));
  err.status = 502;
  throw err;
}

/** chatText -> libretto, cached on disk by hash of the input. */
export async function makeLibretto(chatText, genre = 'rap') {
  if (!GENRES.includes(genre)) genre = 'rap'; // rap battle in Shakespearean English is the product
  const parsed = parseChat(chatText);
  if (parsed.length < 3) {
    const err = new Error('No chat messages found. Is this a WhatsApp .txt export?');
    err.status = 400;
    throw err;
  }
  const { senders, messages } = selectDramatic(parsed, {
    maxSenders: config.maxSenders,
    limit: config.maxMessages,
  });

  // Key includes provider+model so stub output never shadows real output.
  const key = createHash('sha256')
    .update(JSON.stringify([config.provider, config.provider === 'stub' ? STUB_CACHE_VERSION : config.model, senders, messages, ...(genre === 'opera' ? [] : [genre])]))
    .digest('hex');
  const file = new URL(`${key}.json`, config.cacheDir);
  try {
    return { libretto: normalizeCast(JSON.parse(await readFile(file, 'utf8'))), cached: true };
  } catch {}

  const libretto = normalizeCast(await generate(senders, messages, genre));
  libretto.genre = genre;
  await mkdir(config.cacheDir, { recursive: true });
  await writeFile(file, JSON.stringify(libretto, null, 2));
  return { libretto, cached: false };
}
