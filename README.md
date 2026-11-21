# group-chat-opera

Upload a WhatsApp chat export and watch it become a comic opera in the browser.
See [CONTRACT.md](CONTRACT.md) for the schema, interfaces and folder ownership.

## Run
Requires Node.js, npm and git.

```sh
# terminal 1 — API on :3001
cd server && cp .env.example .env && npm install && npm start

# terminal 2 — web on :5173 (proxies /api to :3001)
cd web && npm install && npm run dev
```
Open http://localhost:5173.
