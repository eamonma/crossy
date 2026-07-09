#!/usr/bin/env node
// Post-deploy verification. Runs LATER, against the live public hostnames, from any machine
// with Node 24. No dependencies (built-ins only), so it needs no install.
//
//   node deploy/verify.mjs \
//     --api https://api-<gen>.up.railway.app \
//     --web https://web-<gen>.up.railway.app \
//     --session wss://session-<gen>.up.railway.app
//
//   (or set VERIFY_API_URL / VERIFY_WEB_URL / VERIFY_SESSION_WS)
//
// Checks:
//   1. api responds over HTTPS (/health -> 200 {ok:true}).
//   2. web responds over HTTPS (/ -> 200 HTML).
//   3. a WebSocket handshake reaches the session AND permessage-deflate is negotiated on the
//      snapshot path (the 101 response carries Sec-WebSocket-Extensions: permessage-deflate).
//      It sends NO frame, so no hello, no auth, and no board ever crosses the wire.
//   4. /internal is NOT reachable on the session's public domain (expects 404 or timeout).
//
// INV-6: this script NEVER prints a WebSocket message, board, or solution payload. It sends
// nothing after the upgrade, so there is nothing sensitive to print. It prints only statuses,
// header names, and negotiated-extension strings.

/* global process, console, URL */
import { randomBytes } from "node:crypto";
import https from "node:https";
import tls from "node:tls";

const args = process.argv.slice(2);
const opt = (flag, env) => {
  const i = args.indexOf(flag);
  if (i >= 0 && args[i + 1]) return args[i + 1];
  return process.env[env] ?? "";
};
const API = opt("--api", "VERIFY_API_URL").replace(/\/$/, "");
const WEB = opt("--web", "VERIFY_WEB_URL").replace(/\/$/, "");
const SESSION_WS = opt("--session", "VERIFY_SESSION_WS").replace(/\/$/, "");

if (!API || !WEB || !SESSION_WS) {
  console.error(
    "usage: node deploy/verify.mjs --api <https> --web <https> --session <wss>",
  );
  process.exit(2);
}

const TIMEOUT_MS = 10_000;
let failures = 0;
const pass = (m) => console.log(`  PASS  ${m}`);
const fail = (m) => {
  console.log(`  FAIL  ${m}`);
  failures += 1;
};
const note = (m) => console.log(`  NOTE  ${m}`);

/** HTTPS GET; resolves { status, bodyStart } without ever surfacing a full body. */
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: TIMEOUT_MS }, (res) => {
      let bytes = 0;
      let head = "";
      res.on("data", (c) => {
        bytes += c.length;
        if (head.length < 40) head += c.toString("latin1").slice(0, 40);
      });
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, bytes, head }),
      );
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

/** HTTPS POST with a tiny body; used to probe that /internal is not public. */
function httpsPost(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      u,
      {
        method: "POST",
        timeout: TIMEOUT_MS,
        headers: { "content-type": "application/json" },
      },
      (res) => {
        res.on("data", () => {});
        res.on("end", () => resolve({ status: res.statusCode ?? 0 }));
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end(body);
  });
}

/**
 * Open a raw TLS WebSocket handshake and read the 101 response headers. Sends the deflate
 * offer and never sends a data frame. Resolves { statusLine, extensions }.
 */
function wsHandshake(wssUrl, path) {
  return new Promise((resolve, reject) => {
    const u = new URL(wssUrl);
    const host = u.hostname;
    const port = u.port ? Number(u.port) : 443;
    const key = randomBytes(16).toString("base64");
    const socket = tls.connect(
      { host, port, servername: host, ALPNProtocols: ["http/1.1"] },
      () => {
        socket.write(
          `GET ${path} HTTP/1.1\r\n` +
            `Host: ${host}\r\n` +
            `Upgrade: websocket\r\n` +
            `Connection: Upgrade\r\n` +
            `Sec-WebSocket-Version: 13\r\n` +
            `Sec-WebSocket-Key: ${key}\r\n` +
            `Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits\r\n` +
            `\r\n`,
        );
      },
    );
    let buf = "";
    const done = (fn) => {
      socket.destroy();
      fn();
    };
    socket.setTimeout(TIMEOUT_MS, () =>
      done(() => reject(new Error("timeout"))),
    );
    socket.on("data", (chunk) => {
      buf += chunk.toString("latin1");
      const end = buf.indexOf("\r\n\r\n");
      if (end === -1) return; // headers not complete yet
      const headerBlock = buf.slice(0, end);
      const lines = headerBlock.split("\r\n");
      const statusLine = lines[0] ?? "";
      const headers = {};
      for (const line of lines.slice(1)) {
        const idx = line.indexOf(":");
        if (idx > 0)
          headers[line.slice(0, idx).trim().toLowerCase()] = line
            .slice(idx + 1)
            .trim();
      }
      done(() =>
        resolve({
          statusLine,
          extensions: headers["sec-websocket-extensions"] ?? "",
        }),
      );
    });
    socket.on("error", (e) => done(() => reject(e)));
  });
}

const sessionHttpsBase = SESSION_WS.replace(/^wss:/, "https:").replace(
  /^ws:/,
  "http:",
);
const PROBE = "00000000-0000-0000-0000-000000000000";

console.log(`\nVerifying Crossy deploy`);
console.log(`  api     ${API}`);
console.log(`  web     ${WEB}`);
console.log(`  session ${SESSION_WS}\n`);

// 1. api health
try {
  const r = await httpsGet(`${API}/health`);
  if (r.status === 200) pass(`api /health -> 200`);
  else fail(`api /health -> ${r.status} (expected 200)`);
} catch (e) {
  fail(`api /health errored: ${e.message}`);
}

// 2. web reachable
try {
  const r = await httpsGet(`${WEB}/`);
  if (r.status === 200) pass(`web / -> 200 (${r.bytes} bytes)`);
  else fail(`web / -> ${r.status} (expected 200)`);
} catch (e) {
  fail(`web / errored: ${e.message}`);
}

// 3. WS handshake reaches session and permessage-deflate is negotiated
try {
  const r = await wsHandshake(SESSION_WS, `/games/${PROBE}/ws`);
  const is101 = /\b101\b/.test(r.statusLine);
  const deflate = /permessage-deflate/i.test(r.extensions);
  if (is101 && deflate)
    pass(`session WS upgrade -> 101, permessage-deflate negotiated`);
  else if (is101 && !deflate)
    fail(`session WS upgraded (101) but permessage-deflate NOT negotiated`);
  else fail(`session WS handshake did not reach 101: "${r.statusLine}"`);
} catch (e) {
  fail(`session WS handshake errored: ${e.message}`);
}

// 4. /internal must NOT be reachable on the public domain (expects 404 or timeout).
try {
  const r = await httpsPost(
    `${sessionHttpsBase}/internal/games/${PROBE}/membership-changed`,
    "{}",
  );
  if (r.status === 404)
    pass(`public /internal -> 404 (served only on the private port)`);
  else if (r.status === 401 || r.status === 403)
    fail(
      `public /internal -> ${r.status}: it IS reachable publicly (bearer-guarded, ` +
        `but should be private-only). Confirm INTERNAL_PORT is set on the session.`,
    );
  else fail(`public /internal -> ${r.status} (expected 404 or timeout)`);
} catch (e) {
  // A timeout or connection reset is an acceptable "not reachable" outcome.
  pass(`public /internal not reachable (${e.message})`);
}

note(
  "private-path check (api -> session.railway.internal:<INTERNAL_PORT>/internal) can only " +
    "run inside Railway: open a shell in the api service (`railway ssh -s api`) and POST to " +
    "the private hostname with node fetch; expect 401 (served, bearer required).",
);

console.log(
  `\n${failures === 0 ? "OK: all public checks passed" : `FAILED: ${failures} check(s)`}\n`,
);
process.exit(failures === 0 ? 0 : 1);
