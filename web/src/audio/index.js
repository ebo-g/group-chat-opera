const TONE_URL = 'https://esm.sh/tone@15.1.22';
const MOODS = {
  tense:       { bpm: 92,  chords: [[146.83,174.61,220], [138.59,164.81,207.65]], color: '#a0444a' },
  romantic:    { bpm: 68,  chords: [[261.63,329.63,392], [220,261.63,329.63]], color: '#bf7690' },
  comic:       { bpm: 126, chords: [[261.63,329.63,392], [293.66,369.99,440]], color: '#d09a4a' },
  tragic:      { bpm: 58,  chords: [[130.81,155.56,196], [116.54,138.59,174.61]], color: '#67809b' },
  triumphant:  { bpm: 112, chords: [[261.63,329.63,392], [196,261.63,329.63]], color: '#d2ac4d' },
};
const VOICE = {
  soprano: { pitch: 1.28, rate: 0.94 }, alto: { pitch: 1.08, rate: 0.9 },
  tenor: { pitch: 0.96, rate: 0.96 }, baritone: { pitch: 0.82, rate: 0.88 }, bass: { pitch: 0.7, rate: 0.84 },
};

let tonePromise;
let tone;
let synth;
let drum;
let toneVolume;
let toneMusic;
let repeatId;
let activeMood;
let unlocked = false;
let audioContext;
let fallbackBus;
let fallbackTimer;
let fallbackOscillators = [];
let fallbackLevel = 0.075;
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
  if (!tone || synth) return;
  toneVolume = new tone.Volume(-15).toDestination();
  toneMusic = new tone.Gain(0).connect(toneVolume);
  synth = new tone.PolySynth(tone.Synth, {
    oscillator: { type: 'sine' }, envelope: { attack: 0.12, decay: 0.25, sustain: 0.35, release: 1.1 },
  }).connect(toneMusic);
  drum = new tone.MembraneSynth({ pitchDecay: 0.05, octaves: 3, envelope: { attack: 0.001, decay: 0.35, sustain: 0.01, release: 0.5 } }).connect(toneMusic);
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

function playFallbackChord(mood, index) {
  const context = getContext();
  if (!context || context.state !== 'running' || !fallbackBus) return;
  const pattern = MOODS[mood] || MOODS.comic;
  const chord = pattern.chords[index % pattern.chords.length];
  const now = context.currentTime;
  for (const [i, frequency] of chord.entries()) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = i === 0 ? 'triangle' : 'sine';
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.045 / (i + 1), now + 0.18);
    gain.gain.setTargetAtTime(0, now + 1.6, 0.8);
    oscillator.connect(gain).connect(fallbackBus);
    oscillator.start(now);
    oscillator.stop(now + 4.2);
    fallbackOscillators.push(oscillator);
  }
  if (mood === 'tense' || mood === 'triumphant') {
    const bass = context.createOscillator();
    const thump = context.createGain();
    bass.type = 'sine'; bass.frequency.setValueAtTime(58, now); bass.frequency.exponentialRampToValueAtTime(34, now + 0.25);
    thump.gain.setValueAtTime(0.12, now); thump.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    bass.connect(thump).connect(fallbackBus); bass.start(now); bass.stop(now + 0.32);
    fallbackOscillators.push(bass);
  }
}

function startFallback(mood) {
  const context = getContext();
  if (!context || context.state !== 'running' || !fallbackBus) return;
  window.clearInterval(fallbackTimer);
  stopFallbackNotes();
  fallbackBus.gain.cancelScheduledValues(context.currentTime);
  fallbackBus.gain.setTargetAtTime(fallbackLevel, context.currentTime, 0.32);
  let beat = 0;
  playFallbackChord(mood, beat++);
  const period = 60000 / (MOODS[mood]?.bpm || MOODS.comic.bpm) * 4;
  fallbackTimer = window.setInterval(() => playFallbackChord(mood, beat++), period);
}

/** Start or crossfade the soft looping accompaniment for a scene mood. */
export async function orchestra(mood = 'comic') {
  if (!unlocked) return;
  await primeAudio();
  const chosen = MOODS[mood] ? mood : 'comic';
  activeMood = chosen;
  if (!tone || !synth || !toneMusic) { startFallback(chosen); return; }

  fadeTone(0, 0.45);
  if (repeatId !== undefined) {
    tone.Transport.clear(repeatId);
    repeatId = undefined;
  }
  tone.Transport.bpm.rampTo(MOODS[chosen].bpm, 0.8);
  const pattern = MOODS[chosen];
  let chordIndex = 0;
  repeatId = tone.Transport.scheduleRepeat((time) => {
    const chord = pattern.chords[chordIndex++ % pattern.chords.length];
    synth.triggerAttackRelease(chord.map((frequency) => tone.Frequency(frequency, 'hz').toNote()), '2n', time, 0.32);
    if (chosen === 'tense' || chosen === 'triumphant') drum.triggerAttackRelease('C1', '8n', time, chosen === 'tense' ? 0.2 : 0.38);
  }, chosen === 'comic' ? '2n' : '1m', tone.Transport.seconds);
  if (tone.Transport.state !== 'started') tone.Transport.start();
  fadeTone(0.82, 1.2);
  if (fallbackBus) fallbackBus.gain.setTargetAtTime(0, audioContext.currentTime, 0.15);
}

function fanfare(notes, gap = 0.2) {
  if (tone && synth && toneMusic) {
    fadeTone(0.82, 0.2);
    let time = tone.now() + 0.08;
    for (const note of notes) {
      synth.triggerAttackRelease(note, '8n', time, 0.58);
      time += gap;
    }
    return;
  }
  const context = getContext();
  if (!context || context.state !== 'running') return;
  const frequencies = { C4: 261.63, E4: 329.63, G4: 392, C5: 523.25, E5: 659.25, G5: 783.99, C6: 1046.5 };
  notes.forEach((frequency, index) => {
    const oscillator = context.createOscillator(); const gain = context.createGain();
    const time = context.currentTime + index * gap;
    oscillator.type = 'triangle'; oscillator.frequency.value = typeof frequency === 'number' ? frequency : frequencies[frequency];
    gain.gain.setValueAtTime(0, time); gain.gain.linearRampToValueAtTime(0.1, time + 0.025); gain.gain.exponentialRampToValueAtTime(0.001, time + 0.4);
    oscillator.connect(gain).connect(context.destination); oscillator.start(time); oscillator.stop(time + 0.42);
  });
}

export async function overture() {
  if (!unlocked) return;
  await primeAudio();
  await orchestra('triumphant');
  fanfare(['C4', 'E4', 'G4', 'C5', 'E5', 'G5'], 0.22);
}

export async function finale() {
  if (!unlocked) return;
  await primeAudio();
  await orchestra('triumphant');
  fanfare(['C4', 'G4', 'C5', 'E5', 'G5', 'C6'], 0.16);
}

function duckMusic(isDucked) {
  if (toneVolume && tone?.now) toneVolume.volume.rampTo(isDucked ? -29 : -15, 0.18);
  if (fallbackBus && audioContext) fallbackBus.gain.setTargetAtTime(isDucked ? 0.012 : fallbackLevel, audioContext.currentTime, 0.18);
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
    const voices = window.speechSynthesis.getVoices();
    utterance.voice = voices.find((voice) => /^en[-_]/i.test(voice.lang) && /natural|enhanced|premium/i.test(voice.name))
      || voices.find((voice) => /^en[-_]/i.test(voice.lang)) || null;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      duckMusic(false);
      resolve();
    };
    utterance.onstart = () => duckMusic(true);
    utterance.onend = finish;
    utterance.onerror = finish;
    window.speechSynthesis.speak(utterance);
    const estimate = Math.max(5000, Math.min(30000, text.length * 120));
    window.setTimeout(finish, estimate);
  });
}

/** Speak a lyric with a voice profile and duck the accompaniment until it ends. */
export function sing(line, castMember) {
  speechQueue = speechQueue.then(() => speakLine(line, castMember), () => speakLine(line, castMember));
  return speechQueue;
}

// Download the library early without starting the audio context or playing sound.
void loadTone();
