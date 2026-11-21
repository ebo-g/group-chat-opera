import 'dotenv/config';

export const config = {
  port: 3001,
  // "stub" = offline fake model (no network). "snowflake" = Snowflake Cortex.
  // Set LLM_PROVIDER=snowflake in server/.env once auth works.
  provider: process.env.LLM_PROVIDER || 'stub',
  // Cortex model name (override with LLM_MODEL in .env).
  model: process.env.LLM_MODEL || 'claude-sonnet-4-5',
  maxSenders: 5,
  maxMessages: 120,
  cacheDir: new URL('./.cache/', import.meta.url),
};
