# group-chat-rap

Upload a WhatsApp chat export and watch it become a Shakespearean-English rap battle in the browser: animated MCs, a drum beat, and spoken bars.
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

## How the rap works
- The server (`genre: "rap"`, the default) rewrites the chat as three rounds of rhymed couplets in Shakespearean English.
- Each MC speaks their bars over a drum beat. The voice is ElevenLabs when `ELEVENLABS_API_KEY` and a voice for that character's voice type are set in `server/.env` (cached on disk, so replays are free); otherwise the browser's speech voices.
- **Beat-locked flow:** every line's speech is analysed (pitch, syllables), each vowel is snapped onto the 16th-note grid of the drum machine with PSOLA re-synthesis, and the line starts on the next bar, so the bars actually land on the beat (`web/src/audio/wordsong.js`, `beat.js`).
- **Speech source, per line:** ElevenLabs when configured, otherwise free in-browser eSpeak, otherwise the browser's own voices.
- **Finale:** a scorecard crowns the champion MC, quotes the line of the night, and saves the lyrics.
- The opera code (sung melodies, orchestra) is still in the repo but unused.

## The pitch: where code meets culture
Group chats are the folk literature of our generation: feuds, inside jokes, "seen" at 3am. We remix that story into two older cultures at once: **Shakespeare's language** and **hip-hop's battle tradition**. Upload a WhatsApp export and your chat becomes a three-round rap battle in early-modern English, performed by animated MCs over a live-synthesised beat, with voices you can rename and recast, ending in a scorecard that crowns your friend group's champion.

Under the hood: an LLM turns the most dramatic stretch of the chat into rhymed couplets; a from-scratch DSP engine (pitch tracking, syllable detection, PSOLA) retunes natural speech onto the beat grid; everything is cached, offline-capable, and degrades gracefully.
