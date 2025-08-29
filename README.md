# Capybara
## A Flexible, Lightning-Quick & Serverless CAPTCHA

Self-hosted, KV-backed CAPTCHA API with flexible UI, difficulty, duration, and IP limiting.

This Worker lets you run the Capybara CAPTCHA API under your own Cloudflare account without access to the original source code. By default, the Worker runs in standalone mode and stores all CAPTCHA state in your own KV (`CAPY_KV`). Users or apps integrate against your Worker’s public URL (e.g., `https://capybara.yourname.workers.dev` or a custom domain).

---

## What You Get

- Same API shape as the main Worker: `/api/challenge`, `/api/challenge/:id`, `/api/verify`, `/dev`
- Your own KV namespace (`CAPY_KV`) to store per-IP limits and challenge data
- Your own configuration (redirect, difficulty/duration defaults and bounds, per-IP daily limit, instance ID)
- Isolation: compute and KV usage are billed to your account

---

## Quick Start

[![Deploy Worker](https://raw.githubusercontent.com/almaheras/blackhole/refs/heads/main/Property%201%3DWorker%20Light.svg)](https://deploy.workers.cloudflare.com/?url=https://github.com/zamkara/capybara_captcha)

### 0. Install & Prepare Wrangler (Local Development)
```bash
wrangler kv namespace create "CAPY_KV"
wrangler kv namespace create "CAPY_KV --preview"
````

### 1. Create Project Directory

```bash
mkdir capybara
cd capybara
```

### 2. Copy Templates

* `worker.js` (single-file Worker, Standalone)
* `wrangler.jsonc` (fill your KV `id`/`preview_id`)

### 3. Edit `wrangler.jsonc` Variables

* `REDIRECT_URL` (landing page when visiting `/`)
* Limits: `DEFAULT_DIFFICULTY`, `MIN_DIFFICULTY`, `MAX_DIFFICULTY`, `DEFAULT_DURATION_SEC`, `MIN_DURATION_SEC`, `MAX_DURATION_SEC`, `LIMIT_MAX_CHALLENGES_PER_DAY`
* Namespacing: `KV_PREFIX_BASE`, `INSTANCE_ID`

### 4. Run Locally

```bash
wrangler dev --local --port 8789 --config wrangler.jsonc | cat
```

### 5. Deploy

```bash
wrangler deploy --config wrangler.jsonc
```

### 6. Confirm Public URL

* Example: `https://capybara.yourname.workers.dev`
* This is the base URL for your websites/apps

---

## Public URL Integration

* Base URL example: `https://capybara.yourname.workers.dev`
* API endpoints:

  * POST `${BASE_URL}/api/challenge` (optional JSON `{ difficulty, duration }`)
  * GET `${BASE_URL}/api/challenge/:id`
  * POST `${BASE_URL}/api/verify` (JSON `{ id, solution }`)

### Minimal HTML Integration

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
</head>
<body>
<h1>Capybara Captcha Demo</h1>
<button id="start">Start CAPTCHA</button>
<pre id="log">Click button to start...</pre>

<script>
const BASE_URL='https://capybara.yourname.workers.dev';

async function sha256(s){
  const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));
  return Array.from(new Uint8Array(h)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

function hasZeros(hex,n){ return hex.slice(0,n)==='0'.repeat(n); }

const btn=document.getElementById('start');
const log=document.getElementById('log');

btn.onclick=async()=>{
  btn.disabled=true;
  log.textContent="Fetching challenge...\n";
  let ch;
  try{
    const res=await fetch(BASE_URL+'/api/challenge',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({difficulty:3,duration:30})
    });
    ch=(await res.json()).challenge;
    log.textContent+="Challenge from server:\n"+JSON.stringify(ch,null,2)+"\n";
  }catch{
    ch={id:'dummy',nonce:'salt123',difficulty:3};
    log.textContent+="Using dummy challenge\n";
  }

  log.textContent+="Solving PoW...\n";
  let sol=0,h='';
  while(true){
    h=await sha256(ch.nonce+sol);
    if(hasZeros(h,ch.difficulty)) break;
    sol++;
  }
  log.textContent+="Solution: "+sol+"\nHash: "+h+"\nSubmitting...\n";

  try{
    const r=await fetch(BASE_URL+'/api/verify',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({id:ch.id,solution:String(sol)})
    });
    const res=r.ok?await r.json():{success:true,token:'dummy_token'};
    log.textContent+="Result:\n"+JSON.stringify(res,null,2);
  }catch{
    log.textContent+="Verification failed, using dummy token\n"+JSON.stringify({success:true,token:'dummy_token'},null,2);
  }
  btn.disabled=false;
};
</script>
</body>
</html>
```

**Notes**

* Solver is a demo; production UIs should provide progress indicator, cancellation, etc.
* Public URL can be custom domain attached to the Worker

---

## Internals: How the Worker Works

* Validates inputs and applies per-IP daily limits using KV (`CAPY_KV`)
* Creates, stores, reads, and verifies challenges entirely from KV
* All keys are namespaced by `KV_PREFIX_BASE` and `INSTANCE_ID` to avoid collisions

---

## Configuration Options

* `REDIRECT_URL`: where `/` redirects
* `DEFAULT_DIFFICULTY`, `MIN_DIFFICULTY`, `MAX_DIFFICULTY`
* `DEFAULT_DURATION_SEC`, `MIN_DURATION_SEC`, `MAX_DURATION_SEC`
* `LIMIT_MAX_CHALLENGES_PER_DAY`: per-IP daily challenge cap
* `KV_PREFIX_BASE`, `INSTANCE_ID`: KV namespacing for multi-instance isolation

---

## Local Development

```bash
wrangler dev --local --port 8789 --config wrangler.jsonc | cat
```

Or copy `worker.js` and adjust `wrangler.jsonc`.

---

## Troubleshooting

* 404 on `/api/*`: ensure public URL and paths match
* Redirect goes to wrong site: set `REDIRECT_URL` correctly
* Rate limit not working: ensure `CAPY_KV` exists and `LIMIT_MAX_CHALLENGES_PER_DAY` > 0

---

## FAQ

* **Upstream dependent?** No, standalone and writes to KV
* **Multiple deployments?** Yes, use unique `INSTANCE_ID`
* **Need original source code?** No, single-file Worker stores all state in KV

---

## Integration & KV Flow

```
[Website / App]
        |
        v
   [Public URL]
https://capybara.yourname.workers.dev
        |
        v
   [Cloudflare Worker]
        |
   -----------------
   |               |
   v               v
[KV: CAPY_KV]  [Challenge Logic]
   |                   |
   v                   v
Per-IP Limit      Generate/Verify
Storage            Challenge Data
```

* Website/App calls Worker public URL
* Worker reads/writes KV (`CAPY_KV`) for:

  * Per-IP daily limits
  * Challenge creation & verification
* Keys namespaced by `KV_PREFIX_BASE` + `INSTANCE_ID` to avoid collisions

### Challenge Lifecycle

```
1. POST /api/challenge
        |
        v
   Worker checks IP limits in KV
        |
        v
   Worker generates challenge
        |
        v
   Stores challenge in KV
        |
        v
   Returns challenge to client
```

```
2. POST /api/verify
        |
        v
   Client sends {id, solution}
        |
        v
   Worker fetches challenge from KV
        |
        v
   Validates solution & limits
        |
        v
   Returns success/failure
```

### KV Structure

```
Key: {KV_PREFIX_BASE}:{INSTANCE_ID}:IP:{ip_address}
Value: {
  challengesToday: number,
  lastChallengeTs: timestamp
}

Key: {KV_PREFIX_BASE}:{INSTANCE_ID}:CH:{challenge_id}
Value: {
  nonce: string,
  difficulty: number,
  duration: number,
  createdAt: timestamp
}
```

* `{KV_PREFIX_BASE}`: configurable prefix for multi-instance isolation
* `{INSTANCE_ID}`: unique deployment ID
* `IP:{ip_address}`: per-IP tracking
* `CH:{challenge_id}`: stores each challenge data
