import express from 'express';
import cors from 'cors';
import { readFile } from 'node:fs/promises';
import { config } from './config.js';
import { makeLibretto } from './libretto.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

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

// A funny fictional chat to try the app with.
app.get('/api/sample', async (_req, res) => {
  res.type('text/plain').send(await readFile(new URL('./sample-chat.txt', import.meta.url), 'utf8'));
});

app.listen(config.port, () =>
  console.log(`server on http://localhost:${config.port} (llm: ${config.provider}${config.provider === 'stub' ? '' : '/' + config.model})`),
);
