// Free, in-browser speech source: eSpeak (via meSpeak), loaded lazily from a CDN.
// Used when no ElevenLabs key is configured. Returns null (never throws) when it cannot load,
// so the caller can fall back to the wordless vocalise.
//
// Note: eSpeak is GPL-3 software; it is loaded from jsDelivr at runtime, not bundled into the repo.

import { parseWav } from './wordsong.js';

const BASE = 'https://cdn.jsdelivr.net/npm/mespeak@1.9.6/';
const LOAD_TIMEOUT_MS = 10000;

// eSpeak's pitch setting (0-99) controls the speech's own f0 (about 87-176 Hz).
// Start the speech near the register it will be sung in, so the pitch shift stays small.
const PITCH_BY_VOICE = { soprano: 99, alto: 90, tenor: 70, baritone: 45, bass: 20 };

let enginePromise;

function injectScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`could not load ${src}`));
    document.head.appendChild(script);
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function load() {
  if (typeof document === 'undefined') return null; // not in a browser
  const deadline = Date.now() + LOAD_TIMEOUT_MS;
  if (!window.meSpeak) await injectScript(`${BASE}mespeak.js`);
  const engine = window.meSpeak;
  if (!engine) return null;
  // loadConfig(url) has no callback in this version: poll until it is ready.
  if (!engine.isConfigLoaded()) {
    engine.loadConfig(`${BASE}mespeak_config.json`);
    while (!engine.isConfigLoaded() && Date.now() < deadline) await sleep(50);
  }
  if (!engine.isConfigLoaded()) return null;
  if (!engine.isVoiceLoaded('en/en-us')) {
    const ok = await Promise.race([
      new Promise((resolve) => engine.loadVoice(`${BASE}voices/en/en-us.json`, (success) => resolve(success))),
      sleep(Math.max(1000, deadline - Date.now())).then(() => false),
    ]);
    if (!ok) return null;
  }
  return engine;
}

/** Resolves to the engine, or null if it is unavailable (offline, blocked CDN...). Cached. */
export function loadEspeak() {
  enginePromise ??= load().catch((error) => {
    console.warn('[opera-audio] eSpeak unavailable:', error.message);
    return null;
  });
  return enginePromise;
}

/** Synthesize `text` for a voice type -> {samples: Float32Array, sampleRate} or null. */
export function espeakSpeech(engine, text, voiceType) {
  if (!engine || !text) return null;
  try {
    const wav = engine.speak(text, {
      rawdata: 'ArrayBuffer',
      pitch: PITCH_BY_VOICE[voiceType] ?? 60,
      speed: 125,
      amplitude: 100,
    });
    if (!wav || !wav.byteLength) return null;
    return parseWav(wav);
  } catch (error) {
    console.warn('[opera-audio] eSpeak synthesis failed:', error.message);
    return null;
  }
}
