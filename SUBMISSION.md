# MLH First Year Hack: submission details (event slug: `first-year-hack`)

Everything the DevRelay submission needs, so a fresh session can submit without re-researching.
Deadline: **Nov 21, 6:00 PM UTC**.

## Project
- **Name:** GroupChatRap
- **short_description (one line):** Drop in a WhatsApp group chat and watch your friends battle it out as rappers, spitting your own messages as Shakespearean-English bars over a live-synthesised beat.
- **GitHub:** https://github.com/ebo-g/group-chat-opera  (the repo is still named `group-chat-opera`; the project is GroupChatRap)
- **Demo video:** https://youtu.be/6syJxDTKhk4  (YouTube, unlisted)
- **Live demo:** none: runs locally (`server`: `npm start` on :3001, `web`: `npm run dev` on :5173)
- **extra_links:** `Demo video` → https://youtu.be/6syJxDTKhk4  (use only if the form has no dedicated demo-video field)

## Description (based on the README)
Group chats are the folk literature of our generation: feuds, inside jokes, "seen" at 3am. GroupChatRap remixes that story into two older cultures at once: **Shakespeare's language** and **hip-hop's battle tradition**.

Upload a WhatsApp export (or use the built-in sample). The server parses the chat (Android and iOS formats, multi-line messages, system lines and phone numbers stripped), keeps the five most active people and the most dramatic stretch, and asks an LLM to rewrite it as a three-round rap battle in early-modern English: rhymed couplets that quote and paraphrase the real messages, with each person cast as an MC persona. The browser then performs it: animated MCs in caps, shades and gold chains on a neon stage, a drum beat synthesised live with the Web Audio API (kick, snare, hats, sub bass, tempo set by each scene's mood), and a different voice per MC. A Meet-the-MCs screen lets you rename characters, set their sex and voice, and preview them before the battle. At the end a scorecard crowns the champion MC, quotes the line of the night, and lets you save the lyrics.

Voices come from ElevenLabs when a key is configured (cached on disk so replays cost nothing), otherwise from the browser's natural speech voices. Under the hood there is also a from-scratch DSP engine (pitch tracking, syllable detection, PSOLA re-synthesis) for retuning and time-scaling speech. Everything is cached, falls back gracefully, and has automated tests (34 web tests plus server tests).

## Technologies
JavaScript (ES modules), Node.js, Express, Vite, Web Audio API, Web Speech API (SpeechSynthesis), Web Workers, SVG, Snowflake Cortex (OpenAI-compatible Chat Completions API, `claude-sonnet-4-5`), `openai` npm SDK, ElevenLabs text-to-speech API (optional), Tone.js, eSpeak/meSpeak (fallback speech source), custom PSOLA DSP.

AI APIs/models the project calls: **Snowflake Cortex, model `claude-sonnet-4-5`** (lyrics); **ElevenLabs TTS** (optional voices).

## ai_tools (your own harness and model only)
- harness: `claude-code`
- model: `coding:anthropic/claude-sonnet-5.5`  (exact id: `claude-sonnet-5-5`; match DevRelay's accepted format)

## Prize categories and sponsor_usage answers
### Best Use of Snowflake
GroupChatRap's lyric engine runs on Snowflake Cortex: the server calls Cortex's OpenAI-compatible Chat Completions endpoint (`/api/v2/cortex/v1`) with a Snowflake programmatic access token and the `claude-sonnet-4-5` model to turn the most dramatic stretch of a group chat into a three-round rap battle in Shakespearean English. We validate the JSON against our libretto schema, retry once on invalid output, and cache every result on disk by input hash, so the Cortex call is made once per chat.

### Creative Tech
It remixes culture in a way people can feel in 30 seconds: your own group chat becomes a Shakespearean rap battle, performed by animated MCs over a drum machine we synthesise from scratch in the browser with Web Audio. Creative engineering underneath includes a custom DSP engine (pitch tracking, syllable detection, PSOLA re-synthesis), per-character voices that stay consistent, an editable cast screen, and a scorecard finale that crowns your friend group's champion.

### Retro Remix
It remixes two retro art forms: Shakespeare's 400-year-old English and classic boom-bap hip-hop. The beat is a hand-built drum machine (kick, snare, hats, sub bass on a 16-step grid), and the lyrics are rewritten from everyday group-chat messages into thee/thou/doth couplets, so modern "seen at 3am" drama is told in the language of the Globe over a golden-age hip-hop groove.
