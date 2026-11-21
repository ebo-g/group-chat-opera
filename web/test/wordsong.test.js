import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWav, toWordRate, analyze, findNuclei, pitchMarks, singLyric, fitRegister, formantFor, WORD_SR } from '../src/audio/wordsong.js';
import { singerProfile, midiToHz } from '../src/audio/singer.js';

// ---- a synthetic "spoken" phrase: noise consonant + voiced vowel, three times --------------
function resonator(freq, bw, sr) {
  const r = Math.exp((-Math.PI * bw) / sr);
  const a1 = -2 * r * Math.cos((2 * Math.PI * freq) / sr);
  const a2 = r * r;
  let y1 = 0;
  let y2 = 0;
  return (x) => {
    const y = x - a1 * y1 - a2 * y2;
    y2 = y1;
    y1 = y;
    return y;
  };
}

function syntheticSpeech({ f0 = 120, syllables = 3, sr = WORD_SR } = {}) {
  const pieces = [];
  let seed = 7;
  const noise = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const f1 = resonator(700, 110, sr);
  const f2 = resonator(1200, 130, sr);
  for (let s = 0; s < syllables; s++) {
    const cons = Math.round(sr * 0.06);
    for (let i = 0; i < cons; i++) pieces.push(noise() * 0.05); // unvoiced consonant
    const vow = Math.round(sr * 0.18);
    const period = Math.round(sr / f0);
    for (let i = 0; i < vow; i++) {
      const env = Math.sin((Math.PI * i) / vow) ** 0.7;
      const pulse = i % period === 0 ? 1 : 0;
      pieces.push((f1(pulse) + 0.6 * f2(pulse)) * env * 0.12);
    }
  }
  for (let i = 0; i < sr * 0.05; i++) pieces.push(0);
  return Float32Array.from(pieces);
}

const member = { id: 'c1', name: 'Test', voice: 'alto' };

test('parseWav reads a 16-bit mono PCM file and toWordRate resamples', () => {
  const frames = 4410;
  const buf = new ArrayBuffer(44 + frames * 2);
  const v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + frames * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 44100, true); v.setUint32(28, 88200, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++) v.setInt16(44 + i * 2, Math.round(Math.sin(i / 20) * 16000), true);
  const { samples, sampleRate } = parseWav(buf);
  assert.equal(sampleRate, 44100);
  assert.equal(samples.length, frames);
  assert.ok(Math.abs(samples[100] - Math.sin(100 / 20) * (16000 / 32768)) < 1e-3);
  assert.equal(toWordRate(samples, sampleRate).length, Math.floor(frames / 2));
  assert.throws(() => parseWav(new ArrayBuffer(64)), /not a WAV/);
});

test('analysis finds the pitch, the voiced frames and the syllable nuclei of speech', () => {
  const x = syntheticSpeech({ f0: 120, syllables: 3 });
  const an = analyze(x);
  const f0s = [...an.f0].filter(Boolean).sort((a, b) => a - b);
  assert.ok(f0s.length > 20, 'voiced frames are detected');
  assert.ok(Math.abs(f0s[f0s.length >> 1] - 120) < 4, `median f0 near 120Hz (got ${f0s[f0s.length >> 1]})`);
  const { nuclei } = findNuclei(an);
  assert.equal(nuclei.length, 3, 'one nucleus per vowel');
  assert.ok(nuclei.every((n) => n.coreFrom <= n.peak && n.peak <= n.coreTo));
  assert.ok(pitchMarks(x, an).length >= 3, 'pitch marks exist in each voiced region');
});

test('singLyric re-pitches every vowel onto its planned note and keeps the phrase intact', () => {
  const x = syntheticSpeech({ f0: 120, syllables: 3 });
  const res = singLyric(x, WORD_SR, 'Oh my love', member, 'romantic');
  assert.ok(res, 'a phrase is produced');
  assert.equal(res.heard, 3);
  assert.equal(res.notes.length, 3);
  const out = res.samples;
  assert.ok(out.every(Number.isFinite), 'no NaN/Infinity');
  assert.ok(Math.max(...out.map(Math.abs)) <= 0.61, 'normalised, not clipping');
  const seconds = out.length / WORD_SR;
  assert.ok(seconds > res.notes.at(-1).start, 'long enough to hold every note');

  // measure the sung pitch in the middle of each vowel
  const an = analyze(out, WORD_SR, { maxF0: 1000 });
  res.timeline.forEach((t, i) => {
    const frame = Math.round(((t.vowelStart + t.vowelEnd) / 2 - an.win / 2) / an.hop);
    const near = [-2, -1, 0, 1, 2].map((d) => an.f0[frame + d]).filter(Boolean).sort((a, b) => a - b);
    assert.ok(near.length, `note ${i} is voiced`);
    const cents = Math.abs(1200 * Math.log2(near[near.length >> 1] / midiToHz(res.notes[i].midi)));
    assert.ok(cents < 60, `note ${i} within 60 cents of its target (was ${cents.toFixed(0)})`);
  });
});

test('different voice types are shifted into different registers; the same voice is repeatable', () => {
  const x = syntheticSpeech({ f0: 150, syllables: 3 });
  const run = (voice) => singLyric(x, WORD_SR, 'Ah the night', { id: 'c9', name: 'X', voice }, 'comic');
  const soprano = run('soprano');
  const bass = run('bass');
  const mean = (r) => r.notes.reduce((s, n) => s + n.midi, 0) / r.notes.length;
  assert.ok(mean(soprano) > mean(bass), 'soprano sings above bass');
  assert.deepEqual(Array.from(run('soprano').samples.slice(2000, 2050)), Array.from(soprano.samples.slice(2000, 2050)), 'deterministic');
  assert.ok(formantFor(singerProfile({ id: 'a', voice: 'soprano' })) > formantFor(singerProfile({ id: 'a', voice: 'bass' })), 'brighter formants for higher voices');
});

test('fitRegister keeps the melody within a range the re-pitching handles well', () => {
  const notes = [67, 72, 79].map((midi) => ({ midi }));
  const shift = fitRegister(notes, 110); // 3 x 110 Hz = 330 Hz ~ E4 (64)
  assert.ok(shift < 0);
  assert.ok(midiToHz(Math.max(...notes.map((n) => n.midi))) <= 110 * 3 * 1.06);
  const low = [40, 44].map((midi) => ({ midi }));
  assert.ok(fitRegister(low, 200) > 0, 'too-low notes move up toward the speaker');
  assert.equal(fitRegister([], 120), 0);
});

test('unusable audio returns null instead of throwing', () => {
  assert.equal(singLyric(new Float32Array(100), WORD_SR, 'hi', member, 'comic'), null);
  assert.equal(singLyric(new Float32Array(WORD_SR), WORD_SR, 'hi', member, 'comic'), null, 'silence has no syllables');
});
