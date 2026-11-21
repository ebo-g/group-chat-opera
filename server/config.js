import 'dotenv/config';

export const config = {
  port: 3001,
  // "stub" = offline fake model (no network). "snowflake" = Snowflake Cortex.
  // Set LLM_PROVIDER=snowflake in server/.env once auth works.
  provider: process.env.LLM_PROVIDER || 'stub',
  // Cortex model name (override with LLM_MODEL in .env).
  model: process.env.LLM_MODEL || 'claude-sonnet-4-5',
  // ElevenLabs text-to-speech
  ttsModel: process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2',
  ttsTimeoutMs: Number(process.env.ELEVENLABS_TIMEOUT_MS) || 20000, // 20s; override only for tests
  ttsBaseUrl: process.env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io',
  maxSenders: 5,
  maxMessages: 120,
  cacheDir: new URL('./.cache/', import.meta.url),
};
