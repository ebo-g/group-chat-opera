# Group Chat Opera — Contract

## Summary
Upload a WhatsApp chat export and it becomes a comic opera performed in the
browser: animated singers, surtitles and an orchestra. The server turns the chat
into a **libretto** (JSON); the web app performs it.

## Libretto schema
```json
{ "title": "string",
  "cast": [{ "id": "c1", "name": "string", "role": "string",
    "voice": "soprano|alto|tenor|baritone|bass",
    "sex": "female|male",
    "voiceConfidence": "high|low",
    "color": "#hex" }],
  "scenes": [{ "title": "string",
    "mood": "tense|romantic|comic|tragic|triumphant",
    "lines": [{ "cast": "c1", "lyric": "string",
      "direction": "string", "emotion": "string" }] }] }
```
`voice` is chosen from the person's name plus chat clues (pronouns others use
for them): soprano/alto for likely female, tenor/baritone/bass for likely male,
alto or tenor when unsure. `sex` picks the singer's body on stage (gown vs. coat) and is kept consistent with `voice`
(soprano/alto = female, tenor/baritone/bass = male); consumers derive it from `voice` when it is missing.
The cast screen lets the user rename characters, change `sex` and pick a `voice` before the show.
`voiceConfidence` is `"high"` when those clues are
clear, otherwise `"low"`. Librettos cached before this field existed lack it, so
consumers should treat a missing value as `"low"`.

Example: `server/mock-libretto.json` (copy in `web/public/mock-libretto.json`).

## Folder ownership (to avoid merge conflicts)
| Person | Owns |
|---|---|
| A | `/server` |
| B | `/web/src/stage` and `/web/src/main.js` |
| C | `/web/src/audio` and `/web/src/landing` |

Only edit your own folders. Need a change elsewhere? Ask the owner.

## Interfaces
- **stage**: `playLine(line, castMember) -> Promise`; `showScene(scene)`; `curtainCall()`
- **audio**: `sing(line, castMember) -> Promise`; `orchestra(mood)`; `overture()`; `finale()`
- **landing**: `onLibretto(callback)` — fires with a libretto object

API: `POST /api/libretto` (server, port 3001) returns a libretto. Currently a placeholder returning the mock.
