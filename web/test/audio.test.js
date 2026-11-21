import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

let autoCompleteSpeech = true;
let voices = [
  { name: 'English Default', lang: 'en-US' },
  { name: 'English Natural A', lang: 'en-US' },
  { name: 'English Premium B', lang: 'en-GB' },
  { name: 'French Natural', lang: 'fr-FR' },
];
const utterances = [];
const timers = new Map();
const oscillators = [];
let timerSequence = 0;
let cancelCount = 0;
const intervals = new Map();

class FakeParam {
  setValueAtTime() {}
  linearRampToValueAtTime() {}
  exponentialRampToValueAtTime() {}
  setTargetAtTime() {}
  cancelScheduledValues() {}
}

class FakeAudioNode {
  constructor() {
    this.gain = new FakeParam();
    this.frequency = new FakeParam();
  }
  connect() { return this; }
  disconnect() {}
  start() {}
  stop() {}
}

class FakeAudioContext {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.destination = new FakeAudioNode();
  }
  createGain() { return new FakeAudioNode(); }
  createOscillator() {
    const oscillator = new FakeAudioNode();
    oscillators.push(oscillator);
    return oscillator;
  }
  createBiquadFilter() { return new FakeAudioNode(); }
  resume() { return Promise.resolve(); }
}

class FakeUtterance {
  constructor(text) { this.text = text; }
}

const speechSynthesis = {
  getVoices: () => voices,
  speak(utterance) {
    utterances.push(utterance);
    if (autoCompleteSpeech) {
      queueMicrotask(() => {
        utterance.onstart?.();
        utterance.onend?.();
      });
    }
  },
  cancel() { cancelCount += 1; },
};

globalThis.SpeechSynthesisUtterance = FakeUtterance;
globalThis.window = {
  SpeechSynthesisUtterance: FakeUtterance,
  AudioContext: FakeAudioContext,
  speechSynthesis,
  setTimeout(callback, delay) {
    const id = ++timerSequence;
    timers.set(id, { callback, delay });
    return id;
  },
  clearTimeout(id) { timers.delete(id); },
  setInterval(callback, delay) {
    const id = ++timerSequence;
    intervals.set(id, { callback, delay });
    return id;
  },
  clearInterval(id) { intervals.delete(id); },
};

const { sing, setSingingMode, primeAudio, orchestra, finale, prepareOpera } = await import('../src/audio/index.js');

describe('audio behavior', { concurrency: false }, () => {
test('speech uses stable natural English voices and modest delivery settings', async () => {
  setSingingMode('speech');
  const cast = Array.from({ length: 12 }, (_, index) => ({
    id: `singer-${index}`,
    voice: index % 2 ? 'bass' : 'soprano',
  }));

  for (const member of cast) await sing('A line for the stage.', member);
  const assignedVoices = new Set(utterances.map((utterance) => utterance.voice?.name));

  assert.ok(utterances.every((utterance) => /natural|premium/i.test(utterance.voice?.name || '')));
  assert.ok(utterances.every((utterance) => /^en[-_]/i.test(utterance.lang)));
  assert.ok(assignedVoices.size > 1, 'cast members should use more than one available natural voice');
  assert.ok(utterances.every((utterance) => utterance.pitch >= 0.9 && utterance.pitch <= 1.1));
  assert.ok(utterances.every((utterance) => utterance.rate >= 0.9 && utterance.rate <= 1.05));

  const sameMember = cast[0];
  await sing('First phrase.', sameMember);
  await sing('Second phrase.', sameMember);
  const repeated = utterances.slice(-2);
  assert.equal(repeated[0].voice, repeated[1].voice);
});

test('speech timeout cancels stalled playback and clears its timer', async () => {
  setSingingMode('speech');
  autoCompleteSpeech = false;
  const previousCount = utterances.length;
  const previousCancels = cancelCount;
  const pending = sing('A phrase that never ends.', { id: 'stalled-singer', voice: 'alto' });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(utterances.length, previousCount + 1);
  assert.equal(timers.size, 1);
  const [[id, timer]] = timers;
  timers.delete(id);
  timer.callback();
  await pending;

  assert.equal(cancelCount, previousCancels + 1);
  assert.equal(timers.size, 0);
  autoCompleteSpeech = true;
});

test('voice selection falls back safely when the browser has no voices yet', async () => {
  setSingingMode('speech');
  voices = [];
  await sing('The cast can still continue.', { id: 'voice-loading', voice: 'alto' });
  assert.equal(utterances.at(-1).voice, null);
  voices = [
    { name: 'English Default', lang: 'en-US' },
    { name: 'English Natural A', lang: 'en-US' },
    { name: 'English Premium B', lang: 'en-GB' },
    { name: 'French Natural', lang: 'fr-FR' },
  ];
});

test('spoken lyrics treat slash separators as pauses and ignore separator-only lines', async () => {
  setSingingMode('speech');
  const previousCount = utterances.length;
  await sing('One / two // three', { id: 'slash-singer', voice: 'alto' });
  assert.equal(utterances.at(-1).text, 'One, two, three');

  await sing(' / // ', { id: 'slash-singer', voice: 'alto' });
  await sing('... — !!!', { id: 'slash-singer', voice: 'alto' });
  assert.equal(utterances.length, previousCount + 1, 'a separator-only lyric should not create a spoken utterance');
});

test('spoken voice prefetch uses the same slash-free lyric text', async () => {
  setSingingMode('speech');
  const requests = [];
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return {
        ok: true,
        headers: { get: () => 'audio/mpeg' },
        blob: async () => new Blob(['audio']),
      };
    };
    const line = { cast: 'prefetch-singer', lyric: 'Wait / and // listen!' };
    await prepareOpera({ cast: [{ id: 'prefetch-singer', voice: 'tenor' }], scenes: [{ lines: [line] }] });
    assert.equal(requests[0].text, 'Wait, and, listen!');
  } finally {
    globalThis.fetch = originalFetch;
    await prepareOpera({ cast: [], scenes: [] });
  }
});

test('sung mode sings the lyric as a formant-filtered voice instead of speaking it', async () => {
  await primeAudio();
  await orchestra('tragic');
  setSingingMode('sung');
  const firstSungOscillator = oscillators.length;
  const spokenBefore = utterances.length;
  const performance = sing('Ah, the night is full of hope.', { id: 'sung-baritone', voice: 'baritone' });
  await new Promise((resolve) => setImmediate(resolve));

  for (const [timerId, timer] of [...timers]) {
    if (timer.delay >= 350) {
      timers.delete(timerId);
      timer.callback();
    }
  }
  await performance;

  const sungOscillators = oscillators.slice(firstSungOscillator);
  assert.ok(sungOscillators.length > 0, 'the line is sung by synthesized oscillators');
  assert.ok(sungOscillators.every((oscillator) => ['sine', 'triangle', 'sawtooth', 'square'].includes(oscillator.type)));
  assert.ok(sungOscillators.some((oscillator) => oscillator.type === 'sawtooth'), 'the sung voice is a formant-filtered sawtooth source');
  assert.equal(utterances.length, spokenBefore, 'sung mode does not use speech synthesis');
});

test('scene changes replace accompaniment and the finale stops its loop', async () => {
  await primeAudio();
  await orchestra('romantic');
  assert.equal(intervals.size, 1);

  await orchestra('tragic');
  assert.equal(intervals.size, 1, 'a scene change should replace, not duplicate, the music loop');

  const performance = finale();
  await new Promise((resolve) => setImmediate(resolve));
  const [[timerId, timer]] = [...timers].filter(([, value]) => value.delay > 500);
  assert.ok(timer, 'the finale fanfare should be scheduled');
  timers.delete(timerId);
  timer.callback();
  await performance;

  assert.equal(intervals.size, 0, 'the accompaniment loop should stop when the finale completes');
});
});