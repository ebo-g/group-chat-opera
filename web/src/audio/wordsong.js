// Sing real words: take natural speech of the lyric and re-pitch it onto the melody.
//
//   speech (ElevenLabs, or eSpeak in the browser)
//     -> analyse pitch / energy / voicing
//     -> find the syllable nuclei (the vowels) the speech actually contains
//     -> plan a melody with one note per heard syllable (singer.js)
//     -> PSOLA re-synthesis: every vowel is re-pitched to its note and stretched to
//        the note's length, consonants keep their natural speed and shape.
//
// Because consonants and vowel colours are the speaker's own, the words stay
// intelligible (the same trick as "autotuned" speech), unlike the wordless vocalise.
//
// All DSP functions are pure (typed arrays in, typed arrays out) so they can be tested in Node.

import { planFromSyllables, syllabify, singerProfile, midiToHz } from './singer.js';

export const WORD_SR = 22050;
const MIN_F0 = 65;
const MAX_F0 = 420;
// PSOLA degrades when the pitch is moved too far from the speaker's own range.
const MAX_SHIFT_UP = 3;
const MIN_SHIFT_DOWN = 0.7;

// ---------------------------------------------------------------- audio utilities

/** Parse a 16-bit PCM WAV (what meSpeak returns) into Float32 samples. */
export function parseWav(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const tag = (o) => String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
  let offset = 12;
  let sampleRate = WORD_SR;
  let channels = 1;
  let bits = 16;
  while (offset + 8 <= view.byteLength) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ') {
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bits = view.getUint16(offset + 22, true);
    } else if (id === 'data') {
      if (bits !== 16) throw new Error('only 16-bit WAV is supported');
      const start = offset + 8;
      const length = Math.min(size, view.byteLength - start);
      const frames = Math.floor(length / (2 * channels));
      const out = new Float32Array(frames);
      for (let i = 0; i < frames; i++) out[i] = view.getInt16(start + i * 2 * channels, true) / 32768;
      return { samples: out, sampleRate };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error('WAV has no data chunk');
}

/** Resample to WORD_SR with a box low-pass (enough for speech). */
export function toWordRate(samples, sampleRate) {
  if (sampleRate === WORD_SR) return Float32Array.from(samples);
  const ratio = sampleRate / WORD_SR;
  const length = Math.floor(samples.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const a = i * ratio;
    const b = Math.min(samples.length, a + ratio);
    const lo = Math.floor(a);
    let sum = 0;
    let weight = 0;
    for (let k = lo; k < Math.ceil(b); k++) {
      const w = Math.min(k + 1, b) - Math.max(k, a);
      sum += samples[k] * w;
      weight += w;
    }
    out[i] = weight ? sum / weight : 0;
  }
  return out;
}

// ---------------------------------------------------------------- analysis

/** Frame-wise f0 / energy / voicing. Frame f is centred on sample f*hop + win/2. */
export function analyze(x, sr = WORD_SR, { maxF0 = MAX_F0 } = {}) {
  const hop = Math.round(sr * 0.01);
  const win = Math.round(sr * 0.04);
  const minLag = Math.floor(sr / maxF0);
  const maxLag = Math.ceil(sr / MIN_F0);
  const frames = Math.max(0, Math.floor((x.length - win - maxLag) / hop));
  const f0 = new Float32Array(frames);
  const rms = new Float32Array(frames);
  const corr = new Float32Array(frames);

  let maxRms = 1e-9;
  for (let f = 0; f < frames; f++) {
    const s = f * hop;
    let e = 0;
    for (let i = 0; i < win; i++) e += x[s + i] * x[s + i];
    rms[f] = Math.sqrt(e / win);
    maxRms = Math.max(maxRms, rms[f]);
  }

  for (let f = 0; f < frames; f++) {
    if (rms[f] < maxRms * 0.04) continue;
    const s = f * hop;
    let e0 = 0;
    for (let i = 0; i < win; i++) e0 += x[s + i] * x[s + i];
    const scores = new Float32Array(maxLag + 1);
    let best = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let c = 0;
      let el = 0;
      for (let i = 0; i < win; i++) {
        const v = x[s + i + lag];
        c += x[s + i] * v;
        el += v * v;
      }
      const score = c / Math.sqrt(e0 * el + 1e-12);
      scores[lag] = score;
      if (score > best) best = score;
    }
    if (best < 0.55) continue;
    // Prefer the shortest lag that is nearly as good: avoids octave-down errors.
    let lag = minLag;
    for (; lag <= maxLag; lag++) {
      if (scores[lag] >= best * 0.9 && scores[lag] >= scores[lag - 1] && scores[lag] >= (scores[lag + 1] ?? 0)) break;
    }
    // parabolic refinement
    const a = scores[lag - 1] ?? scores[lag];
    const b = scores[lag];
    const c = scores[lag + 1] ?? scores[lag];
    const denom = a - 2 * b + c;
    const shift = denom ? (0.5 * (a - c)) / denom : 0;
    f0[f] = sr / (lag + Math.max(-1, Math.min(1, shift)));
    corr[f] = best;
  }

  // median-smooth f0 over 5 frames (voiced only) and drop isolated voiced frames
  const smooth = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    if (!f0[f]) continue;
    const near = [];
    for (let k = -2; k <= 2; k++) if (f0[f + k]) near.push(f0[f + k]);
    if (near.length < 3) continue;
    near.sort((p, q) => p - q);
    smooth[f] = near[near.length >> 1];
  }
  const voiced = new Uint8Array(frames);
  for (let f = 0; f < frames; f++) voiced[f] = smooth[f] > 0 ? 1 : 0;
  return { sr, hop, win, frames, f0: smooth, rms, voiced, corr, maxRms, center: (f) => f * hop + (win >> 1) };
}

/** Pitch marks (glottal-pulse-like peaks) inside voiced regions. */
export function pitchMarks(x, an) {
  const marks = [];
  const { sr, frames, voiced, f0, center } = an;
  const sm = (i) => (x[i - 1] ?? 0) * 0.25 + x[i] * 0.5 + (x[i + 1] ?? 0) * 0.25;
  const f0At = (pos) => {
    const f = Math.max(0, Math.min(frames - 1, Math.round((pos - (an.win >> 1)) / an.hop)));
    for (let d = 0; d < 6; d++) {
      if (f0[f + d]) return f0[f + d];
      if (f0[f - d]) return f0[f - d];
    }
    return 120;
  };
  let f = 0;
  while (f < frames) {
    if (!voiced[f]) { f++; continue; }
    const start = f;
    while (f < frames && voiced[f]) f++;
    const t0 = center(start) - (an.hop >> 1);
    const t1 = center(f - 1) + (an.hop >> 1);
    let T = sr / f0At(t0);
    let best = Math.round(t0);
    let bv = -Infinity;
    for (let i = Math.round(t0); i < Math.round(t0 + T) && i < x.length; i++) if (sm(i) > bv) { bv = sm(i); best = i; }
    const region = [];
    while (best < t1) {
      region.push(best);
      T = sr / f0At(best);
      const lo = Math.round(best + 0.75 * T);
      const hi = Math.round(best + 1.25 * T);
      let next = lo;
      let nv = -Infinity;
      for (let i = lo; i <= hi && i < x.length - 1; i++) if (sm(i) > nv) { nv = sm(i); next = i; }
      if (next <= best) break;
      best = next;
    }
    if (region.length >= 3) marks.push({ from: region[0], to: region[region.length - 1], marks: region });
  }
  return marks;
}

/** Locate syllable nuclei: smoothed voiced-energy peaks that stand out by >= minProminence dB. */
export function findNuclei(an, { minProminence = 4, minGapSec = 0.07, maxCount = Infinity } = {}) {
  const { frames, voiced, rms, hop, sr } = an;
  const db = new Float32Array(frames);
  for (let f = 0; f < frames; f++) db[f] = 20 * Math.log10(rms[f] + 1e-6);
  const e = new Float32Array(frames);
  for (let f = 0; f < frames; f++) e[f] = ((db[f - 1] ?? db[f]) + 2 * db[f] + (db[f + 1] ?? db[f])) / 4;
  let maxDb = -Infinity;
  for (let f = 0; f < frames; f++) maxDb = Math.max(maxDb, e[f]);

  const peaks = [];
  for (let f = 1; f < frames - 1; f++) {
    if (voiced[f] && e[f] >= e[f - 1] && e[f] > e[f + 1] && e[f] > maxDb - 28) peaks.push(f);
  }
  // Prominence: peak height above the higher of the two valleys that separate it from a taller peak.
  const prominence = (p) => {
    let leftMin = e[p];
    for (let f = p - 1; f >= 0 && e[f] <= e[p]; f--) leftMin = Math.min(leftMin, e[f]);
    let rightMin = e[p];
    for (let f = p + 1; f < frames && e[f] <= e[p]; f++) rightMin = Math.min(rightMin, e[f]);
    return e[p] - Math.max(leftMin, rightMin);
  };
  let cand = peaks.map((p) => ({ p, prom: prominence(p) })).filter((c) => c.prom >= minProminence);
  // enforce a minimum gap, keeping the stronger peak
  const gap = Math.round((minGapSec * sr) / hop);
  cand.sort((a, b) => b.prom - a.prom);
  const kept = [];
  for (const c of cand) if (kept.every((k) => Math.abs(k.p - c.p) >= gap)) kept.push(c);
  let chosen = kept;
  if (chosen.length > maxCount) chosen = [...chosen].sort((a, b) => b.prom - a.prom).slice(0, maxCount);
  chosen.sort((a, b) => a.p - b.p);

  // trim leading/trailing silence for the phrase bounds
  let first = 0;
  while (first < frames && rms[first] < an.maxRms * 0.05) first++;
  let last = frames - 1;
  while (last > first && rms[last] < an.maxRms * 0.05) last--;

  // boundaries between nuclei: middle of the longest unvoiced run, else the quietest frame
  const bounds = [first];
  for (let k = 0; k + 1 < chosen.length; k++) {
    const a = chosen[k].p;
    const b = chosen[k + 1].p;
    let runStart = -1;
    let bestRun = [0, -1];
    for (let f = a; f <= b; f++) {
      if (!voiced[f]) {
        if (runStart < 0) runStart = f;
        if (f - runStart > bestRun[1] - bestRun[0]) bestRun = [runStart, f];
      } else runStart = -1;
    }
    let boundary;
    if (bestRun[1] - bestRun[0] >= 2) boundary = (bestRun[0] + bestRun[1]) >> 1;
    else {
      boundary = a;
      for (let f = a; f <= b; f++) if (e[f] < e[boundary]) boundary = f;
    }
    bounds.push(boundary);
  }
  bounds.push(last);

  const nuclei = chosen.map((c, k) => {
    let l = c.p;
    let r = c.p;
    const floor = e[c.p] - 8;
    while (l - 1 > bounds[k] && voiced[l - 1] && e[l - 1] >= floor) l--;
    while (r + 1 < bounds[k + 1] && voiced[r + 1] && e[r + 1] >= floor) r++;
    return { peak: c.p, prominence: c.prom, from: bounds[k], to: bounds[k + 1], coreFrom: l, coreTo: r };
  });
  return { nuclei, first, last };
}

// ---------------------------------------------------------------- PSOLA singing

function hann(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / n);
  return w;
}

/**
 * Re-pitch/re-time `x` according to `plan`. Returns Float32Array at WORD_SR.
 * `nuclei` are the syllable nuclei heard in x (one per plan note).
 */
export function singify(x, an, marks, nuclei, plan, profile, { vibrato = true, formant = 1 } = {}) {
  const sr = an.sr;
  const sec = (s) => Math.round(s * sr);
  const frameSample = (f) => an.center(f) - (an.hop >> 1); // start of frame f's "own" hop
  // ---- output timeline: per syllable [onset | vowel | coda], consonants at natural speed
  const parts = [];
  let cursor = sec(0.03);
  const notes = plan.notes;
  const timeline = [];
  nuclei.forEach((nu, i) => {
    const note = notes[i];
    const s0 = frameSample(nu.from);
    const s1 = frameSample(nu.to);
    const c0 = frameSample(nu.coreFrom);
    const c1 = frameSample(nu.coreTo + 1);
    const onset = Math.max(0, c0 - s0);
    const coda = Math.max(0, s1 - c1);
    const core = Math.max(sec(0.02), c1 - c0);
    const slot = sec(note.dur);
    const wanted = slot - onset - coda;
    const vowel = Math.max(Math.round(core * 0.6), sec(0.05), wanted);
    const gapAfter = i + 1 < notes.length ? Math.max(0, sec(notes[i + 1].start - (note.start + note.dur))) : 0;
    const start = Math.max(cursor, sec(note.start)); // never earlier than the plan (rap grid)
    parts.push({ out: [start, start + onset], src: [s0, c0], kind: 'onset', i });
    parts.push({ out: [start + onset, start + onset + vowel], src: [c0, c1], kind: 'vowel', i });
    parts.push({ out: [start + onset + vowel, start + onset + vowel + coda], src: [c1, s1], kind: 'coda', i });
    timeline.push({ start, vowelStart: start + onset, vowelEnd: start + onset + vowel, end: start + onset + vowel + coda, i });
    cursor = start + onset + vowel + coda + gapAfter;
  });
  const total = cursor + sec(0.25);
  const out = new Float32Array(total);
  const weight = new Float32Array(total);

  // ---- target pitch at an output position
  const noteHz = notes.map((n) => midiToHz(n.midi));
  const segmentAt = (pos) => {
    for (let k = timeline.length - 1; k >= 0; k--) if (pos >= timeline[k].start) return k;
    return 0;
  };
  const targetHz = (pos) => {
    const k = segmentAt(pos);
    const seg = timeline[k];
    const prev = noteHz[k - 1] ?? noteHz[k];
    const glide = Math.min(1, (pos - seg.start) / sec(0.06)); // portamento into the note
    const smooth = glide * glide * (3 - 2 * glide);
    let hz = prev * (noteHz[k] / prev) ** smooth;
    if (vibrato) {
      const held = (pos - seg.vowelStart) / sr;
      if (held > 0.25) {
        const depth = Math.min(1, (held - 0.25) / 0.3) * profile.vibratoCents;
        hz *= 2 ** ((depth * Math.sin(2 * Math.PI * profile.vibratoHz * held)) / 1200);
      }
    }
    return hz;
  };

  // ---- lookup helpers over the source
  const allMarks = marks.flatMap((r) => r.marks);
  const voicedAt = (s) => {
    const f = Math.round((s - (an.win >> 1)) / an.hop);
    return f >= 0 && f < an.frames && an.voiced[f] === 1;
  };
  const nearestMark = (s) => {
    let lo = 0;
    let hi = allMarks.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (allMarks[mid] < s) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && Math.abs(allMarks[lo - 1] - s) < Math.abs(allMarks[lo] - s)) lo -= 1;
    return lo;
  };

  const unvoicedHop = sec(0.005);
  const unvoicedWin = hann(unvoicedHop * 2);
  // alpha > 1 reads the grain faster (shorter, formants up); alpha < 1 slower (formants down).
  const addGrain = (center, srcCenter, half, win, alpha = 1) => {
    for (let i = -half; i < half; i++) {
      const o = center + i;
      if (o < 0 || o >= total) continue;
      const pos = srcCenter + i * alpha;
      const s0 = Math.floor(pos);
      if (s0 < 0 || s0 + 1 >= x.length) continue;
      const frac = pos - s0;
      const w = win[i + half];
      out[o] += (x[s0] * (1 - frac) + x[s0 + 1] * frac) * w;
      weight[o] += w;
    }
  };

  for (const part of parts) {
    const [o0, o1] = part.out;
    const [a0, a1] = part.src;
    if (o1 <= o0 || a1 <= a0) continue;
    const rate = (a1 - a0) / (o1 - o0);
    let pos = o0;
    while (pos < o1) {
      const s = a0 + (pos - o0) * rate;
      if (allMarks.length && voicedAt(Math.round(s))) {
        const k = nearestMark(s);
        const left = allMarks[k] - (allMarks[k - 1] ?? allMarks[k] - sec(0.008));
        const right = (allMarks[k + 1] ?? allMarks[k] + sec(0.008)) - allMarks[k];
        const period = Math.max(sec(0.002), Math.min(sec(0.02), Math.round((left + right) / 2)));
        const half = Math.max(2, Math.round(period / formant));
        addGrain(Math.round(pos), allMarks[k], half, hann(half * 2), formant);
        pos += Math.max(sec(0.0015), Math.round(sr / targetHz(pos)));
      } else {
        addGrain(Math.round(pos), Math.round(s), unvoicedHop, unvoicedWin);
        pos += unvoicedHop;
      }
    }
  }

  let peak = 0;
  for (let i = 0; i < total; i++) {
    out[i] = weight[i] > 1e-3 ? out[i] / Math.max(weight[i], 0.35) : 0;
    peak = Math.max(peak, Math.abs(out[i]));
  }
  // gentle fades and normalise
  const fade = sec(0.01);
  for (let i = 0; i < fade && i < total; i++) { out[i] *= i / fade; out[total - 1 - i] *= i / fade; }
  const gain = peak > 0 ? 0.6 / peak : 1;
  for (let i = 0; i < total; i++) out[i] *= gain;
  return { samples: out, timeline };
}

// Vocal-tract (formant) scaling per voice type: brighter for high voices, darker for low ones.
const FORMANT_BY_VOICE = { soprano: 1.2, alto: 1.1, tenor: 1, baritone: 0.94, bass: 0.88 };
/** strength: 1 for the synthetic eSpeak voice, less for natural voices that already differ. */
export function formantFor(profile, strength = 1) {
  return (FORMANT_BY_VOICE[profile.voice] ?? 1) ** strength * profile.formantSize;
}

export function medianF0(an) {
  const v = [...an.f0].filter(Boolean).sort((a, b) => a - b);
  return v.length ? v[v.length >> 1] : 120;
}

/**
 * Transpose the planned melody (in place) so it stays within a range PSOLA handles well
 * relative to the speaker's own pitch: highest note <= 3x speech f0, lowest >= 0.7x.
 * Returns the number of semitones applied.
 */
export function fitRegister(notes, speechF0) {
  if (!notes.length) return 0;
  const hz = notes.map((n) => midiToHz(n.midi));
  const hi = Math.max(...hz);
  const lo = Math.min(...hz);
  let shift = 0;
  if (hi > speechF0 * MAX_SHIFT_UP) shift = -Math.ceil(12 * Math.log2(hi / (speechF0 * MAX_SHIFT_UP)));
  if (lo * 2 ** (shift / 12) < speechF0 * MIN_SHIFT_DOWN) {
    const up = Math.ceil(12 * Math.log2((speechF0 * MIN_SHIFT_DOWN) / (lo * 2 ** (shift / 12))));
    shift = Math.min(shift + up, Math.floor(12 * Math.log2((speechF0 * MAX_SHIFT_UP) / hi)));
  }
  if (shift) for (const n of notes) n.midi += shift;
  return shift;
}

/**
 * RAP FLOW: instead of a melody, lock the speech to the beat. Every syllable nucleus is moved to
 * the nearest 16th-note step of a `steps`-step grid (2 bars by default), keeping the speaker's own
 * pitch contour and natural vowel/consonant lengths, so the line grooves with the drums.
 * Buffer time 0 is the downbeat of the first bar. Returns null when the speech is unusable.
 */
export function rapLyric(speech, sampleRate, text, member, { stepSeconds, steps = 32 }, { formantStrength = 0.5 } = {}) {
  const x = toWordRate(speech, sampleRate);
  const an = analyze(x, WORD_SR);
  if (an.frames < 10) return null;
  const { nuclei } = findNuclei(an, {});
  if (!nuclei.length) return null;
  const marks = pitchMarks(x, an);
  if (!marks.length) return null;
  const sr = an.sr;
  const frameSample = (f) => an.center(f) - (an.hop >> 1);
  const speechF0 = medianF0(an);
  const coreF0 = (nu) => {
    const v = [];
    for (let f = nu.coreFrom; f <= nu.coreTo; f++) if (an.f0[f]) v.push(an.f0[f]);
    v.sort((a, b) => a - b);
    return v.length ? v[v.length >> 1] : speechF0;
  };

  // natural vowel-peak times, then compress/expand (within limits) to fill the bars, then snap to steps
  const peakT = nuclei.map((nu) => frameSample(nu.peak) / sr);
  const natural = Math.max(0.2, peakT[peakT.length - 1] - peakT[0]);
  const usable = Math.max(8, steps - 4) * stepSeconds;
  const scale = Math.max(0.55, Math.min(1.2, usable / natural));
  const lead = 2; // start two 16ths into the bar so the first word lands just after the one
  const slots = [];
  nuclei.forEach((_, j) => {
    let slot = lead + Math.round(((peakT[j] - peakT[0]) * scale) / stepSeconds);
    if (j > 0 && slot <= slots[j - 1]) slot = slots[j - 1] + 1;
    slots.push(slot);
  });

  const notes = nuclei.map((nu, j) => {
    const onset = Math.max(0, (frameSample(nu.coreFrom) - frameSample(nu.from)) / sr);
    const total = Math.max(0.08, (frameSample(nu.to) - frameSample(nu.from)) / sr);
    return {
      midi: 69 + 12 * Math.log2(coreF0(nu) / 440),
      start: Math.max(0, slots[j] * stepSeconds - onset), // the vowel, not the consonant, sits on the grid
      dur: total, // natural length: no held vowels in rap
    };
  });
  const profile = singerProfile(member);
  const { samples, timeline } = singify(x, an, marks, nuclei, { notes }, profile, { vibrato: false, formant: formantFor(profile, formantStrength) });
  return { samples, sampleRate: WORD_SR, notes, heard: nuclei.length, expected: syllabify(text).length, slots, timeline, nuclei, steps };
}

/**
 * Full pipeline for one line: speech samples -> sung samples.
 * Returns {samples, sampleRate, notes, heard, expected} or null when the speech has no usable syllables.
 */
export function singLyric(speech, sampleRate, text, member, mood, { formantStrength = 1 } = {}) {
  const x = toWordRate(speech, sampleRate);
  const an = analyze(x, WORD_SR);
  if (an.frames < 10) return null;
  const expected = syllabify(text);
  const maxCount = expected.length > 3 ? Math.ceil(expected.length * 1.3) : Infinity;
  const { nuclei } = findNuclei(an, { maxCount });
  if (!nuclei.length) return null;
  const marks = pitchMarks(x, an);
  if (!marks.length) return null;

  // one syllable descriptor per nucleus, spread over the lyric's own stress/breath/punctuation flags
  const n = Math.max(1, expected.length);
  const m = nuclei.length;
  const syl = nuclei.map((_, j) => {
    const idx = m === 1 ? n - 1 : Math.round((j * (n - 1)) / (m - 1));
    return { ...(expected[idx] || { vowel: 'a', stress: 1, breath: 0, end: '' }) };
  });
  const plan = planFromSyllables(syl, member, mood, text);
  const speechF0 = medianF0(an);
  const transposed = fitRegister(plan.notes, speechF0);
  const profile = singerProfile(member);
  const { samples, timeline } = singify(x, an, marks, nuclei, plan, profile, { formant: formantFor(profile, formantStrength) });
  return { samples, sampleRate: WORD_SR, notes: plan.notes, heard: m, expected: expected.length, speechF0, transposed, timeline, nuclei };
}
