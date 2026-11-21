# group-chat-opera

Upload a WhatsApp chat export and watch it become a comic opera in the browser.
See [CONTRACT.md](CONTRACT.md) for the schema, interfaces and folder ownership.

## Run
Requires Node.js, npm and git.

```sh
# terminal 1 — API on :3001
cd server
cp .env.example .env
npm install
npm start

# terminal 2 — web on :5173 (proxies /api to :3001)
cd web
npm install
npm run dev
```
Open http://localhost:5173.

## Local secrets and ElevenLabs
Each teammate keeps their own `server/.env` on their computer. Git ignores this file; never commit API keys or paste them into GitHub, issues, or group chats. If the team shares one ElevenLabs account, share the key with named teammates using your password manager's secure sharing feature. Otherwise, each teammate can use their own key.

To enable ElevenLabs speech, add the key and voice IDs to `server/.env` using the variable names in `server/.env.example`. Leave `LLM_PROVIDER=stub` for the offline composer. The default melodic mode does not call ElevenLabs; switching to spoken voices uses credits for each lyric line.
