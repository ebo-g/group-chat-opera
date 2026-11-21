// Offline test of the TTS layer against a fake ElevenLabs server (no credits, no real key).
import assert from 'node:assert/strict';
import http from 'node:http';
import { rmSync } from 'node:fs';

let mode = 'ok';
let upstreamCalls = 0;
let lastHeaders = null;
const fake = http.createServer((req, res) => {
  upstreamCalls++;
  lastHeaders = { ...req.headers, url: req.url };
  if (mode === 'hang') return; // never respond -> must time out
  if (mode === '401') { res.writeHead(401).end('{"detail":"secret-key-echo"}'); return; }
  setTimeout(() => res.writeHead(200, { 'Content-Type': 'audio/mpeg' }).end(Buffer.from('FAKE-MP3-' + req.url)), 50);
});
await new Promise((r) => fake.listen(0, r));

process.env.ELEVENLABS_BASE_URL = `http://127.0.0.1:${fake.address().port}`;
process.env.ELEVENLABS_TIMEOUT_MS = '400';
process.env.ELEVENLABS_API_KEY = 'test-key';
process.env.ELEVENLABS_VOICE_C1 = 'voiceA';
process.env.ELEVENLABS_VOICE_C2 = 'voiceB';
delete process.env.ELEVENLABS_VOICE_C3;
process.env.ELEVENLABS_VOICE_BARITONE = 'voiceBari';
const { synthesize, voiceStatus, TtsError } = await import('./tts.js');
const { config } = await import('./config.js');
rmSync(new URL('audio/', config.cacheDir), { recursive: true, force: true });

const text = 'Who ate the lasagne?! ' + Date.now();
const err = async (p) => p.then(() => assert.fail('should throw'), (e) => { assert.ok(e instanceof TtsError, e.stack); return e; });

// status: booleans only
const st = voiceStatus();
assert.deepEqual(st.voices, { c1: true, c2: true, c3: false, c4: false, c5: false });
assert.deepEqual(st.byVoiceType, { soprano: false, alto: false, tenor: false, baritone: true, bass: false });
assert.equal(st.key, true);
assert.equal(st.ready, false);
assert.ok(!JSON.stringify(st).includes('voiceA') && !JSON.stringify(st).includes('test-key'), 'status leaks no values');

// miss then hit; second call costs nothing
const a = await synthesize(text, 'c1');
assert.equal(a.cached, false);
assert.equal(upstreamCalls, 1);
assert.equal(lastHeaders['xi-api-key'], 'test-key');
assert.match(lastHeaders.url, /text-to-speech\/voiceA/);
const b = await synthesize(text, 'c1');
assert.equal(b.cached, true);
assert.equal(upstreamCalls, 1, 'repeat served from cache');
assert.deepEqual(a.audio, b.audio);

// cache keyed by castId/voice: same text, other cast -> new call, different voice
const c = await synthesize(text, 'c2');
assert.equal(c.cached, false);
assert.equal(upstreamCalls, 2);
assert.match(lastHeaders.url, /voiceB/);

// concurrent identical requests share one upstream call
const t2 = text + ' again';
const [p, q] = await Promise.all([synthesize(t2, 'c1'), synthesize(t2, 'c1')]);
assert.equal(upstreamCalls, 3);
assert.deepEqual(p.audio, q.audio);

// voice type wins over position; unset type falls back to position
const v1 = await synthesize('by role ' + text, 'c1', 'baritone');
assert.match(lastHeaders.url, /voiceBari/);
assert.equal(v1.cached, false);
const v2 = await synthesize('by role ' + text, 'c1', 'soprano'); // no SOPRANO var -> positional c1 (voiceA)
assert.match(lastHeaders.url, /voiceA/);
assert.equal(v2.cached, false, 'different voice id -> different cache entry');
const v3 = await synthesize('by role ' + text, 'c1', 'baritone');
assert.equal(v3.cached, true);
upstreamCalls = 3; // reset counter for the checks below
// c3 has no positional voice, but a baritone type voice rescues it
assert.equal((await synthesize('rescued', 'c3', 'baritone')).cached, false);
upstreamCalls = 3;
assert.equal((await err(synthesize('hi', 'c1', 'castrato'))).code, 'bad_voice');

// unconfigured voice -> clear 503 with fallback hint, no upstream call
let e = await err(synthesize('hi', 'c3', 'bass'));
assert.deepEqual([e.status, e.code], [503, 'not_configured']);
assert.equal(upstreamCalls, 3);

// validation
assert.equal((await err(synthesize('', 'c1'))).status, 400);
assert.equal((await err(synthesize('hi', 'c9'))).code, 'bad_cast');
assert.equal((await err(synthesize('x'.repeat(1001), 'c1'))).status, 400);

// timeout (400ms in this test; 20s in production) -> 504, and nothing cached
mode = 'hang';
const t0 = Date.now();
e = await err(synthesize('slow ' + Date.now(), 'c1'));
assert.deepEqual([e.status, e.code], [504, 'timeout']);
assert.ok(Date.now() - t0 < 2000, 'aborted promptly');

// upstream auth error -> mapped, upstream body not forwarded
mode = '401';
e = await err(synthesize('auth ' + Date.now(), 'c1'));
assert.equal(e.code, 'upstream_auth');
assert.ok(!e.message.includes('secret-key-echo'));

// production timeout is 20s
delete process.env.ELEVENLABS_TIMEOUT_MS;
const cfg = await import('./config.js?fresh');
assert.equal(cfg.config.ttsTimeoutMs, 20000);

fake.close();
console.log('all tts tests passed');
process.exit(0);
