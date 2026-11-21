import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Placeholder: ignores input and returns the mock libretto.
app.post('/api/libretto', async (_req, res) => {
  try {
    const data = await readFile(path.join(here, 'mock-libretto.json'), 'utf8');
    res.type('json').send(data);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.listen(3001, () => console.log('server on http://localhost:3001'));
