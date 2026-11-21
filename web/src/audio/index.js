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
  soprano: { pitch: 1.06, rate: 0.98 }, alto: { pitch: 1.03, rate: 0.97 },
  tenor: { pitch: 1, rate: 0.98 }, baritone: { pitch: 0.97, rate: 0.96 }, bass: { pitch: 0.94, rate: 0.95 },
};

let tonePromise;
let tone;
let pad;
let melody;
let bass;
let toneVolume;
let toneMusic;
let repeatId;
let unlocked = false;
let audioContext;
let fallbackBus;
let fallbackTimer;
let fallbackOscillators = [];
let fallbackLevel = 0.62;
let speechQueue = Promise.resolve();

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
  if (!tone || !pad || !melody || !bass || !toneMusic) { startFallback(chosen); return; }

  fadeTone(0, 0.45);
  if (repeatId !== undefined) {
    tone.Transport.clear(repeatId);
    repeatId = undefined;
  }
  window.clearInterval(fallbackTimer);
  stopFallbackNotes();
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
  if (toneVolume && tone?.now) toneVolume.volume.rampTo(isDucked ? -32 : -18, 0.18);
  if (fallbackBus && audioContext) fallbackBus.gain.setTargetAtTime(isDucked ? 0.055 : fallbackLevel, audioContext.currentTime, 0.18);
}

function hashString(value) {
  let hash = 2166136261;
  for (const character of String(value)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function selectVoice(castMember) {
  const voices = window.speechSynthesis.getVoices();
  const english = voices.filter((voice) => /^en(?:[-_]|$)/i.test(voice.lang || ''));
  const natural = english.filter((voice) => /natural|enhanced|premium/i.test(voice.name || ''));
  const candidates = natural.length ? natural : english.length ? english : voices;
  if (!candidates.length) return null;
  const identity = castMember?.id ?? castMember?.name ?? castMember?.voice ?? 'singer';
  return candidates[hashString(identity) % candidates.length];
}

function speakLine(line, castMember) {
  const text = typeof line === 'string' ? line : line?.lyric || '';
  if (!text.trim()) return Promise.resolve();
  if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
    const duration = Math.max(650, Math.min(6000, text.trim().split(/\s+/).length * 300));
    return new Promise((resolve) => window.setTimeout(resolve, duration));
  }
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    const profile = VOICE[castMember?.voice] || VOICE.alto;
    utterance.pitch = profile.pitch;
    utterance.rate = profile.rate;
    utterance.volume = 1;
    utterance.voice = selectVoice(castMember);
    if (utterance.voice?.lang) utterance.lang = utterance.voice.lang;
    let done = false;
    let timer;
    const finish = (cancel = false) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      if (cancel) window.speechSynthesis.cancel();
      duckMusic(false);
      resolve();
    };
    utterance.onstart = () => duckMusic(true);
    utterance.onend = () => finish();
    utterance.onerror = () => finish();
    const estimate = Math.max(4500, Math.min(35000, text.trim().split(/\s+/).length * 430));
    timer = window.setTimeout(() => finish(true), estimate);
    try { window.speechSynthesis.speak(utterance); } catch { finish(); }
  });
}

/** Speak a lyric with a voice profile and duck the accompaniment until it ends. */
export function sing(line, castMember) {
  speechQueue = speechQueue.then(() => speakLine(line, castMember), () => speakLine(line, castMember));
  return speechQueue;
}
