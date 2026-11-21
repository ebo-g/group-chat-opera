import { singPhrase, singerProfile } from './singer.js';
const TONE_URL = 'https://esm.sh/tone@15.1.22';
const MOODS = {
  tense: {
    bpm: 82,
    chords: [[146.83, 174.61, 220], [116.54, 146.83, 174.61], [130.81, 155.56, 196], [110, 138.59, 164.81]],
    melody: [293.66, 261.63, null, 220, 233.08, null, 196, 220],
  },
  romantic: {
    bpm: 72,
    chords: [[130.81, 164.81, 196], [174.61, 220, 261.63], [146.83, 174.61, 220], [196, 246.94, 293.66]],
    melody: [392, 349.23, 329.63, null, 261.63, 293.66, null, 329.63],
  },
  comic: {
    bpm: 108,
    chords: [[130.81, 164.81, 196], [110, 130.81, 164.81], [174.61, 220, 261.63], [196, 246.94, 293.66]],
    melody: [392, 440, 392, 329.63, 349.23, 392, null, 293.66],
  },
  tragic: {
    bpm: 62,
    chords: [[130.81, 155.56, 196], [116.54, 138.59, 174.61], [103.83, 130.81, 155.56], [110, 138.59, 164.81]],
    melody: [261.63, null, 233.08, 196, 220, null, 174.61, 196],
  },
  triumphant: {
    bpm: 100,
    chords: [[130.81, 164.81, 196], [98, 130.81, 164.81], [110, 138.59, 164.81], [87.31, 130.81, 164.81]],
    melody: [392, 329.63, 392, 440, 523.25, 493.88, 440, 392],
  },
};
const VOICE = {
  soprano: { pitch: 1.06, rate: 0.98, midi: 76, wave: 'triangle' },
  alto: { pitch: 1.03, rate: 0.97, midi: 69, wave: 'sine' },
  tenor: { pitch: 1, rate: 0.98, midi: 64, wave: 'sawtooth' },
  baritone: { pitch: 0.97, rate: 0.96, midi: 59, wave: 'square' },
  bass: { pitch: 0.94, rate: 0.95, midi: 52, wave: 'triangle' },
};
let tonePromise;
let tone;
let pad;
let melody;
let bass;
let toneVolume;
let toneMusic;
let repeatId;
let activeMood = 'comic';
let unlocked = false;
let audioContext;
let fallbackBus;
let fallbackTimer;
let fallbackOscillators = [];
let fallbackLevel = 0.62;
let speechQueue = Promise.resolve();
let singingMode = 'sung';
let castVoiceMap = new Map();
let castEngineMap = new Map();
let lineNumbers = new WeakMap();
let lineAudio = new WeakMap();
let audioUrls = new Set();
let speechVoiceCatalog = [];
let speechVoiceLoadPromise;
let nextLineNumber = 0;

export function setSingingMode(mode) {
  singingMode = mode === 'speech' ? 'speech' : 'sung';
}

function loadTone() {
  if (!tonePromise) tonePromise = import(/* @vite-ignore */ TONE_URL).then((module) => module.default || module).catch(() => null);
  return tonePromise;
}

function getContext() {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioContext = new AudioContextClass();
      fallbackBus = audioContext.createGain();
      fallbackBus.gain.value = 0;
      fallbackBus.connect(audioContext.destination);
    }
  }
  return audioContext;
}

function ensureToneGraph() {
  if (!tone || pad) return;
  toneVolume = new tone.Volume(-18).toDestination();
  toneMusic = new tone.Gain(0).connect(toneVolume);
  pad = new tone.PolySynth(tone.Synth, {
    oscillator: { type: 'triangle' }, envelope: { attack: 0.5, decay: 0.7, sustain: 0.3, release: 2 },
  }).connect(toneMusic);
  melody = new tone.PolySynth(tone.Synth, {
    oscillator: { type: 'sine' }, envelope: { attack: 0.04, decay: 0.45, sustain: 0.08, release: 0.8 },
  }).connect(toneMusic);
  bass = new tone.PolySynth(tone.Synth, {
    oscillator: { type: 'triangle' }, envelope: { attack: 0.08, decay: 0.3, sustain: 0.18, release: 0.7 },
  }).connect(toneMusic);
}

/** Call directly from the file/sample click to unlock the browser audio context. */
export function primeAudio() {
  unlocked = true;
  let resume;
  try {
    const context = getContext();
    resume = context?.state === 'suspended' ? context.resume() : Promise.resolve();
  } catch { resume = Promise.resolve(); }
  return Promise.allSettled([resume, loadTone().then(async (loaded) => {
    if (!loaded) return;
    tone = loaded;
    try { await tone.start(); ensureToneGraph(); } catch { /* Native Web Audio remains available as a fallback. */ }
  })]);
}

function fadeTone(value, seconds = 0.8) {
  if (toneMusic && tone?.now) {
    const param = toneMusic.gain;
    param.cancelScheduledValues(tone.now());
    param.rampTo(value, seconds);
  }
}

function stopFallbackNotes() {
  for (const osc of fallbackOscillators) {
    try { osc.stop(); } catch { /* Already ended. */ }
  }
  fallbackOscillators = [];
}

function playFallbackNote(frequency, startAt, duration, level, type = 'triangle') {
  const context = getContext();
  if (!context || !fallbackBus) return;
  const oscillator = context.createOscillator();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startAt);
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(2400, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.linearRampToValueAtTime(level, startAt + 0.04);
  gain.gain.setTargetAtTime(0.0001, startAt + Math.max(0.05, duration - 0.18), 0.14);
  oscillator.connect(filter).connect(gain).connect(fallbackBus);
  oscillator.onended = () => {
    fallbackOscillators = fallbackOscillators.filter((active) => active !== oscillator);
    oscillator.disconnect();
    filter.disconnect();
    gain.disconnect();
  };
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.16);
  fallbackOscillators.push(oscillator);
}

function startFallback(mood) {
  const context = getContext();
  if (!context || context.state !== 'running' || !fallbackBus) return;
  window.clearInterval(fallbackTimer);
  stopFallbackNotes();
  fallbackBus.gain.cancelScheduledValues(context.currentTime);
  fallbackBus.gain.setTargetAtTime(fallbackLevel, context.currentTime, 0.32);
  const pattern = MOODS[mood] || MOODS.comic;
  const beatSeconds = 60 / pattern.bpm;
  let step = 0;
  const playBeat = () => {
    const now = context.currentTime;
    if (step % 4 === 0) {
      const chord = pattern.chords[Math.floor(step / 4) % pattern.chords.length];
      chord.forEach((frequency) => playFallbackNote(frequency, now, beatSeconds * 3.8, 0.026));
    }
    if (step % 2 === 0) {
      const chord = pattern.chords[Math.floor(step / 4) % pattern.chords.length];
      playFallbackNote(chord[0] / 2, now, beatSeconds * 1.7, 0.035);
    }
    const note = pattern.melody[step % pattern.melody.length];
    if (note) playFallbackNote(note, now, beatSeconds * 0.86, 0.045, 'sine');
    step += 1;
  };
  playBeat();
  fallbackTimer = window.setInterval(playBeat, beatSeconds * 1000);
}

/** Start or crossfade the soft looping accompaniment for a scene mood. */
export async function orchestra(mood = 'comic') {
  if (!unlocked) return;
  await primeAudio();
  const chosen = MOODS[mood] ? mood : 'comic';
  activeMood = chosen;
  if (!tone || !pad || !melody || !bass || !toneMusic) { startFallback(chosen); return; }

  fadeTone(0, 0.45);
  if (repeatId !== undefined) {
    tone.Transport.clear(repeatId);
    repeatId = undefined;
  }
  tone.Transport.bpm.rampTo(MOODS[chosen].bpm, 0.8);
  const pattern = MOODS[chosen];
  let step = 0;
  repeatId = tone.Transport.scheduleRepeat((time) => {
    const chord = pattern.chords[Math.floor(step / 4) % pattern.chords.length];
    if (step % 4 === 0) {
      pad.triggerAttackRelease(chord.map((frequency) => tone.Frequency(frequency, 'hz').toNote()), '1m', time, 0.19);
    }
    if (step % 2 === 0) bass.triggerAttackRelease(tone.Frequency(chord[0] / 2, 'hz').toNote(), '8n', time, 0.22);
    const note = pattern.melody[step % pattern.melody.length];
    if (note) melody.triggerAttackRelease(tone.Frequency(note, 'hz').toNote(), '8n', time, 0.28);
    step += 1;
  }, '4n', tone.Transport.seconds);
  if (tone.Transport.state !== 'started') tone.Transport.start();
  fadeTone(0.62, 1.2);
  if (fallbackBus && audioContext) fallbackBus.gain.setTargetAtTime(0, audioContext.currentTime, 0.15);
}

function stopOrchestra() {
  if (repeatId !== undefined && tone?.Transport) {
    tone.Transport.clear(repeatId);
    repeatId = undefined;
    tone.Transport.stop();
  }
  fadeTone(0, 1);
  window.clearInterval(fallbackTimer);
  fallbackTimer = undefined;
  stopFallbackNotes();
  if (fallbackBus && audioContext) fallbackBus.gain.setTargetAtTime(0, audioContext.currentTime, 0.2);
}

function fanfare(notes, gap = 0.2) {
  if (tone && melody && toneMusic) {
    fadeTone(0.62, 0.2);
    let time = tone.now() + 0.08;
    for (const note of notes) {
      melody.triggerAttackRelease(note, '8n', time, 0.52);
      time += gap;
    }
    return new Promise((resolve) => window.setTimeout(resolve, (notes.length - 1) * gap * 1000 + 550));
  }
  const context = getContext();
  if (!context || context.state !== 'running') return Promise.resolve();
  const frequencies = { C4: 261.63, E4: 329.63, G4: 392, C5: 523.25, E5: 659.25, G5: 783.99, C6: 1046.5 };
  notes.forEach((note, index) => playFallbackNote(
    typeof note === 'number' ? note : frequencies[note],
    context.currentTime + index * gap,
    0.62,
    0.07,
    'triangle',
  ));
  return new Promise((resolve) => window.setTimeout(resolve, (notes.length - 1) * gap * 1000 + 650));
}

export async function overture() {
  if (!unlocked) return;
  if (!speechVoiceCatalog.length) speechVoiceCatalog = await waitForSpeechVoices();
  await primeAudio();
  await orchestra('triumphant');
  await fanfare(['C4', 'E4', 'G4', 'C5', 'E5', 'G5'], 0.22);
}

export async function finale() {
  if (!unlocked) return;
  await primeAudio();
  await orchestra('triumphant');
  await fanfare(['C4', 'G4', 'C5', 'E5', 'G5', 'C6'], 0.16);
  stopOrchestra();
}

function duckMusic(isDucked) {
  if (toneVolume && tone?.now) toneVolume.volume.rampTo(isDucked ? -23 : -18, 0.18);
  if (fallbackBus && audioContext) fallbackBus.gain.setTargetAtTime(isDucked ? fallbackLevel * 0.55 : fallbackLevel, audioContext.currentTime, 0.18);
}

function castKey(castMember) {
  return String(castMember?.id || castMember?.name || castMember?.character || castMember?.voice || 'chorus');
}

function voicePool(voiceType) {
  return voiceType === 'soprano' || voiceType === 'alto' ? 'female' : 'male';
}

function normalizeLyricText(line) {
  const text = typeof line === 'string' ? line : line?.lyric || '';
  const lyric = text
    .replace(/\s*\/(?:\s*\/)*\s*/g, ', ')
    .replace(/(?:,\s*){2,}/g, ', ')
    .replace(/\s+([,;:.!?])/g, '$1')
    .replace(/([,;:])\s*[.!?]/g, '$1')
    .replace(/^[\s,;:.!?—–-]+|[\s,;:—–-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return /[\p{L}\p{N}]/u.test(lyric) ? lyric : '';
}

/** Sing a lyric as a vocalise with this character's fixed voice (see singer.js). */
function sungLine(line, castMember) {
  const text = normalizeLyricText(line);
  if (!text) return Promise.resolve();
  const context = getContext();
  duckMusic(true);
  let seconds = Math.max(0.35, text.split(/\s+/).length * 0.3);
  if (context?.state === 'running') {
    seconds = singPhrase(context, context.destination, text, castMember, activeMood, context.currentTime + 0.03);
  }
  return new Promise((resolve) => window.setTimeout(() => { duckMusic(false); resolve(); }, Math.max(350, seconds * 1000 + 250)));
}

function classifySpeechVoice(voice) {
  const explicit = String(voice.gender || voice.metadata?.gender || '').toLowerCase();
  if (/female|woman/.test(explicit)) return 'female';
  if (/male|man/.test(explicit)) return 'male';
  const name = `${voice.name} ${voice.lang}`.toLowerCase();
  if (/\bfemale\b|samantha|victoria|karen|moira|tessa|fiona|ava\b|allison|zira|susan|serena|zoe\b|aria\b|jenny\b|helen\b|janet\b|clara\b|matilda\b/.test(name)) return 'female';
  if (/\bmale\b|alex\b|daniel|fred\b|rishi|arthur|oliver|lee\b|guy\b|david|mark\b|tom\b|james|aaron|geoffrey|craig\b|adam\b|goliath/.test(name)) return 'male';
  return 'unknown';
}

function speechVoiceRank(voice) {
  if (/natural/i.test(voice.name)) return 0;
  if (/google|premium/i.test(voice.name)) return 1;
  return 2;
}

function assignCastVoices(cast, voices) {
  const english = voices.filter((voice) => /^en[-_]/i.test(voice.lang || ''));
  const sorted = [...(english.length ? english : voices)].sort((a, b) => speechVoiceRank(a) - speechVoiceRank(b) || a.name.localeCompare(b.name));
  const used = { female: new Set(), male: new Set() };
  const map = new Map();
  for (const member of cast) {
    const pool = voicePool(member.voice);
    const matching = sorted.filter((voice) => classifySpeechVoice(voice) === pool);
    const unknown = sorted.filter((voice) => classifySpeechVoice(voice) === 'unknown');
    const choices = matching.length ? [...matching, ...unknown] : unknown.length ? unknown : sorted;
    const preferred = choices.filter((candidate) => speechVoiceRank(candidate) < 2);
    const candidates = preferred.length ? preferred : choices;
    const voice = candidates.find((candidate) => !used[pool].has(candidate))
      || candidates[map.size % Math.max(1, candidates.length)] || null;
    if (voice) used[pool].add(voice);
    map.set(castKey(member), { voice, pool, label: voice?.name || `${pool} system voice` });
  }
  return map;
}

function waitForSpeechVoices() {
  if (!('speechSynthesis' in window)) return Promise.resolve([]);
  const speech = window.speechSynthesis;
  const current = speech.getVoices();
  if (current.length) return Promise.resolve(current);
  return new Promise((resolve) => {
    let complete = false;
    const finish = () => {
      if (complete) return;
      complete = true;
      window.clearTimeout(timer);
      speech.removeEventListener?.('voiceschanged', onChanged);
      resolve(speech.getVoices());
    };
    const onChanged = () => { if (speech.getVoices().length) finish(); };
    const timer = window.setTimeout(finish, 4000);
    speech.addEventListener?.('voiceschanged', onChanged);
    speech.getVoices();
  });
}

function loadSpeechVoiceCatalog() {
  if (!speechVoiceLoadPromise) {
    speechVoiceLoadPromise = waitForSpeechVoices().then((voices) => {
      speechVoiceCatalog = voices;
      return voices;
    });
  }
  return speechVoiceLoadPromise;
}

function refreshSpeechVoiceCatalog() {
  const voices = window.speechSynthesis.getVoices();
  const signature = (items) => items.map((voice) => `${voice.name}\u0000${voice.lang}`).join('\u0001');
  if (signature(voices) !== signature(speechVoiceCatalog)) castVoiceMap = new Map();
  speechVoiceCatalog = voices;
}

function getSpeechAssignment(castMember) {
  refreshSpeechVoiceCatalog();
  const key = castKey(castMember);
  const pool = voicePool(castMember?.voice);
  const existing = castVoiceMap.get(key);
  if (existing?.pool === pool) return existing;
  if (existing) castVoiceMap.delete(key);
  const english = speechVoiceCatalog.filter((voice) => /^en[-_]/i.test(voice.lang || ''));
  const sorted = [...(english.length ? english : speechVoiceCatalog)].sort((a, b) => speechVoiceRank(a) - speechVoiceRank(b) || a.name.localeCompare(b.name));
  const matching = sorted.filter((voice) => classifySpeechVoice(voice) === pool);
  const unknown = sorted.filter((voice) => classifySpeechVoice(voice) === 'unknown');
  const choices = matching.length ? [...matching, ...unknown] : unknown.length ? unknown : sorted;
  const preferred = choices.filter((candidate) => speechVoiceRank(candidate) < 2);
  const candidates = preferred.length ? preferred : choices;
  const used = new Set([...castVoiceMap.values()].map((assignment) => assignment.voice).filter(Boolean));
  const voice = candidates.find((candidate) => !used.has(candidate)) || candidates[0] || null;
  const assignment = { voice, pool, label: voice?.name || `${pool} system voice` };
  castVoiceMap.set(key, assignment);
  return assignment;
}

function speakUtterance(text, assignment, profile) {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.pitch = profile.pitch;
  utterance.rate = profile.rate;
  utterance.volume = 1;
  utterance.voice = assignment.voice;
  if (utterance.voice?.lang) utterance.lang = utterance.voice.lang;
  return new Promise((resolve) => {
    let done = false;
    let timer;
    const finish = () => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      resolve();
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    const estimate = Math.max(4500, Math.min(12000, text.trim().split(/\s+/).length * 900));
    timer = window.setTimeout(() => {
      window.speechSynthesis.cancel();
      finish();
    }, estimate);
    try { window.speechSynthesis.speak(utterance); } catch { finish(); }
  });
}

async function speakLine(line, castMember) {
  const text = normalizeLyricText(line);
  if (!text) return;
  if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
    const duration = Math.max(650, Math.min(6000, text.split(/\s+/).length * 300));
    return new Promise((resolve) => window.setTimeout(resolve, duration));
  }
  refreshSpeechVoiceCatalog();
  if (!speechVoiceCatalog.length) speechVoiceLoadPromise = undefined;
  const assignment = getSpeechAssignment(castMember);
  const profile = VOICE[castMember?.voice] || VOICE.alto;
  duckMusic(true);
  try {
    await speakUtterance(text, assignment, profile);
  } finally {
    duckMusic(false);
  }
}

function releasePreparedAudio() {
  for (const url of audioUrls) URL.revokeObjectURL(url);
  audioUrls = new Set();
  lineAudio = new WeakMap();
  lineNumbers = new WeakMap();
  nextLineNumber = 0;
}

/** Freeze cast voices and preload spoken lines before the overture begins. */
export async function prepareOpera(libretto) {
  releasePreparedAudio();
  castVoiceMap = new Map();
  castEngineMap = new Map();
  const cast = Array.isArray(libretto?.cast) ? libretto.cast : [];
  const lines = (Array.isArray(libretto?.scenes) ? libretto.scenes : []).flatMap((scene) => scene.lines || []);
  lines.forEach((line, index) => { if (line && typeof line === 'object') lineNumbers.set(line, index + 1); });

  speechVoiceCatalog = await loadSpeechVoiceCatalog();
  castVoiceMap = assignCastVoices(cast, speechVoiceCatalog);
  for (const member of cast) castEngineMap.set(castKey(member), 'synth');
  if (singingMode !== 'speech') return; // Do not spend ElevenLabs credits in sung mode.

  const linesByCast = new Map();
  for (const line of lines) {
    const id = String(line?.cast || '');
    if (!linesByCast.has(id)) linesByCast.set(id, []);
    linesByCast.get(id).push(line);
  }

  await Promise.all(cast.map(async (member) => {
    const id = castKey(member);
    const memberLines = linesByCast.get(id) || [];
    if (!memberLines.length) return;
    const pool = voicePool(member.voice);
    const blobs = [];
    try {
      // A character uses ElevenLabs only if every line is ready; otherwise discard this set.
      for (const line of memberLines) {
        const response = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: normalizeLyricText(line), castId: id, voice: member.voice }),
        });
        if (!response.ok) throw new Error(`TTS endpoint returned ${response.status}`);
        if (!(response.headers.get('content-type') || '').toLowerCase().startsWith('audio/')) {
          throw new Error('TTS endpoint did not return audio');
        }
        blobs.push([line, await response.blob()]);
      }
      for (const [line, blob] of blobs) {
        const url = URL.createObjectURL(blob);
        lineAudio.set(line, url);
        audioUrls.add(url);
      }
      castEngineMap.set(id, 'elevenlabs');
    } catch (error) {
      for (const [line] of blobs) lineAudio.delete?.(line);
      castEngineMap.set(id, 'synth');
      console.warn(`[opera-audio] ${member.name || id}: using ${pool} synth voice for the whole opera; ElevenLabs prefetch failed: ${error.message}`);
    }
  }));
}

function playPreparedAudio(line) {
  const url = line && typeof line === 'object' ? lineAudio.get(line) : null;
  if (!url) return Promise.resolve();
  return new Promise((resolve) => {
    const player = new Audio(url);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      duckMusic(false);
      resolve();
    };
    player.onended = finish;
    player.onerror = finish;
    duckMusic(true);
    player.play().catch(finish);
  });
}

function logLineEngine(line, castMember, engine, voice) {
  const index = line && typeof line === 'object' ? lineNumbers.get(line) : undefined;
  console.info('[opera-audio]', {
    line: index ?? ++nextLineNumber,
    castId: castKey(castMember),
    character: castMember?.name || castKey(castMember),
    engine,
    voice,
  });
}

/** Perform a lyric using one locked engine and voice for each character. */
export function sing(line, castMember) {
  const perform = () => {
    const id = castKey(castMember);
    if (singingMode !== 'speech') {
      const profile = singerProfile(castMember);
      logLineEngine(line, castMember, 'sung voice', `${profile.sex} ${profile.voice} (fixed per character)`);
      return sungLine(line, castMember);
    }
    const engine = castEngineMap.get(id) || 'synth';
    const assignment = getSpeechAssignment(castMember);
    const voice = engine === 'elevenlabs' ? `ElevenLabs ${castMember?.voice || assignment.pool} (${assignment.pool} pool)` : assignment.label;
    logLineEngine(line, castMember, engine === 'elevenlabs' ? 'ElevenLabs' : 'speech synthesis', voice);
    return engine === 'elevenlabs' ? playPreparedAudio(line) : speakLine(line, castMember);
  };
  speechQueue = speechQueue.then(perform, perform);
  return speechQueue;
}

// Download the library early without starting the audio context or playing sound.
void loadTone();
