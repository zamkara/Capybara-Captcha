addEventListener("fetch", event => event.respondWith(handleFetch(event.request)));

function readNumber(value, fallback) {
	const n = Number(value);
	return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function envConfig() {
	return {
		REDIRECT_URL: typeof REDIRECT_URL !== "undefined" ? REDIRECT_URL : "https://zamkara.tech",
		DEFAULT_DIFFICULTY: readNumber(typeof DEFAULT_DIFFICULTY !== "undefined" ? DEFAULT_DIFFICULTY : 3, 3),
		MIN_DIFFICULTY: readNumber(typeof MIN_DIFFICULTY !== "undefined" ? MIN_DIFFICULTY : 1, 1),
		MAX_DIFFICULTY: readNumber(typeof MAX_DIFFICULTY !== "undefined" ? MAX_DIFFICULTY : 6, 6),
		DEFAULT_DURATION_SEC: readNumber(typeof DEFAULT_DURATION_SEC !== "undefined" ? DEFAULT_DURATION_SEC : 30, 30),
		MIN_DURATION_SEC: readNumber(typeof MIN_DURATION_SEC !== "undefined" ? MIN_DURATION_SEC : 15, 15),
		MAX_DURATION_SEC: readNumber(typeof MAX_DURATION_SEC !== "undefined" ? MAX_DURATION_SEC : 300, 300),
		LIMIT_MAX_CHALLENGES_PER_DAY: readNumber(typeof LIMIT_MAX_CHALLENGES_PER_DAY !== "undefined" ? LIMIT_MAX_CHALLENGES_PER_DAY : 2, 2),
		KV_PREFIX_BASE: typeof KV_PREFIX_BASE !== "undefined" ? KV_PREFIX_BASE : "capyguest",
		INSTANCE_ID: typeof INSTANCE_ID !== "undefined" ? INSTANCE_ID : "guest"
	};
}

function kvKeyChallenge(cfg, id) { return `${cfg.KV_PREFIX_BASE}:${cfg.INSTANCE_ID}:chal:${id}`; }
function kvKeyIpDaily(cfg, ip, bucket) { return `${cfg.KV_PREFIX_BASE}:${cfg.INSTANCE_ID}:ip:${ip}:${bucket}`; }
function kvKeySecret(cfg) { return `${cfg.KV_PREFIX_BASE}:${cfg.INSTANCE_ID}:secret`; }

async function handleFetch(request) {
	if (typeof CAPY_GUEST_KV === "undefined") {
		return withCors(json({ error: "kv_not_bound", message: "Bind CAPY_GUEST_KV to this worker" }, 500));
	}
	const cfg = envConfig();
	const url = new URL(request.url);

	if (request.method === "OPTIONS") {
		return withCors(new Response(null, { status: 204 }));
	}

	if (url.pathname === "/") {
		return Response.redirect(cfg.REDIRECT_URL, 302);
	}

	if (url.pathname === "/dev") {
		return withCors(json({
			name: "Capybara Guest Worker",
			version: "guest-standalone-1.0",
			limits: {
				difficulty: { default: cfg.DEFAULT_DIFFICULTY, min: cfg.MIN_DIFFICULTY, max: cfg.MAX_DIFFICULTY },
				durationSec: { default: cfg.DEFAULT_DURATION_SEC, min: cfg.MIN_DURATION_SEC, max: cfg.MAX_DURATION_SEC },
				perIpDaily: cfg.LIMIT_MAX_CHALLENGES_PER_DAY
			}
		}));
	}

	if (url.pathname === "/api/challenge" && request.method === "POST") {
		const ip = getClientIp(request);
		if (!ip) return withCors(json({ error: "no_ip" }, 400));

		const { count, resetAt } = await getDailyCount(CAPY_GUEST_KV, ip, cfg);
		if (count >= cfg.LIMIT_MAX_CHALLENGES_PER_DAY) {
			return withCors(json({ error: "limit_exceeded", reset_at: resetAt }, 429));
		}

		let body = {};
		try { if (request.headers.get("content-type")?.includes("application/json")) body = await request.json(); } catch {}

		const difficultyIn = Number(body?.difficulty);
		const durationIn = Number(body?.duration);
		const difficulty = clamp(Number.isFinite(difficultyIn) ? difficultyIn : cfg.DEFAULT_DIFFICULTY, cfg.MIN_DIFFICULTY, cfg.MAX_DIFFICULTY);
		const durationSec = clamp(Number.isFinite(durationIn) ? durationIn : cfg.DEFAULT_DURATION_SEC, cfg.MIN_DURATION_SEC, cfg.MAX_DURATION_SEC);

		const id = generateId(16);
		const nonce = generateId(24);
		const now = Date.now();
		const record = { id, ip, nonce, difficulty, createdAt: now, durationSec, status: "in-progress" };
		const ttl = Math.max(60, durationSec + 120);
		await CAPY_GUEST_KV.put(kvKeyChallenge(cfg, id), JSON.stringify(record), { expirationTtl: ttl });
		await incrementDailyCount(CAPY_GUEST_KV, ip, resetAt, cfg);


		const activeSecret = await getActiveSecret(CAPY_GUEST_KV, cfg);
		const payloadToken = await generatePayloadToken(record, activeSecret, cfg);

		const responseBody = {
			challenge: { id, nonce, type: "pow", difficulty },
			progress: 0,
			status: record.status,
			expires_in: durationSec
		};
		if (payloadToken) responseBody.payload_token = payloadToken;

		return withCors(json(responseBody));
	}

	if (url.pathname.startsWith("/api/challenge/") && request.method === "GET") {
		const id = url.pathname.split("/").pop() || "";
		if (!id) return withCors(json({ error: "missing_id" }, 400));
		const stored = await CAPY_GUEST_KV.get(kvKeyChallenge(cfg, id));
		if (!stored) return withCors(json({ error: "not_found" }, 404));
		const rec = JSON.parse(stored);
		const { status, progress, expiresIn } = deriveStatus(rec);
		return withCors(json({ challenge: { id: rec.id, nonce: rec.nonce, type: "pow", difficulty: rec.difficulty }, progress, status, expires_in: expiresIn }));
	}

	if (url.pathname === "/api/verify" && request.method === "POST") {
		let body; try { body = await request.json(); } catch { return withCors(json({ error: "invalid_json" }, 400)); }
		const id = String(body?.id || "").trim();
		const solution = String(body?.solution || "").trim();
		if (!id || !solution) return withCors(json({ error: "missing_fields", required: ["id", "solution"] }, 400));

		const stored = await CAPY_GUEST_KV.get(kvKeyChallenge(cfg, id));
		if (!stored) return withCors(json({ error: "not_found" }, 404));
		const rec = JSON.parse(stored);

		// Validate payload token before doing PoW verification
		{
			const activeSecret = await getActiveSecret(CAPY_GUEST_KV, cfg);
			const payloadToken = String(body?.payload_token || "").trim();
			const validPayload = await verifyPayloadToken(payloadToken, rec, activeSecret, cfg);
			if (!validPayload) return withCors(json({ error: "invalid_payload", message: "payload_token is missing or invalid" }, 400));
		}
		const { status, progress } = deriveStatus(rec);
		if (status === "expired") return withCors(json({ status: "expired", verified: false, progress }, 410));
		if (rec.status === "solved") return withCors(json({ status: "solved", verified: true, progress: 100 }));

		const hashHex = await sha256Hex(rec.nonce + solution);
		const ok = hasLeadingHexZeros(hashHex, rec.difficulty);
		if (!ok) return withCors(json({ status: "in-progress", verified: false, progress }));

		const updated = { ...rec, status: "solved", solvedAt: Date.now() };
		await CAPY_GUEST_KV.put(kvKeyChallenge(cfg, rec.id), JSON.stringify(updated));
		return withCors(json({ status: "solved", verified: true, progress: 100 }));
	}

	return new Response("Not Found", { status: 404 });
}

function clamp(n, min, max) { return Math.max(min, Math.min(max, Math.floor(n))); }
function yyyymmddUTC(d) { const y = d.getUTCFullYear(); const m = String(d.getUTCMonth() + 1).padStart(2, "0"); const day = String(d.getUTCDate()).padStart(2, "0"); return `${y}${m}${day}`; }
function secondsUntilEndOfUTCDay(nowMs) { const d = new Date(nowMs); const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0)); return Math.max(1, Math.floor((next.getTime() - nowMs) / 1000)); }
function getClientIp(request) { const h = request.headers; return h.get("cf-connecting-ip") || h.get("x-forwarded-for")?.split(",")[0]?.trim() || null; }
async function getDailyCount(kv, ip, cfg) { const nowMs = Date.now(); const bucket = yyyymmddUTC(new Date(nowMs)); const key = kvKeyIpDaily(cfg, ip, bucket); const raw = await kv.get(key); const count = raw ? Number(raw) || 0 : 0; const resetIn = secondsUntilEndOfUTCDay(nowMs); const resetAt = Math.floor(nowMs / 1000) + resetIn; return { count, resetAt }; }
async function incrementDailyCount(kv, ip, resetAtEpochSec, cfg) { const nowMs = Date.now(); const bucket = yyyymmddUTC(new Date(nowMs)); const key = kvKeyIpDaily(cfg, ip, bucket); const raw = await kv.get(key); const count = raw ? Number(raw) || 0 : 0; const ttl = Math.max(1, resetAtEpochSec - Math.floor(nowMs / 1000)); await kv.put(key, String(count + 1), { expirationTtl: ttl }); }
function deriveStatus(record) { if (record.status === "solved") return { status: "solved", progress: 100, expiresIn: 0 }; const now = Date.now(); const elapsedMs = Math.max(0, now - record.createdAt); const durationMs = record.durationSec * 1000; const progress = Math.min(100, Math.floor((elapsedMs / durationMs) * 100)); if (elapsedMs >= durationMs) return { status: "expired", progress, expiresIn: 0 }; const expiresIn = Math.max(0, Math.ceil((durationMs - elapsedMs) / 1000)); return { status: "in-progress", progress, expiresIn }; }
function withCors(res) { const h = new Headers(res.headers); h.set("Access-Control-Allow-Origin", "*"); h.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS"); h.set("Access-Control-Allow-Headers", "Content-Type"); return new Response(res.body, { status: res.status, headers: h }); }
function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } }); }
function hasLeadingHexZeros(hex, zeros) { for (let i = 0; i < zeros; i++) { if (hex[i] !== "0") return false; } return true; }
async function sha256Hex(input) { const data = new TextEncoder().encode(input); const digest = await crypto.subtle.digest("SHA-256", data); return bytesToHex(new Uint8Array(digest)); }
function bytesToHex(bytes) { const hex = []; for (let i = 0; i < bytes.length; i++) hex.push(bytes[i].toString(16).padStart(2, "0")); return hex.join(""); }
function generateId(bytes) { const buf = new Uint8Array(bytes); crypto.getRandomValues(buf); let str = ""; for (let i = 0; i < buf.length; i++) str += String.fromCharCode(buf[i]); return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }

// Payload token helpers (stateless binding between issued challenge and client submission)
async function generatePayloadToken(record, secret, cfg) {
	const expSec = Math.floor((record.createdAt + record.durationSec * 1000) / 1000);
	const sigInput = `${record.id}.${record.nonce}.${expSec}.${record.difficulty}.${cfg.INSTANCE_ID}.${secret}`;
	const sig = await sha256Hex(sigInput);
	return `${record.id}.${record.nonce}.${expSec}.${record.difficulty}.${sig}`;
}

async function verifyPayloadToken(token, record, secret, cfg) {
	if (!token) return false;
	const parts = token.split(".");
	if (parts.length !== 5) return false;
	const [id, nonce, expStr, diffStr, sig] = parts;
	const expSec = Number(expStr);
	const difficulty = Number(diffStr);
	if (id !== record.id || nonce !== record.nonce || difficulty !== record.difficulty) return false;
	if (!Number.isFinite(expSec)) return false;
	const nowSec = Math.floor(Date.now() / 1000);
	if (nowSec > expSec) return false;
	const expected = await sha256Hex(`${id}.${nonce}.${expSec}.${difficulty}.${cfg.INSTANCE_ID}.${secret}`);
	return sig === expected;
}

async function getActiveSecret(kv, cfg) {
	// 1) Explicit env var TOKEN_SECRET overrides (if provided as secret/var)
	if (typeof TOKEN_SECRET !== "undefined" && String(TOKEN_SECRET || "").length > 0) {
		return String(TOKEN_SECRET);
	}
	// 2) Try KV
	const existing = await kv.get(kvKeySecret(cfg));
	if (existing && existing.length > 0) return existing;
	// 3) Generate, store, and return
	const generated = generateSecretHex(32);
	await kv.put(kvKeySecret(cfg), generated);
	return generated;
}

function generateSecretHex(numBytes) {
	const buf = new Uint8Array(numBytes);
	crypto.getRandomValues(buf);
	return bytesToHex(buf);
}
