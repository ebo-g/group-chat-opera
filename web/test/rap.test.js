import assert from 'node:assert/strict';
import test from 'node:test';
import { rapLyric, WORD_SR } from '../src/audio/wordsong.js';
import { scoreBattle, lineScore, lyricsText } from '../src/stage/scorecard.js';

// Synthetic "speech": 5 syllables, each an unvoiced burst + a 150 ms voiced vowel, irregular spacing.
function speech() {
  const sr = WORD_SR;
  const out = [];
  let seed = 11;
  const noise = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const gaps = [0.05, 0.12, 0.05, 0.2, 0.06]; // uneven rhythm
  for (const gap of gaps) {
    for (let i = 0; i < sr * gap; i++) out.push(noise() * 0.04);
    const period = Math.round(sr / 125);
    const n = Math.round(sr * 0.15);
    for (let i = 0; i < n; i++) {
      const env = Math.sin((Math.PI * i) / n) ** 0.7;
      out.push((i % period === 0 ? 1 : 0.0) * env * 0.5 + Math.sin((2 * Math.PI * 700 * i) / sr) * env * 0.08);
    }
  }
  for (let i = 0; i < sr * 0.05; i++) out.push(0);
  return Float32Array.from(out);
}

test('rap flow snaps every vowel onto the 16th-note grid and fits the line into its bars', () => {
  const step = 60 / 98 / 4;
  const res = rapLyric(speech(), WORD_SR, 'Who ate the lasagne now', { id: 'c1', voice: 'tenor' }, { stepSeconds: step, steps: 32 });
  assert.ok(res, 'a line is produced');
  assert.equal(res.slots.length, res.heard);
  for (let i = 1; i < res.slots.length; i++) assert.ok(res.slots[i] > res.slots[i - 1], 'slots strictly increase');
  assert.ok(res.slots.at(-1) < 32, 'fits inside two bars');
  res.timeline.forEach((t, i) => {
    const errMs = Math.abs(t.vowelStart / WORD_SR - res.slots[i] * step) * 1000;
    assert.ok(errMs < step * 1000 * 0.4, `vowel ${i} lands within 40% of a 16th note of its step (${errMs.toFixed(0)}ms)`);
  });
  assert.ok(res.samples.every(Number.isFinite));
  assert.ok(Math.max(...res.samples.map(Math.abs)) <= 0.61, 'normalised');
});

test('rap flow returns null for unusable audio', () => {
  assert.equal(rapLyric(new Float32Array(50), WORD_SR, 'hi', { id: 'c1', voice: 'alto' }, { stepSeconds: 0.15 }), null);
});

const libretto = {
  title: 'The Lasagne Wars',
  cast: [
    { id: 'c1', name: 'Maddie', color: '#ff1744' },
    { id: 'c2', name: 'Josh', color: '#ff9800' },
    { id: 'c3', name: 'Silent Bea' },
  ],
  scenes: [
    { title: 'Round 1', lines: [
      { cast: 'c1', lyric: 'WHO ATE MY LASAGNE?! Thou art a thief, a coward, a knave!' },
      { cast: 'c2', lyric: 'I soaked it, my dear.' },
      { cast: 'c1', lyric: 'Prithee, speak truly?' },
    ] },
  ],
};

test('scorecard ranks MCs, crowns the loudest, and finds the line of the night', () => {
  const { standings, best } = scoreBattle(libretto);
  assert.deepEqual(standings.map((s) => s.member.name), ['Maddie', 'Josh'], 'MCs with no bars are left out');
  assert.equal(standings[0].bars, 4);
  assert.match(best.line.lyric, /LASAGNE/);
  assert.equal(best.member.name, 'Maddie');
  assert.ok(lineScore({ lyric: 'a!!!' }) > lineScore({ lyric: 'a' }));
  assert.deepEqual(scoreBattle({}).standings, []);
});

test('lyrics export is readable plain text', () => {
  const text = lyricsText(libretto);
  assert.match(text, /^The Lasagne Wars/);
  assert.match(text, /== Round 1 ==/);
  assert.match(text, /Maddie: WHO ATE MY LASAGNE/);
});
