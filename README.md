# Capybara-Captcha

[![Deploy to Cloudflare](https://img.shields.io/badge/Deploy-Cloudflare_Workers-2563EB?logo=cloudflare&logoColor=white)](https://deploy.workers.cloudflare.com/?url=https://github.com/zamkara/Capybara-Captcha) [![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE) [![Status](https://img.shields.io/badge/Serverless-Worker-blue.svg)]()

A flexible, lightning-quick, privacy-friendly CAPTCHA powered by Cloudflare Workers + KV. Capybara-Captcha uses a SHA-256 proof-of-work (PoW) challenge instead of user tracking, making it simple to integrate and friendly for humans.

![Demo](https://img1.pixhost.to/images/8309/635898926_demo.gif)

### Highlights
- **Serverless & fast**: Single-file Worker with Cloudflare KV for storage
- **Privacy-first**: No cookies or tracking
- **Payload token binding**: Prevents replay/cross-app misuse
- **Self-contained**: No dependency on upstream; can clone itself
- **Easy deploy**: One-click button or simple Wrangler commands

---

## One-Click Deploy

Click to deploy this Worker to your Cloudflare account. The flow will guide you to create/bind KV and deploy.

[![Deploy Worker](https://raw.githubusercontent.com/almaheras/blackhole/refs/heads/main/Property%201%3DWorker%20Light.svg)](https://deploy.workers.cloudflare.com/?url=https://github.com/zamkara/Capybara-Captcha)

After deploy, note your public URL, e.g. `https://your-worker.yourname.workers.dev`.

---

## Quick cURL Examples

Replace `BASE` with your Worker URL.

- Create challenge (difficulty 3, duration 30s):
```bash
BASE="https://your-worker.yourname.workers.dev"
curl -sS -X POST "$BASE/api/challenge" \
  -H 'Content-Type: application/json' \
  -d '{"difficulty":3,"duration":30}' | jq .
```

- Verify solution (fill placeholders):
```bash
curl -sS -X POST "$BASE/api/verify" \
  -H 'Content-Type: application/json' \
  -d '{"id":"<challenge_id>","solution":"<number>","payload_token":"<payload_from_challenge>"}' | jq .
```

- Poll challenge status:
```bash
curl -sS "$BASE/api/challenge/<challenge_id>" | jq .
```

---

## Manual Deploy (Wrangler)

Prerequisites: Node.js and `wrangler`.

1) Create KV namespace and bind in `wrangler.jsonc` as `CAPY_GUEST_KV` (id + preview_id)
```bash
wrangler kv namespace create CAPY_GUEST_KV
wrangler kv namespace create CAPY_GUEST_KV --preview
```

2) Configure `wrangler.jsonc`
- `REDIRECT_URL`: redirect for `/`
- Limits: `DEFAULT_DIFFICULTY`, `MIN_DIFFICULTY`, `MAX_DIFFICULTY`, `DEFAULT_DURATION_SEC`, `MIN_DURATION_SEC`, `MAX_DURATION_SEC`, `LIMIT_MAX_CHALLENGES_PER_DAY`
- Namespacing: `KV_PREFIX_BASE`, `INSTANCE_ID`

3) Run locally
```bash
wrangler dev --local --port 8789 --config wrangler.jsonc | cat
```

4) Deploy
```bash
wrangler deploy --config wrangler.jsonc
```

---

## How It Works

1. Client requests a PoW challenge. Server creates and stores it in KV, returns `{ id, nonce, difficulty, payload_token }`.
2. Client finds a `solution` so `sha256(nonce + solution)` has leading zeros per `difficulty`.
3. Client submits `{ id, solution, payload_token }` for verification.
4. Server validates `payload_token` and PoW, marks challenge solved, and responds.

Payload tokens are short strings signed by a secret. The secret is automatically generated and persisted in KV on first run (can be overridden with environment secret `TOKEN_SECRET`).

---

## API Reference

Base URL example: `https://your-worker.yourname.workers.dev`

- `POST /api/challenge`
  - Body (JSON, optional): `{ difficulty?: number, duration?: number }`
  - Response (JSON):
```json
{
  "challenge": { "id": "...", "nonce": "...", "type": "pow", "difficulty": 3 },
  "status": "in-progress",
  "progress": 0,
  "expires_in": 30,
  "payload_token": "..."
}
```

- `GET /api/challenge/:id`
  - Response example:
```json
{
  "challenge": { "id": "...", "nonce": "...", "type": "pow", "difficulty": 3 },
  "status": "in-progress",
  "progress": 42,
  "expires_in": 18
}
```

- `POST /api/verify`
  - Body (JSON): `{ id: string, solution: string, payload_token: string }`
  - Response example (success):
```json
{ "status": "solved", "verified": true, "progress": 100 }
```

- `GET /dev`: Small info endpoint with limits and version.

---

## Quick Integration Examples

### Vanilla JS (Browser)
```html
<script>
const BASE_URL = 'https://your-worker.yourname.workers.dev';

async function sha256(s){
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(h)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function hasZeros(hex, n){ return hex.slice(0, n) === '0'.repeat(n); }

async function runCaptcha(){
  const res = await fetch(BASE_URL + '/api/challenge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ difficulty: 3, duration: 30 }) });
  const data = await res.json();
  const { challenge, payload_token } = data;

  let sol = 0;
  while(true){
    const h = await sha256(challenge.nonce + sol);
    if (hasZeros(h, challenge.difficulty)) break;
    sol++;
  }

  const vr = await fetch(BASE_URL + '/api/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: challenge.id, solution: String(sol), payload_token }) });
  const out = await vr.json();
  console.log('verify:', out);
}
</script>
```

### React/Next Component
See `Resources/captcha.tsx` for a simple TSX button component that starts the challenge, solves PoW, and verifies.

### Backend Example (Node/Express)
```js
// Server receives frontend's verify result to proceed with protected action
app.post('/submit', async (req, res) => {
  const { id, solution, payload_token } = req.body;
  const r = await fetch(process.env.CAPY_BASE_URL + '/api/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, solution, payload_token })
  });
  const v = await r.json();
  if (!v.verified) return res.status(403).json({ error: 'captcha_failed' });
  // proceed
  res.json({ ok: true });
});
```

---

## Configuration

Edit `wrangler.jsonc`:
- `REDIRECT_URL`: redirect target for `/`
- `DEFAULT_DIFFICULTY`, `MIN_DIFFICULTY`, `MAX_DIFFICULTY`
- `DEFAULT_DURATION_SEC`, `MIN_DURATION_SEC`, `MAX_DURATION_SEC`
- `LIMIT_MAX_CHALLENGES_PER_DAY`
- `KV_PREFIX_BASE`, `INSTANCE_ID`

KV binding: `CAPY_GUEST_KV` must be configured with `id` and `preview_id`.

Secret management: a signing secret is auto-generated and stored in KV on first run. Optionally override with an environment secret `TOKEN_SECRET`.

---

## Troubleshooting
- 404 on `/api/*`: verify base URL and paths
- Rate limit not working: ensure KV binding exists and `LIMIT_MAX_CHALLENGES_PER_DAY` > 0
- CORS: Worker replies with permissive CORS (`*`) for demo purposes

---

## FAQ
- Dependent on upstream? No, this worker is standalone and can self-clone
- Multiple deployments? Yes. Set unique `INSTANCE_ID` per deployment
- Data residency? Uses Cloudflare KV; your account/region policies apply

---

## Architecture at a Glance
```
[Website / App]
        |
        v
   [Public URL]
https://your-worker.yourname.workers.dev
        |
        v
   [Cloudflare Worker]
        |
   -----------------
   |               |
   v               v
[KV: CAPY_GUEST_KV]  [Challenge Logic]
   |                  |
   v                  v
Per-IP Limits      Generate/Verify
Storage            Challenge Data
```

### Lifecycle
```
1) POST /api/challenge -> Store challenge -> Return challenge + payload_token
2) Client solves PoW
3) POST /api/verify -> Validate token + PoW -> Mark solved
```
