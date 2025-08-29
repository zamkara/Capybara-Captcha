# Capybara
<p>A Flexible, Lightning-Quick & Serverless CAPTCHA</p>

Capybara is a **minimal, serverless CAPTCHA** for modern apps.  
It’s **fast, lightweight, and privacy-friendly**, powered by **Cloudflare Workers + KV**.  
Instead of tracking users, Capybara uses a **SHA-256 proof-of-work challenge** to keep bots out without friction.  

## What You Get

- Same API shape as the main Worker: `/api/challenge`, `/api/challenge/:id`, `/api/verify`, `/dev`
- Your own KV namespace (`CAPY_KV`) to store per-IP limits and challenge data
- Customizable configuration (redirect URL, default difficulty, duration, limits, instance ID)
- Complete isolation: compute and KV usage are billed to your Cloudflare account

| CAPTCHA           | Open-source | Free | Private | Fast to solve | Easy for humans | Small error rate | Checkpoint support | Widget support | GDPR/CCPA Compliant | Customizable | Hard for bots | Easy to integrate |
|-------------------|-------------|------|---------|---------------|-----------------|------------------|--------------------|----------------|----------------------|--------------|---------------|-------------------|
| **Capybara**      | ✅          | ✅   | ✅      | ✅            | ✅              | ✅               | ❌                 | 🟨             | ✅                   | ✅           | 🟨            | ✅                |
| Cap               | ✅          | ✅   | ✅      | ✅            | ✅              | ✅               | ✅                 | ✅             | ✅                   | ✅           | 🟨            | ✅                |
| Cloudflare Turnstile | ❌       | ✅   | 🟨      | 🟨            | ✅              | ❌               | 🟨                 | ✅             | ✅                   | ❌           | 🟨            | ✅                |
| reCAPTCHA         | ❌          | 🟨   | ❌      | ✅            | ❌              | 🟨               | ❌                 | ✅             | 🟨                   | ❌           | ❌            | ✅                |
| hCAPTCHA          | ❌          | 🟨   | 🟨      | ❌            | ❌              | 🟨               | ❌                 | ✅             | 🟨                   | ❌           | 🟨            | ✅                |
| Altcha            | ✅          | ✅   | ✅      | ✅            | ✅              | ✅               | ❌                 | ✅             | ✅                   | ✅           | 🟨            | 🟨                |
| FriendlyCaptcha   | ❌          | ❌   | ✅      | 🟨            | ✅              | ✅               | ❌                 | ✅             | ✅                   | ✅           | 🟨            | 🟨                |
| MTCaptcha         | ❌          | 🟨   | 🟨      | ❌            | ❌              | 🟨               | ❌                 | ✅             | ✅                   | ❌           | ❌            | 🟨                |
| GeeTest           | ❌          | ❌   | ❌      | 🟨            | 🟨              | 🟨               | ❌                 | ✅             | ✅                   | ❌           | 🟨            | 🟨                |
| Arkose Labs       | ❌          | ❌   | ❌      | ❌            | ❌              | ❌               | ❌                 | ❌             | ✅                   | 🟨           | ❌            | ❌                |

---

## Quick Start

You can deploy instantly to Cloudflare Workers by clicking the button below.  
This method automatically configures the required KV namespace and deployment settings.

[![Deploy Worker](https://raw.githubusercontent.com/almaheras/blackhole/refs/heads/main/Property%201%3DWorker%20Light.svg)](https://deploy.workers.cloudflare.com/?url=https://github.com/zamkara/capybara_captcha)

---

## Manual Setup (Local Development)

If you prefer running and testing locally before deploying, follow these steps:

### 0. Install & Prepare Wrangler
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

* `worker.js` (single-file Worker, standalone mode)
* `wrangler.jsonc` (fill in your KV `id`/`preview_id`)

### 3. Configure `wrangler.jsonc`

* `REDIRECT_URL`: redirect target for `/`
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

Example:
`https://capybara.yourname.workers.dev`

---

## Public URL Integration

* Base URL example: `https://capybara.yourname.workers.dev`
* API endpoints:

  * `POST ${BASE_URL}/api/challenge` (optional JSON `{ difficulty, duration }`)
  * `GET ${BASE_URL}/api/challenge/:id`
  * `POST ${BASE_URL}/api/verify` (JSON `{ id, solution }`)

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

---

## Internals: How the Worker Works

* Validates inputs and enforces per-IP daily limits using KV (`CAPY_KV`)
* Creates, stores, retrieves, and verifies challenges entirely from KV
* All keys are namespaced with `KV_PREFIX_BASE` and `INSTANCE_ID` to avoid collisions

---

## Configuration Options

* `REDIRECT_URL`: redirect target for `/`
* `DEFAULT_DIFFICULTY`, `MIN_DIFFICULTY`, `MAX_DIFFICULTY`
* `DEFAULT_DURATION_SEC`, `MIN_DURATION_SEC`, `MAX_DURATION_SEC`
* `LIMIT_MAX_CHALLENGES_PER_DAY`: per-IP daily challenge cap
* `KV_PREFIX_BASE`, `INSTANCE_ID`: namespacing for multi-instance isolation

---

## Troubleshooting

* **404 on `/api/*`**: ensure public URL and path are correct
* **Redirect goes to wrong site**: set `REDIRECT_URL` properly
* **Rate limit not working**: verify `CAPY_KV` is configured and `LIMIT_MAX_CHALLENGES_PER_DAY` > 0

---

## FAQ

* **Dependent on upstream?** No, runs standalone with KV storage
* **Multiple deployments possible?** Yes, set unique `INSTANCE_ID`
* **Need the original source code?** No, Worker is self-contained and KV-backed

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
* `CH:{challenge_id}`: stores challenge data

* `{KV_PREFIX_BASE}`: configurable prefix for multi-instance isolation
* `{INSTANCE_ID}`: unique deployment ID
* `IP:{ip_address}`: per-IP tracking
* `CH:{challenge_id}`: stores each challenge data
