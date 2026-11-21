// Orchestrates "sing the real words": where the speech comes from, background rendering,
// and playback. Sources, in order of preference, per line:
//   1. ElevenLabs (via the server's cached /api/tts) when a key + voice are configured
//   2. eSpeak running in the browser (free)
// Anything else (offline, unsupported...) returns null and the caller falls back to the
// wordless vocalise, so the opera always performs.

import { voiceBus } from './singer.js';
import { singLyric, rapLyric } from './wordsong.js';
import { loadEspeak, espeakSpeech } from './espeak.js';

const WORKERS = 3;
const ELEVEN_FORMANT_STRENGTH = 0.4; // real voices already differ; only nudge their colour
const STATUS_TIMEOUT_MS = 3000;
const TTS_TIMEOUT_MS = 30000;

// ---------------------------------------------------------------- DSP (worker with inline fallback)

let worker;
let workerBroken = false;
let nextId = 0;
const waiting = new Map();

function getWorker() {
  if (worker || workerBroken || typeof Worker === 'undefined') return worker;
  try {
    worker = new Worker(new URL('./wordsong.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const job = waiting.get(data.id);
      if (!job) return;
      waiting.delete(data.id);
      if (data.error) job.reject(new Error(data.error));
      else job.resolve(data.result);
    };
    worker.onerror = (event) => {
      workerBroken = true;
      worker = undefined;
      for (const job of waiting.values()) job.reject(new Error(event.message || 'worker failed'));
      waiting.clear();
    };
  } catch {
    workerBroken = true;
    worker = undefined;
  }
  return worker;
}

async function sing(speech, sampleRate, text, member, mood, options, rap) {
  const w = getWorker();
  if (w) {
    try {
      return await new Promise((resolve, reject) => {
        const id = ++nextId;
        waiting.set(id, { resolve, reject });
        w.postMessage({ id, speech, sampleRate, text, member: { ...member }, mood, options, rap });
      });
    } catch (error) {
      console.warn('[opera-audio] word-singing worker failed, using the main thread:', error.message);
    }
  }
  return rap ? rapLyric(speech, sampleRate, text, member, rap, options) : singLyric(speech, sampleRate, text, member, mood, options);
}

// ---------------------------------------------------------------- speech sources

async function fetchJson(url, timeoutMs) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

async function voiceStatus() {
  try {
    return await fetchJson('/api/voice/status', STATUS_TIMEOUT_MS);
  } catch {
    return { key: false, voices: {}, byVoiceType: {} };
  }
}

const elevenUsable = (status, member) =>
  Boolean(status.key && (status.byVoiceType?.[member.voice] || status.voices?.[member.id]));

async function elevenSpeech(context, text, member) {
  const response = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, castId: String(member.id), voice: member.voice }),
    signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`TTS returned ${response.status}`);
  if (!(response.headers.get('content-type') || '').toLowerCase().startsWith('audio/')) throw new Error('TTS did not return audio');
  const decoded = await context.decodeAudioData(await response.arrayBuffer());
  return { samples: Float32Array.from(decoded.getChannelData(0)), sampleRate: decoded.sampleRate };
}

// ---------------------------------------------------------------- public API

/**
 * Start rendering every lyric of the opera in the background, in performance order.
 * Returns {songs: Map<line, Promise<{buffer, source}|null>>, ready: Promise} where `ready`
 * resolves once the first lines are done (so the show can start immediately after).
 */
export function startWordSongs({ cast, scenes, context, isCurrent, normalize, style = 'sing', onFirst = 2, firstTimeoutMs = 20000 }) {
  const jobs = [];
  for (const scene of scenes || []) {
    for (const line of scene.lines || []) {
      const member = cast.find((c) => String(c.id) === String(line?.cast));
      const text = normalize(line);
      if (member && text) jobs.push({ line, member, text, mood: scene.mood });
    }
  }

  const songs = new Map();
  const resolvers = new Map();
  for (const job of jobs) songs.set(job.line, new Promise((resolve) => resolvers.set(job, resolve)));

  const statusPromise = voiceStatus();
  // Rap does not use eSpeak: it is a robotic formant synthesizer and sounds choppy. Without
  // ElevenLabs, rap lines fall back to the browser's natural voices (handled by the caller).
  const useEspeak = style !== 'rap';
  const espeakPromise = useEspeak ? loadEspeak() : Promise.resolve(null);
  const queue = [...jobs];

  async function render(job) {
    const status = await statusPromise;
    let speech = null;
    let source = '';
    let strength = 1;
    if (elevenUsable(status, job.member)) {
      try {
        speech = await elevenSpeech(context, job.text, job.member);
        source = 'ElevenLabs';
        strength = ELEVEN_FORMANT_STRENGTH;
      } catch (error) {
        console.warn(`[opera-audio] ElevenLabs failed for ${job.member.name || job.member.id}, using eSpeak: ${error.message}`);
      }
    }
    if (!speech && !useEspeak) return null;
    if (!speech) {
      const engine = await espeakPromise;
      speech = espeakSpeech(engine, job.text, job.member.voice, { speed: style === 'rap' ? 165 : 125 });
      source = 'eSpeak';
      strength = 1;
    }
    if (!speech) return null;
    // PSOLA pitch/time processing made rap consonants buzzy and crackly. Rap has
    // a beat to carry the line, so preserve the clean source voice and only use
    // the grid for its entrance. The processed syllabic singing remains for opera.
    if (style === 'rap') {
      let peak = 0;
      for (const sample of speech.samples) peak = Math.max(peak, Math.abs(sample));
      const gain = peak > 0.82 ? 0.82 / peak : 1;
      const samples = gain === 1 ? speech.samples : Float32Array.from(speech.samples, (sample) => sample * gain);
      const buffer = context.createBuffer(1, samples.length, speech.sampleRate);
      buffer.copyToChannel(samples, 0);
      return { buffer, source: `clean ${source}`, heard: 0, expected: 0 };
    }
    const result = await sing(speech.samples, speech.sampleRate, job.text, job.member, job.mood, { formantStrength: strength });
    if (!result) return null;
    const buffer = context.createBuffer(1, result.samples.length, result.sampleRate);
    buffer.copyToChannel(result.samples, 0);
    return { buffer, source, heard: result.heard, expected: result.expected };
  }

  async function runWorker() {
    while (queue.length && isCurrent()) {
      const job = queue.shift();
      let song = null;
      try {
        song = await render(job);
      } catch (error) {
        console.warn(`[opera-audio] could not render a sung line: ${error.message}`);
      }
      resolvers.get(job)(song);
      await new Promise((resolve) => setTimeout(resolve, 0)); // let the stage animate between lines
    }
    // a newer opera replaced this one: release anything still waiting
    for (const job of queue.splice(0)) resolvers.get(job)(null);
  }
  for (let i = 0; i < WORKERS; i += 1) void runWorker();

  const ready = Promise.race([
    Promise.all(jobs.slice(0, onFirst).map((job) => songs.get(job.line))),
    new Promise((resolve) => setTimeout(resolve, firstTimeoutMs)),
  ]);
  return { songs, ready };
}

/** Play a rendered song through the shared voice bus (with a little hall reverb). */
export function playWordSong(context, buffer, when, { dry = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    let timer;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(dry ? context.destination : voiceBus(context, context.destination).input);
    source.onended = finish;
    const at = when ?? context.currentTime + 0.03;
    timer = setTimeout(finish, Math.max(0, at - context.currentTime) * 1000 + buffer.duration * 1000 + 1000);
    source.start(at);
  });
}
