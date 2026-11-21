import assert from 'node:assert/strict';
import test from 'node:test';
import { planPhrase, singerProfile, syllabify, schedulePhrase, sexOf } from '../src/audio/singer.js';

const maddie = { id: 'c1', name: 'Maddie', voice: 'soprano' };
const josh = { id: 'c3', name: 'Josh', voice: 'baritone' };

test('a character keeps exactly the same voice for every line', () => {
  const first = singerProfile(maddie);
  // Renaming a character must not change their voice either; only id/voice/sex do.
  assert.deepEqual(singerProfile({ ...maddie, name: 'Madeline' }), first);
  assert.deepEqual(singerProfile({ ...maddie }), first);
  assert.notDeepEqual(singerProfile(josh), first);
  const a = planPhrase('Who ate the lasagne?', maddie, 'comic');
  assert.deepEqual(planPhrase('Who ate the lasagne?', maddie, 'comic'), a, 'same lyric, same melody');
});

test('every line of one character opens with that character\'s signature motif', () => {
  const lines = ['Who ate the lasagne, I demand to know!', 'There is no other Maddi in this place!', 'Oh how the toaster has betrayed us all'];
  const openings = lines.map((l) => planPhrase(l, maddie, 'tragic').notes.slice(0, 4).map((n) => n.midi));
  for (const o of openings) assert.deepEqual(o, openings[0]);
});

test('voice types sing in their own registers and sex sets the formants', () => {
  const mid = (member) => {
    const midis = planPhrase('Behold a cat in a tiny hat, rejoice rejoice', member, 'triumphant').notes.map((n) => n.midi);
    return midis.reduce((a, b) => a + b, 0) / midis.length;
  };
  const order = ['soprano', 'alto', 'tenor', 'baritone', 'bass'].map((voice) => mid({ id: 'x', voice }));
  assert.deepEqual([...order].sort((a, b) => b - a), order, 'soprano highest ... bass lowest');
  assert.equal(sexOf({ voice: 'alto' }), 'female');
  assert.equal(sexOf({ voice: 'bass' }), 'male');
  assert.equal(sexOf({ voice: 'bass', sex: 'female' }), 'female', 'explicit sex wins');
  assert.equal(singerProfile({ id: 'x', voice: 'tenor', sex: 'female' }).sex, 'female');
});

test('lyrics become syllables with their own vowels and a held, resolved cadence', () => {
  assert.deepEqual(syllabify('the toast, no!').map((s) => s.vowel), ['e', 'o', 'o']);
  const p = planPhrase('Seen. Liked. Loved. Forever yours, Dave.', josh, 'romantic');
  const last = p.notes.at(-1);
  const avg = p.notes.slice(0, -1).reduce((a, n) => a + n.dur, 0) / (p.notes.length - 1);
  assert.ok(last.dur > avg * 2, 'final note is held');
  assert.equal((last.midi - singerProfile(josh).tonic) % 12, 0, 'a statement ends on the tonic');
  const q = planPhrase('Who ate the lasagne?', josh, 'comic').notes.at(-1);
  assert.notEqual((q.midi - singerProfile(josh).tonic) % 12, 0, 'a question does not resolve');
});

test('phrases stay short enough to keep the opera moving and never empty', () => {
  const long = Array.from({ length: 60 }, () => 'incomprehensible').join(' ');
  assert.ok(planPhrase(long, maddie, 'tragic').total <= 12);
  assert.ok(planPhrase('', maddie, 'comic').notes.length >= 1);
  assert.ok(planPhrase('...', maddie, 'comic').notes.length >= 1);
});

test('schedulePhrase builds a filtered sawtooth voice with vibrato', () => {
  const oscillators = [];
  const node = () => ({
    connect() { return this; }, start() {}, stop() {},
    gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {} },
    frequency: { value: 0, setValueAtTime() {}, setTargetAtTime() {} },
    detune: { value: 0 }, Q: { value: 0 },
  });
  const ctx = { currentTime: 0, createGain: node, createBiquadFilter: node, createOscillator() { const o = node(); oscillators.push(o); return o; } };
  const plan = planPhrase('Dave, Dave, you have read it!', maddie, 'tragic');
  const { duration } = schedulePhrase(ctx, node(), plan, maddie, 0);
  assert.equal(duration, plan.total);
  assert.equal(oscillators.filter((o) => o.type === 'sawtooth').length, 2);
  assert.equal(oscillators.filter((o) => o.type === 'sine').length, 1, 'one vibrato LFO');
});
