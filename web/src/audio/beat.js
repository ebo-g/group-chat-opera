// Rap mode: a boom-bap drum machine (kick, snare, hats, sub bass) built from plain Web Audio,
// scheduled a little ahead of time so it stays steady while the lines play over it.

const BPM = { tense: 88, romantic: 78, comic: 98, tragic: 72, triumphant: 104 };
const KICK = new Set([0, 7, 10]);
const SNARE = new Set([4, 12]);
const BASS_NOTES = [41, 41, 49, 36]; // E1, E1, G1, C1 (Hz), one per bar

let timer;
let state;

function noiseBuffer(ctx) {
  const length = Math.floor(ctx.sampleRate * 0.4);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 12345;
  for (let i = 0; i < length; i++) data[i] = (((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1);
  return buffer;
}

function kick(ctx, out, at) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.setValueAtTime(150, at);
  osc.frequency.exponentialRampToValueAtTime(42, at + 0.12);
  gain.gain.setValueAtTime(1, at);
  gain.gain.exponentialRampToValueAtTime(0.001, at + 0.32);
  osc.connect(gain).connect(out);
  osc.start(at);
  osc.stop(at + 0.34);
}

function noiseHit(ctx, out, at, { type, freq, duration, level }) {
  const src = ctx.createBufferSource();
  src.buffer = state.noise;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(level, at);
  gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
  src.connect(filter).connect(gain).connect(out);
  src.start(at);
  src.stop(at + duration + 0.02);
}

function sub(ctx, out, at, hz, duration) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = hz;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.linearRampToValueAtTime(0.55, at + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
  osc.connect(gain).connect(out);
  osc.start(at);
  osc.stop(at + duration + 0.02);
}

function schedule(ctx, out, step, at, stepSeconds, bar) {
  if (KICK.has(step)) {
    kick(ctx, out, at);
    if (step === 0 || step === 10) sub(ctx, out, at, BASS_NOTES[bar % BASS_NOTES.length], stepSeconds * 5);
  }
  if (SNARE.has(step)) noiseHit(ctx, out, at, { type: 'bandpass', freq: 1800, duration: 0.18, level: 0.7 });
  if (step % 2 === 0) noiseHit(ctx, out, at + (step % 4 === 2 ? stepSeconds * 0.12 : 0), { type: 'highpass', freq: 7000, duration: 0.05, level: step % 4 === 2 ? 0.28 : 0.16 });
}

export function stopBeat() {
  if (timer) clearInterval(timer);
  timer = undefined;
  if (state?.out) {
    try { state.out.gain.setTargetAtTime(0, state.ctx.currentTime, 0.1); } catch { /* context closed */ }
  }
  state = undefined;
}

/** Seconds per 16th-note step for a mood's tempo. */
export const stepSecondsFor = (mood) => 60 / (BPM[mood] || 95) / 4;

/** Context time of the next bar line (the "one") at least `lead` seconds from now, or null if no beat is playing. */
export function nextBarTime(lead = 0.08) {
  if (!state) return null;
  const bar = state.stepSeconds * 16;
  const now = state.ctx.currentTime + lead;
  return state.anchor + Math.max(0, Math.ceil((now - state.anchor) / bar)) * bar;
}

/** Start (or switch to) the beat for a scene mood. */
export function startBeat(ctx, mood) {
  if (!ctx || ctx.state !== 'running' || typeof ctx.createBuffer !== 'function') return;
  stopBeat();
  const stepSeconds = 60 / (BPM[mood] || 95) / 4;
  const out = ctx.createGain();
  out.gain.value = 0.5;
  out.connect(ctx.destination);
  state = { ctx, out, noise: noiseBuffer(ctx), ducked: false, stepSeconds, anchor: ctx.currentTime + 0.06 };
  let step = 0;
  let bar = 0;
  let next = ctx.currentTime + 0.06;
  const mine = state;
  timer = setInterval(() => {
    if (state !== mine) return;
    while (next < ctx.currentTime + 0.25) {
      schedule(ctx, out, step, next, stepSeconds, bar);
      next += stepSeconds;
      step = (step + 1) % 16;
      if (step === 0) bar += 1;
    }
  }, 50);
}

/** Lower the beat while someone is rapping. */
export function duckBeat(isDucked) {
  if (!state) return;
  state.out.gain.setTargetAtTime(isDucked ? 0.32 : 0.5, state.ctx.currentTime, 0.12);
}
