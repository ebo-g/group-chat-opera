import OpenAI from 'openai';
import { config } from './config.js';

/** Returns the raw text the model produced for {system, user}. */
export async function complete({ system, user, senders, messages }) {
  if (config.provider === 'snowflake') return snowflake(system, user);
  return stub(senders, messages);
}

let client;
async function snowflake(system, user) {
  const { SNOWFLAKE_PAT, SNOWFLAKE_ACCOUNT_URL } = process.env;
  if (!SNOWFLAKE_PAT || !SNOWFLAKE_ACCOUNT_URL) {
    throw new Error('SNOWFLAKE_PAT / SNOWFLAKE_ACCOUNT_URL missing in server/.env');
  }
  client ??= new OpenAI({
    apiKey: SNOWFLAKE_PAT,
    baseURL: SNOWFLAKE_ACCOUNT_URL + '/api/v2/cortex/v1',
  });
  const r = await client.chat.completions.create({
    model: config.model,
    temperature: 0.8,
    max_tokens: 6000,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  return r.choices[0].message.content;
}

// ---- Offline stub: builds a plausible libretto straight from the chat. ----
const VOICES = ['soprano', 'tenor', 'baritone', 'alto', 'bass'];
const COLORS = ['#e63946', '#457b9d', '#f4a261', '#2a9d8f', '#9b5de5'];
const ROLES = ['The Tragic Hero', 'The Villain', 'The Comic Relief', 'The Diva', 'The Wise Fool'];
const MOODS = ['comic', 'tense', 'tragic'];
const EMOTIONS = ['indignant', 'scheming', 'woeful', 'gleeful', 'panicked', 'defiant'];

function stub(senders, messages) {
  const cast = senders.map((name, i) => ({
    id: `c${i + 1}`,
    name,
    role: ROLES[i % ROLES.length],
    voice: VOICES[i % VOICES.length],
    color: COLORS[i % COLORS.length],
  }));
  const idOf = new Map(cast.map((c) => [c.name, c.id]));
  const per = Math.max(6, Math.min(10, Math.floor(messages.length / 3)));
  const scenes = [0, 1, 2].map((s) => {
    const chunk = messages.slice(Math.floor((messages.length * s) / 3)).slice(0, per);
    const lines = chunk.map((m, i) => ({
      cast: idOf.get(m.sender) ?? cast[0].id,
      lyric: m.text.replace(/\s+/g, ' ').slice(0, 120) + (i % 2 ? ', oh!' : ', ah!'),
      direction: 'Strikes a pose',
      emotion: EMOTIONS[(i + s) % EMOTIONS.length],
    }));
    while (lines.length < 6) lines.push({ ...lines[lines.length - 1] });
    return { title: `Act ${['I', 'II', 'III'][s]}: (stub)`, mood: MOODS[s], lines };
  });
  return JSON.stringify({ title: 'The Opera of the Group Chat (stub)', cast, scenes });
}
