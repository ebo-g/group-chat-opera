import 'dotenv/config';
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.SNOWFLAKE_PAT,
  baseURL: process.env.SNOWFLAKE_ACCOUNT_URL + '/api/v2/cortex/v1',
});

const candidates = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['claude-sonnet-4-5', 'claude-4-sonnet', 'claude-3-7-sonnet', 'claude-3-5-sonnet', 'llama3.3-70b', 'mistral-large2', 'openai-gpt-4.1'];

for (const model of candidates) {
  try {
    const r = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: 'Reply with the single word: pong' }],
      max_completion_tokens: 10,
    });
    console.log(`OK   ${model}: ${r.choices[0].message.content.trim()}`);
    process.exit(0);
  } catch (e) {
    // Never print the token; only status + message.
    console.log(`FAIL ${model}: ${e.status ?? ''} ${String(e.message).slice(0, 200)}`);
    if (e.status === 401 || e.status === 403) {
      console.log('Auth failed — stopping.');
      process.exit(1);
    }
  }
}
process.exit(1);
