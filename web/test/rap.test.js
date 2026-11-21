import assert from 'node:assert/strict';
import test from 'node:test';
import { rapLyric, analyze, medianF0, WORD_SR } from '../src/audio/wordsong.js';
import { scoreBattle, lineScore, lyricsText } from '../src/stage/scorecard.js';

// Synthetic "speech": 5 syllables, each an unvoiced burst + a 150 ms voiced vowel, irregular spacing.
function speech() {
  const sr = WORD_SR;
  const out = [];
  let seed = 11;
  const noise = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  for (const gap of [0.05, 0.12, 0.05, 0.2, 0.06]) {
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

const step = 60 / 98 / 4;

test('rap flow keeps the speech continuous: same pitch, natural pacing, fits inside its two bars', () => {
  const x = speech();
  const res = rapLyric(x, WORD_SR, 'Who ate the lasagne now', { id: 'c1', voice: 'tenor' }, { stepSeconds: step, steps: 32 });
  assert.ok(res, 'a line is produced');
  assert.ok(res.samples.every(Number.isFinite), 'no NaN/Infinity');
  assert.ok(Math.max(...res.samples.map(Math.abs)) <= 0.61, 'normalised, not clipping');
  assert.ok(res.ratio >= 0.85 && res.ratio <= 1.0, `tempo change stays gentle and never slows the speaker (x${res.ratio})`);
  assert.ok(res.samples.length / WORD_SR <= 32 * step, 'fits within two bars');
  // pitch is untouched (this is time-scaling, not re-pitching)
  const before = medianF0(analyze(x));
  const after = medianF0(analyze(res.samples));
  assert.ok(Math.abs(1200 * Math.log2(after / before)) < 60, `pitch preserved (${before.toFixed(0)}Hz -> ${after.toFixed(0)}Hz)`);
  // it starts right away so the line lands on the bar line
  const firstSound = res.samples.findIndex((v) => Math.abs(v) > 0.05);
  assert.ok(firstSound / WORD_SR < 0.25, 'starts within 250ms of the bar line');
});

test('rap flow adds no dead air compared with the original speech', () => {
  const silentFraction = (data) => {
    const w = Math.round(WORD_SR * 0.01);
    const e = [];
    for (let i = 0; i + w < data.length; i += w) {
      let s = 0;
      for (let k = 0; k < w; k++) s += data[i + k] ** 2;
      e.push(Math.sqrt(s / w));
    }
    const peak = Math.max(...e);
    let a = 0;
    while (a < e.length && e[a] < peak * 0.03) a++;
    let b = e.length - 1;
    while (b > a && e[b] < peak * 0.03) b--;
    return e.slice(a, b + 1).filter((v) => v < peak * 0.03).length / Math.max(1, b - a);
  };
  const x = speech();
  const res = rapLyric(x, WORD_SR, 'Who ate the lasagne now', { id: 'c1', voice: 'alto' }, { stepSeconds: step, steps: 32 });
  assert.ok(silentFraction(res.samples) <= silentFraction(x) + 0.08, 'no new gaps between syllables');
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
