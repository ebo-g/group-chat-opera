import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { config } from './config.js';

// castIds are positional (c1..c5), so voices are configured per position,
// not per character name: ELEVENLABS_VOICE_C1 ... ELEVENLABS_VOICE_C5.
export const CAST_IDS = ['c1', 'c2', 'c3', 'c4', 'c5'];
export const MAX_TEXT = 1000;

export class TtsError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const voiceIdFor = (castId) => process.env[`ELEVENLABS_VOICE_${String(castId).toUpperCase()}`]?.trim() || '';

/** Booleans only: never expose the key or voice IDs. */
export function voiceStatus() {
  const voices = Object.fromEntries(CAST_IDS.map((id) => [id, Boolean(voiceIdFor(id))]));
  const key = Boolean(process.env.ELEVENLABS_API_KEY?.trim());
  return { key, voices, ready: key && Object.values(voices).every(Boolean) };
}

const cacheKey = (text, castId, voiceId) =>
  createHash('sha256').update(JSON.stringify([text, castId, voiceId])).digest('hex');

const inflight = new Map(); // key -> Promise<Buffer>: dedupe concurrent identical requests

/** -> { audio: Buffer, cached: boolean } or throws TtsError. */
export async function synthesize(text, castId) {
  if (typeof text !== 'string' || !text.trim()) throw new TtsError(400, 'bad_request', 'text (string) is required');
  if (text.length > MAX_TEXT) throw new TtsError(400, 'bad_request', `text is too long (max ${MAX_TEXT} characters)`);
  if (!CAST_IDS.includes(castId)) throw new TtsError(400, 'bad_cast', `castId must be one of ${CAST_IDS.join(', ')}`);

  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const voiceId = voiceIdFor(castId);
  if (!apiKey) throw new TtsError(503, 'not_configured', 'ElevenLabs is not configured (missing API key); use fallback voices');
  if (!voiceId) throw new TtsError(503, 'not_configured', `No ElevenLabs voice set for ${castId}; use fallback voices`);

  const key = cacheKey(text, castId, voiceId);
  const file = new URL(`audio/${key}.mp3`, config.cacheDir);

  try {
    return { audio: await readFile(file), cached: true };
  } catch {}

  let job = inflight.get(key);
  if (!job) {
    job = fetchAudio(text, voiceId, apiKey)
      .then(async (audio) => {
        await mkdir(new URL('audio/', config.cacheDir), { recursive: true });
        const tmp = new URL(`audio/${key}.${process.pid}.tmp`, config.cacheDir);
        await writeFile(tmp, audio);
        await rename(tmp, file); // atomic: never serve a half-written file
        return audio;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, job);
  }
  return { audio: await job, cached: false };
}

async function fetchAudio(text, voiceId, apiKey) {
  let res;
  try {
    res = await fetch(`${config.ttsBaseUrl}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_64`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: config.ttsModel }),
      signal: AbortSignal.timeout(config.ttsTimeoutMs),
    });
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      throw new TtsError(504, 'timeout', `ElevenLabs did not respond within ${config.ttsTimeoutMs / 1000}s; use fallback voices`);
    }
    throw new TtsError(502, 'upstream_unreachable', 'Could not reach ElevenLabs; use fallback voices');
  }
  if (!res.ok) {
    // Never forward the upstream body (could echo request details); map to a clear code.
    const code = res.status === 401 || res.status === 403 ? 'upstream_auth' : res.status === 429 ? 'upstream_rate_limited' : 'upstream_error';
    throw new TtsError(502, code, `ElevenLabs returned ${res.status}; use fallback voices`);
  }
  let audio;
  try {
    audio = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    const timedOut = e.name === 'TimeoutError' || e.name === 'AbortError';
    throw new TtsError(timedOut ? 504 : 502, timedOut ? 'timeout' : 'upstream_error', 'ElevenLabs audio download failed; use fallback voices');
  }
  if (!audio.length) throw new TtsError(502, 'upstream_error', 'ElevenLabs returned empty audio; use fallback voices');
  return audio;
}
