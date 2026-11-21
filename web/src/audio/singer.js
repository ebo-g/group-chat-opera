// Opera singing engine: one fixed, recognisable voice per character.
//
// Browsers cannot synthesise sung *words*, so each lyric is sung as a vocalise:
// the notes follow the lyric's real syllables and rhythm (stressed syllables
// last longer, commas breathe, the last syllable is held on a cadence) and the
// vowel shape of every note is the lyric's own vowel. The words themselves are
// shown as surtitles, as in real opera.
//
// Everything here is DETERMINISTIC: a character's timbre, range, vibrato and
// signature motif come only from (id, voice, sex), so every line sung by the
// same character uses exactly the same voice.

export const VOICE_TYPES = ['soprano', 'alto', 'tenor', 'baritone', 'bass'];
const FEMALE_VOICES = ['soprano', 'alto'];

// Tonic (MIDI) per register; melodies span roughly one octave above it.
const TONIC = { soprano: 67, alto: 60, tenor: 55, baritone: 48, bass: 41 };
const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
// unit = seconds per ordinary syllable
const MOOD_STYLE = {
  comic: { scale: 'major', unit: 0.23 },
  tense: { scale: 'minor', unit: 0.27 },
  romantic: { scale: 'major', unit: 0.36 },
  tragic: { scale: 'minor', unit: 0.42 },
  triumphant: { scale: 'major', unit: 0.28 },
};
// Low voices put less energy through the vowel filters, so they need more gain to sound equally loud.
const LEVEL = { soprano: 1.65, alto: 2.45, tenor: 2.9, baritone: 2.35, bass: 3.3 };
const MAX_SECONDS = 11;
const MIN_UNIT = 0.14;
const MAX_SYLLABLES = 56; // longer lyrics are sung in part; the surtitle still shows all of it

// Formant centres (Hz) for the vowels: [F1, F2, F3]. Female formants sit higher.
const FORMANTS = {
  male: { a: [730, 1090, 2440], e: [530, 1840, 2480], i: [270, 2290, 3010], o: [570, 840, 2410], u: [300, 870, 2240] },
  female: { a: [850, 1220, 2810], e: [610, 2330, 2990], i: [310, 2790, 3310], o: [590, 920, 2710], u: [370, 950, 2670] },
};

function hash(value) {
  let h = 2166136261;
  for (const ch of String(value)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sexOf(member) {
  if (member?.sex === 'female' || member?.sex === 'male') return member.sex;
  return FEMALE_VOICES.includes(member?.voice) ? 'female' : 'male';
}

/** Stable identity of a singer; the voice is rebuilt only if one of these changes. */
export function singerKey(member) {
  return String(member?.id ?? member?.name ?? 'chorus');
}

/** Everything that makes a character sound like themselves. Pure and deterministic. */
export function singerProfile(member) {
  const voice = VOICE_TYPES.includes(member?.voice) ? member.voice : sexOf(member) === 'female' ? 'alto' : 'tenor';
  const sex = sexOf(member);
  const h = hash(`${singerKey(member)}|${voice}|${sex}`);
  const r = rng(h);
  // Signature motif: a short, fixed contour (scale-degree steps) every line of this character starts with.
  const motif = [[0, 2, 4][Math.floor(r() * 3)]];
  for (let i = 1; i < 5; i++) motif.push(Math.max(0, Math.min(7, motif[i - 1] + [-2, -1, 1, 1, 2, 3][Math.floor(r() * 6)])));
  return {
    voice,
    sex,
    tonic: TONIC[voice],
    formantSize: 1 + (r() - 0.5) * 0.1, // +-5%: a slightly different "throat" per character
    vibratoHz: 5.0 + r() * 1.0,
    vibratoCents: 16 + r() * 10,
    detuneCents: 5 + r() * 6,
    motif,
  };
}

function vowelOf(group) {
  if (/ee|ea|ie|ey/.test(group)) return 'i';
  if (/oo|ou|ew|ue|ui/.test(group)) return 'u';
  if (/oa|ow|oi|oy/.test(group)) return 'o';
  if (/ai|ay|ei|ea/.test(group)) return 'e';
  if (/au|aw/.test(group)) return 'a';
  const first = group[0];
  return first === 'y' ? 'i' : 'aeiou'.includes(first) ? first : 'a';
}

/** Lyric -> syllables [{vowel, stress, breath}] using the lyric's own vowels. */
export function syllabify(text) {
  const out = [];
  for (const raw of String(text || '').split(/\s+/)) {
    const word = raw.toLowerCase().replace(/[^a-z']/g, '');
    if (!word) continue;
    const groups = word.match(/[aeiouy]+/g) || [];
    let count = groups.length;
    if (count > 1 && /[^aeiouy]e$/.test(word) && !/le$/.test(word)) count -= 1; // silent final e
    count = Math.max(1, count);
    const trailing = (raw.match(/[,;:.!?…—-]+$/) || [''])[0];
    for (let i = 0; i < count; i++) {
      out.push({
        vowel: vowelOf(groups[Math.min(i, groups.length - 1)] || 'a'),
        stress: i === 0 ? 1.35 : 1,
        breath: i === count - 1 && /[,;:]/.test(trailing) ? 1 : 0,
        end: i === count - 1 ? trailing : '',
      });
    }
  }
  return out;
}

/**
 * Plan one sung phrase. Returns {notes:[{midi, start, dur, vowel, rest}], total}.
 * Same (character, lyric, mood) always gives the same phrase.
 */
export function planPhrase(text, member, mood) {
  const profile = singerProfile(member);
  const style = MOOD_STYLE[mood] || MOOD_STYLE.comic;
  const scale = SCALES[style.scale];
  const syl = syllabify(text);
  if (syl.length > MAX_SYLLABLES) syl.splice(MAX_SYLLABLES - 1, syl.length - MAX_SYLLABLES); // keep the final (cadence) syllable
  if (!syl.length) syl.push({ vowel: 'a', stress: 1, breath: 0, end: '' });
  const n = syl.length;
  const last = syl[n - 1];
  const question = /\?/.test(last.end);
  const exclaim = /!/.test(last.end);
  const r = rng(hash(`${singerKey(member)}|${text}`));

  // Melody as scale degrees: the character's motif first, then a stepwise arch back to a cadence.
  const deg = [];
  for (let i = 0; i < n; i++) {
    if (i < profile.motif.length) deg.push(profile.motif[i]);
    else {
      const down = i > n * 0.55 ? 1.6 : 1; // steer downward toward the cadence
      const step = [-2, -1, -1, 0, 1, 1, 2, 3][Math.floor(r() * 8)];
      let next = deg[i - 1] + (step > 0 ? Math.round(step / down) : step);
      if (next < 0) next = -next;
      if (next > 8) next = 16 - next;
      deg.push(next);
    }
  }
  if (exclaim && n > 3) deg[Math.max(0, n - 3)] = 8; // a ringing high note before the end
  deg[n - 1] = question ? 1 : last.end.includes(',') ? 4 : 0; // question hangs, comma half-closes, else tonic
  if (n >= 2) deg[n - 2] = deg[n - 1] + 1; // a step above the final note leads into the cadence

  const toMidi = (d) => profile.tonic + 12 * Math.floor(d / 7) + scale[((d % 7) + 7) % 7];

  const rawNotes = [];
  let units = 0;
  for (let i = 0; i < n; i++) {
    const isLast = i === n - 1;
    let weight = syl[i].stress * (i === n - 2 ? 1.2 : 1);
    if (isLast) weight = 3;
    else if (syl[i].breath) weight *= 1.5;
    const rest = syl[i].breath ? 0.4 : 0;
    rawNotes.push({ midi: toMidi(deg[i]), vowel: syl[i].vowel, weight, rest });
    units += weight + rest;
  }
  const unit = Math.max(MIN_UNIT, Math.min(style.unit, MAX_SECONDS / units));
  const notes = [];
  let t = 0.04;
  for (const note of rawNotes) {
    const slot = note.weight * unit;
    notes.push({ midi: note.midi, vowel: note.vowel, start: t, dur: slot, rest: note.rest > 0 });
    t += slot + note.rest * unit;
  }
  return { notes, total: t };
}

const midiToHz = (midi) => 440 * 2 ** ((midi - 69) / 12);

const buses = new WeakMap();
function voiceBus(ctx, destination) {
  let bus = buses.get(ctx);
  if (bus) return bus;
  const dry = ctx.createGain();
  dry.gain.value = 0.9;
  dry.connect(destination);
  bus = { input: dry };
  // A little concert-hall reverb where the browser supports it.
  if (typeof ctx.createConvolver === 'function' && typeof ctx.createBuffer === 'function') {
    try {
      const length = Math.floor(ctx.sampleRate * 1.6);
      const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
      const seed = rng(1234);
      for (let c = 0; c < 2; c++) {
        const data = impulse.getChannelData(c);
        for (let i = 0; i < length; i++) data[i] = (seed() * 2 - 1) * (1 - i / length) ** 2.5;
      }
      const verb = ctx.createConvolver();
      verb.buffer = impulse;
      const wet = ctx.createGain();
      wet.gain.value = 0.22;
      dry.connect(verb);
      verb.connect(wet);
      wet.connect(destination);
    } catch {
      /* dry voice only */
    }
  }
  buses.set(ctx, bus);
  return bus;
}

/**
 * Schedule a planned phrase on any (Offline)AudioContext starting at `when`.
 * One sawtooth pair -> three vowel formant filters -> amplitude envelope, with vibrato.
 */
export function schedulePhrase(ctx, destination, plan, member, when = ctx.currentTime) {
  const profile = singerProfile(member);
  const table = FORMANTS[profile.sex];
  const bus = voiceBus(ctx, destination);
  const end = when + plan.total;

  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, when);
  amp.connect(bus.input);

  const filters = [0, 1, 2].map((k) => {
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    if (f.Q) f.Q.value = [9, 11, 13][k];
    const g = ctx.createGain();
    g.gain.value = [1, 0.55, 0.3][k];
    f.connect(g);
    g.connect(amp);
    return f;
  });

  const oscillators = [0, 1].map((i) => {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    if (o.detune) o.detune.value = i ? profile.detuneCents : -profile.detuneCents;
    for (const f of filters) o.connect(f);
    return o;
  });

  // Vibrato: delayed onset, like a trained singer's.
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = profile.vibratoHz;
  const lfoGain = ctx.createGain();
  lfoGain.gain.setValueAtTime(0, when);
  lfoGain.gain.linearRampToValueAtTime(profile.vibratoCents, when + 0.5);
  lfo.connect(lfoGain);
  for (const o of oscillators) if (o.detune) lfoGain.connect(o.detune);

  const peak = 0.17 * LEVEL[profile.voice];
  plan.notes.forEach((note, i) => {
    const start = when + note.start;
    const stop = start + note.dur;
    const hz = midiToHz(note.midi);
    for (const o of oscillators) {
      if (i === 0) o.frequency.setValueAtTime(hz, start);
      else o.frequency.setTargetAtTime(hz, start, 0.03); // legato glide between notes
    }
    const formants = table[note.vowel].map((f) => f * profile.formantSize);
    filters.forEach((f, k) => {
      if (i === 0) f.frequency.setValueAtTime(formants[k], start);
      else f.frequency.setTargetAtTime(formants[k], start, 0.035);
    });
    const next = plan.notes[i + 1];
    const phraseEnd = !next || note.rest;
    amp.gain.setTargetAtTime(peak, start, 0.03); // attack
    amp.gain.setTargetAtTime(phraseEnd ? 0.0001 : peak * 0.45, stop - 0.05, 0.03); // release / legato dip
  });

  for (const o of [...oscillators, lfo]) {
    o.start(when);
    o.stop(end + 0.6);
  }
  return { duration: plan.total };
}

/** Plan + schedule in one call. Returns the phrase duration in seconds. */
export function singPhrase(ctx, destination, text, member, mood, when) {
  const plan = planPhrase(text, member, mood);
  schedulePhrase(ctx, destination, plan, member, when);
  return plan.total;
}
