import express from 'express';
import cors from 'cors';
import { readFile } from 'node:fs/promises';
import { config } from './config.js';
import { makeLibretto } from './libretto.js';
import { synthesize, voiceStatus, TtsError } from './tts.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// One log line per API request (method, path, status, ms, cache). Never logs bodies or secrets.
app.use('/api', (req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () =>
    console.log(`${req.method} ${req.baseUrl}${req.path} ${res.statusCode} ${Date.now() - t0}ms${res.get('X-Cache') ? ' cache=' + res.get('X-Cache') : ''}`),
  );
  next();
});

// {chatText} -> libretto JSON
app.post('/api/libretto', async (req, res) => {
  const chatText = req.body?.chatText;
  if (typeof chatText !== 'string' || !chatText.trim()) {
    return res.status(400).json({ error: 'chatText (string) is required' });
  }
  try {
    const { libretto, cached } = await makeLibretto(chatText);
    res.set('X-Cache', cached ? 'HIT' : 'MISS').json(libretto);
  } catch (e) {
    console.error('libretto error:', e.message); // never log tokens or chat content
    res.status(e.status || 500).json({ error: e.message });
  }
});

// {text, castId, voice?} -> audio/mpeg (voice = libretto voice type, optional). On any failure returns JSON {error, code} so the
// frontend can fall back to synth voices. Repeats are served from the disk cache.
app.post('/api/tts', async (req, res) => {
  try {
    const { audio, cached } = await synthesize(req.body?.text, req.body?.castId, req.body?.voice);
    res.set({ 'Content-Type': 'audio/mpeg', 'X-Cache': cached ? 'HIT' : 'MISS' }).send(audio);
  } catch (e) {
    if (!(e instanceof TtsError)) console.error('tts error:', e.message);
    res.status(e.status || 500).json({ error: e.message, code: e.code || 'internal' });
  }
});

// Which ElevenLabs settings are present. true/false only, never the values.
app.get('/api/voice/status', (_req, res) => res.json(voiceStatus()));

// A funny fictional chat to try the app with.
app.get('/api/sample', async (_req, res) => {
  res.type('text/plain').send(await readFile(new URL('./sample-chat.txt', import.meta.url), 'utf8'));
});

app.listen(config.port, () =>
  console.log(`server on http://localhost:${config.port} (llm: ${config.provider}${config.provider === 'stub' ? '' : '/' + config.model})`),
);
