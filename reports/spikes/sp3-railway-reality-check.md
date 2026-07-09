# SP3: Railway reality check

**Questions.** Five, all gating Wave 2.2's decision to deploy the two-service shape to
Railway (DESIGN.md section 15, Railway and private-network lines):

1. **Idle WebSocket timeouts.** How long does an idle socket survive through Railway's
   edge? Does a periodic ping keep it alive, and at what interval? The session service
   holds many idle sockets.
2. **permessage-deflate pass-through.** Does deflate negotiate and survive intact through
   Railway's proxy? The service compresses snapshot frames only (SP4).
3. **Private networking.** From service A, reach service B over
   `service-name.railway.internal` on a plain HTTP `/internal` endpoint, and confirm that
   endpoint is not reachable from the public internet. Validates the api-to-session
   `membership-changed` call shape (DESIGN.md section 9).
4. **Config-as-code.** Define the deploy declaratively plus a small CLI bootstrap for what
   config files cannot express. Deliver a reusable pattern for the real Wave 2.2 deploy.
5. **Pricing and limits.** Instance sizing, idle two-service cost, cold-start or sleep
   behavior, region list, and anything surprising.

## Answers

**Verdict: conditional GO for Railway, with one owner action before Wave 2.2 commits.**
Every networking question that mattered came back in Railway's favor: idle sockets survive
far longer than the folklore says, the edge is a transparent WebSocket proxy that forwards
the deflate negotiation header, and private networking works exactly as the api-to-session
design assumes. The one blocker is not networking: **on the owner's current account the
Railway source builder (the "Metal builder") failed every attempt, five for five, with no
build logs**, which stopped the real `ws` service from deploying from source. Prebuilt
image deploys work fine, so this spike ran on public images and answered the platform
questions anyway. Before Wave 2.2 the owner must confirm the source builder actually
builds (retry once Railway's Metal builder recovers, or deploy from prebuilt images built
in CI, which works today). Fly.io remains the ready fallback and `flyctl` is already
installed on the owner's machine.

1. **Idle timeout: no aggressive edge close.** An idle socket with zero application data
   and zero pings stayed open for **the full observation window (about 15 minutes)** with
   no close. Railway's edge does not enforce the roughly 60-second idle close that older
   community reports describe (those predate the current "hikari" proxy). A periodic
   WebSocket ping keeps the connection alive indefinitely: a client ping every 25 seconds
   drew a pong across the edge on every cycle for the full run. Server pings are
   symmetric, so the session service's plan of an application-level ping every 25 to 30
   seconds is more than sufficient, and it is cheap insurance plus dead-peer detection
   rather than a hard requirement.
2. **deflate: no edge-level blocker, end-to-end confirmation deferred.** The edge does a
   transparent WebSocket upgrade, round-trips 60 KB frames (both highly compressible and
   random payloads) byte-intact, and **forwards the `Sec-WebSocket-Extensions:
   permessage-deflate` request header to the origin unmodified**. So nothing in Railway's
   proxy strips the negotiation or re-frames the stream. The one piece not exercised is a
   real RSV1-compressed round-trip, because the deflate-capable `ws` origin could not be
   deployed (builder outage above). SP4 already proved deflate round-trips locally; the
   only open variable was the edge, and the edge is clean. Confidence: high that it works,
   but not empirically closed end-to-end. Close it on the first real `ws` deploy.
3. **Private networking: confirmed, both halves.** From service A (region
   `us-east4-eqdc4a`), a plain HTTP GET to `http://B.railway.internal:PORT/` succeeded
   against two different target services, over the private network, no TLS. From the
   public internet, every `*.railway.internal` name is NXDOMAIN, and a service with no
   generated domain has no public endpoint at all. The private network is dual-stack
   (IPv4 and IPv6), suffix `railway.internal`. This validates the api-to-session
   `/internal` call shape: plain HTTP, private hostname, an arbitrary port that is never
   published to the edge.
4. **Config-as-code: CLI bootstrap validated; the config file is documented but its
   application is unproven.** The full CLI path (`init`, `link`, `add`, `variables`,
   `scale`, `domain`, `service source connect`, `down`, `delete`) all worked and is the
   reusable pattern below. `railway.json` per service is included as the intended
   declarative layer, but I could not observe it take effect, because it is parsed during
   the build and no source build ran. Region is settable two ways: `deploy.region` in
   `railway.json` (schema-valid, unverified) and `railway scale <service> us-east=1`
   (verified: services landed in `us-east4-eqdc4a`).
5. **Pricing and limits.** Railway bills usage, not fixed instance sizes. The default
   per-service cap is **2 vCPU and 1 GB RAM**; you pay for what you use under that cap and
   can lower it. Three idle services (two nginx, one Go echo) cost **$0.000276 total over
   about 20 minutes**, memory-dominated, projecting to roughly a cent a day for this toy
   project. There is no cold start: app sleeping is off by default
   (`sleepApplication: false`), so services run continuously and idle sockets stay up,
   which is what the session service needs. App Sleeping is opt-in and would be the wrong
   setting for the session service. Regions offered: `us-west` (`us-west2`), `us-east`
   (`us-east4-eqdc4a`), `eu-west` (`europe-west4-drams3a`), `southeast-asia`
   (`asia-southeast1-eqsg3a`); no Canadian region, consistent with the Wave 0.2c region
   note. Image deploys finished in seconds. Surprises: the source-builder outage; the edge
   idle window is far more generous than folklore; and the workspace shows a single-day
   billing window, consistent with the Trial plan.

## Setup

Railway CLI 5.25.1, authenticated as the owner (`railway whoami`: Eamon Ma). One throwaway
project `crossy-sp3-spike` (id `adbfe7a5-3469-4682-9fb3-086bfa64bfe0`) in workspace
`Eamon Ma's Projects`, one `production` environment, everything torn down at the end
(proof below). All service origins pinned to `us-east4-eqdc4a` (US East, Virginia) via
`railway scale ... us-east=1`. Railway's edge is anycast: requests from this machine (a US
West IP) were served by edge `sjc1` while the origin ran in `us-east4`, so the edge
location tracks the client, not the service. The proxy identifies itself as
`server: railway-hikari`.

The intended toy shape was two Node services: a `ws` echo plus a private `/internal`
listener (session), and an HTTP caller (api). That code is written and in the throwaway
tree, but the Railway source builder never built it (next section), so the empirical runs
used public images that exercise the same platform surfaces:

- **session**: `jmalloc/echo-server` (public image), public domain, port 8080. HTTP and
  WebSocket echo. Carries the idle and deflate probes.
- **api** and **diag**: `nginx:alpine` (public image), no public domain, private-only.
  The private-network origin and target for question 3, reached with busybox `wget` over
  `railway ssh`.

Local probes are throwaway Node scripts using `ws` 8.21.0, run from this machine against
the public edge. They are not committed.

### The blocking finding: the source builder failed, five for five

Every `railway up` from source failed in about six seconds with a single build-log line,
`scheduling build on Metal builder "builder-amucag"`, then `Deploy failed`, with no
provider output at all. It failed identically with the default builder, with a
`railway.json` present, and with a `Dockerfile` present. The deployment manifest showed
the build never advanced past scheduling: it stayed on the default `RAILPACK` builder with
`region: null`, which means Railway never fetched the source and therefore never parsed
`railway.json`. That also explains why config-as-code could not be observed.

A prebuilt image (`nginx:alpine`) deployed successfully to the same project seconds later,
which isolates the failure to the source-build path, not the account's ability to run
containers. This matches a cluster of current Railway reports of builds hanging or failing
at "scheduling build on Metal builder" ([Railway Central Station][cs1], [Help Station][hs1]).
It may be transient platform capacity or a Trial-account limit on the Metal builder; either
way it is real right now and it blocks a from-source deploy. I did not push the toy images
to a public registry (that would create an unsanctioned public artifact), so full-fidelity
runs of the real `ws` server are deferred to a sanctioned deploy path.

[cs1]: https://station.railway.com/questions/new-deployment-stuck-and-failing-to-depl-619ab897
[hs1]: https://station.railway.com/questions/build-failing-on-railway-with-empty-buil-81b4dd02

## Question 1: idle WebSocket timeout

Two clients opened against `wss://<session>.up.railway.app/.ws` and held the socket.

- **No keepalive.** No application data, no pings, in either direction. Survived the full
  observation window with periodic "still open" heartbeats and no close:

```
[idle-noping +30.0s]  still open
[idle-noping +300.2s] still open
[idle-noping +600.4s] still open
[idle-noping +900s]   still open   (observation ended; socket never closed)
```

- **Client ping every 25 seconds.** A WebSocket ping frame from the client drew a pong
  from the origin across the edge on every cycle, for the full run:

```
[idle-cping25 +350.6s] sent client PING
[idle-cping25 +350.7s] recv PONG
[idle-cping25 +600.8s] sent client PING
[idle-cping25 +600.9s] recv PONG
```

The edge does not close idle WebSockets at the minute scale. The old "~60s idle timeout"
warnings do not reproduce on the current proxy. For the session service, the planned
application ping (25 to 30 seconds) is comfortable, and its real value is detecting a dead
peer, not defeating an edge timer. No design change needed.

## Question 2: permessage-deflate pass-through

The deflate-negotiating `ws` origin could not be deployed (builder outage), so this
question is answered at the edge boundary, which is the only part Railway controls:

- **Transparent upgrade and frame integrity.** A `ws` client offering
  `perMessageDeflate` completed the upgrade through the edge and echoed a 60,000-byte
  highly compressible payload and a 60,000-byte random payload, both byte-intact. Large
  frames cross the edge without re-framing or corruption.
- **Negotiation header forwarded.** A request carrying
  `Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits` (and a custom
  `X-Sp3-Probe`) reached the origin unmodified, confirmed by the origin echoing the exact
  headers it received:

```
GET / HTTP/1.1
Host: session-production-....up.railway.app
Sec-Websocket-Extensions: permessage-deflate; client_max_window_bits
X-Sp3-Probe: yes
```

Nothing in Railway's proxy strips the extension offer or interferes with the frame stream.
SP4 already proved deflate round-trips locally in `ws`; the only unknown was the edge, and
the edge is clean. The remaining step, a real RSV1-compressed round-trip through the edge
with a deflate-capable origin, is deferred to the first real `ws` deploy. No PROTOCOL or
DESIGN change is implied.

## Question 3: private networking

From inside service A over `railway ssh`, region confirmed `us-east4-eqdc4a`:

```
$ wget -qO- http://diag.railway.internal:80/         # target has NO public domain
<!DOCTYPE html><html><head><title>Welcome to nginx!</title> ...   # 200, private-only

$ wget -qO- http://session.railway.internal:8080/    # reach the public svc privately
Request served by 56d85586e5d7
GET / HTTP/1.1
Host: session.railway.internal:8080                  # plain HTTP, private hostname
```

From the public internet:

```
diag.railway.internal:      no public DNS (NXDOMAIN)
session.railway.internal:   no public DNS (NXDOMAIN)
api.railway.internal:       no public DNS (NXDOMAIN)
```

`railway private-network status` reports one network named `railway`, suffix
`railway.internal`, address family "IPv4 & IPv6", endpoints `ACTIVE`. Services with no
generated domain (`api`, `diag`) have no public endpoint (`railway domain list` returns
none). This is exactly the api-to-session `/internal` shape: A reaches B over
`B.railway.internal` on an arbitrary port by plain HTTP, and that port is never exposed to
the edge. The static-bearer assumption for internal auth (DESIGN.md section 15) stands: the
endpoint is unreachable from outside the private network, so a static bearer's blast radius
stays "forced disconnects, not data."

## Question 4: config-as-code pattern

Two parts. The CLI bootstrap is fully validated (every command ran). The `railway.json`
files are the intended declarative layer; their application is unverified because no source
build ran, so treat them as documented-not-proven until the first successful build.

### Per-service `railway.json` (intended; unverified application)

`session/railway.json` and `api/railway.json`, identical but for names:

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": { "builder": "NIXPACKS" },
  "deploy": {
    "startCommand": "node server.js",
    "region": "us-east4-eqdc4a",
    "numReplicas": 1,
    "healthcheckPath": "/health",
    "healthcheckTimeout": 60,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

`deploy.region` is a valid schema field (a string region id, not the `scale` alias). It was
not observed to apply because the build never reached source parsing; `railway scale`
below is the verified way to place a service.

### CLI bootstrap (validated end to end)

```bash
#!/usr/bin/env bash
set -euo pipefail
WORKSPACE_ID="${RAILWAY_WORKSPACE_ID:?}"          # railway list shows the workspace
PROJECT_NAME="crossy-sp3-spike"

# Project (also links the current dir to production).
PROJECT_ID=$(railway init --name "$PROJECT_NAME" --workspace "$WORKSPACE_ID" --json \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
railway link -p "$PROJECT_ID" -e production

# Services.
railway add --service session --json
railway add --service api --json

# Variables per service; --skip-deploys so we deploy once, deliberately.
# Secrets come from the environment, never a committed file.
railway variables -s session --set PORT=8080 --set INTERNAL_PORT=3001 \
  --set "INTERNAL_MARKER=${INTERNAL_MARKER:?}" --skip-deploys
railway variables -s api --set PORT=8080 --set INTERNAL_PORT=3001 \
  --set SESSION_INTERNAL_HOST=session.railway.internal --skip-deploys

# Deploy. Intended: source build (railway.json read from the service dir root),
#   run from inside each service dir so its config and only its files upload:
( cd session && railway up -s session -e production -c )
( cd api     && railway up -s api     -e production -c )
# Fallback that works today (builder outage): attach a prebuilt image instead of up.
#   railway service source connect --image <registry>/session:tag -s session

# Region + single replica. scale ADDS regions, so zero the default region explicitly.
railway scale -s session sfo=0 us-east=1
railway scale -s api     sfo=0 us-east=1

# Public domain for the edge-facing service only; api stays private (no domain).
railway domain -s session --port 8080 --json
```

Two gotchas worth pinning for Wave 2.2:

- **`railway up` reads config from the current directory, not from a `PATH` argument.**
  Running `railway up ./session` from the repo root ignored `session/railway.json` and used
  defaults. Run `up` from inside each service directory.
- **`railway scale` is additive.** The service is created in a default region (`sfo` on
  this workspace). `railway scale us-east=1` adds a second region; you must pass
  `sfo=0 us-east=1` to actually move it, or you pay for two replicas.

## Question 5: pricing and limits

- **Sizing.** No fixed instance tiers. Each service has a resource cap (default 2 vCPU,
  1024 MB) and bills actual usage under it. The nginx services idled at about 5 MB RAM and
  effectively 0 vCPU.
- **Idle cost.** Whole project, three services, about 20 minutes: **$0.000276**, split CPU
  $0.0000053, Memory $0.00026, Egress $0.0000074. Memory dominates an idle deploy. Order of
  magnitude: about a cent a day for this toy project; the real two-service deploy at
  friends scale is a few dollars a month, memory-led.
- **Sleep and cold start.** None by default (`sleepApplication: false`). Services run
  continuously, so idle sockets stay up and there is no cold-start penalty. App Sleeping is
  opt-in and would be wrong for the socket-holding session service.
- **Regions.** `us-west` (`us-west2`), `us-east` (`us-east4-eqdc4a`), `eu-west`
  (`europe-west4-drams3a`), `southeast-asia` (`asia-southeast1-eqsg3a`). No Canadian
  region, consistent with the Wave 0.2c region note (co-locate with Supabase `us-east-1`).
- **Deploy speed.** Image deploys completed in seconds. Source-build speed is unknown
  because it never built.
- **Surprises.** The source-builder outage; the generous edge idle window; the single-day
  billing window (Trial plan).

## Verdict for Wave 2.2

**Railway is viable and preferred on the merits this spike could measure.** Private
networking, idle-socket survival, transparent WebSocket proxying, config, and pricing all
land where the design needs them. Nothing here is a reason to switch to Fly.io.

**One blocker gates the commit: prove the source builder works.** On the owner's current
account the Metal builder failed every time with no diagnostics, which would stop a
from-source deploy of the real services. This may be a transient Railway platform issue or
a Trial-plan limit. Concrete paths, in order of preference:

1. Retry a source build once Railway's Metal builder recovers, or after moving the
   workspace off Trial (add a payment method or upgrade). If it builds, Railway is a clean
   GO and `railway.json` application should be re-confirmed at that point.
2. Deploy from prebuilt images built in CI and attached with
   `railway service source connect --image`. This path deployed successfully today and
   sidesteps the builder entirely, at the cost of owning an image build and registry in CI.
3. If the builder stays broken and images are unattractive, fall back to Fly.io. `flyctl`
   is already installed; the design has always named it as the one-day switch.

Recommendation: **conditional GO on Railway.** Take path 1 or 2 at Wave 2.2 kickoff; keep
Fly.io as the fallback it has always been.

## Proposed DESIGN.md section 15 edits (for the docs track; not applied here)

- Railway line, replace:
  > Railway under WebSocket load, and its pricing: validate during M1; Fly.io is the
  > alternate; switching is about a day.

  with:
  > Railway under WebSocket load, and its pricing: validated by SP3
  > (`reports/spikes/sp3-railway-reality-check.md`). The edge is a transparent WebSocket
  > proxy with no minute-scale idle close and it forwards the deflate negotiation header;
  > idle two-service cost is memory-led, a few dollars a month at friends scale; no app
  > sleep by default. One open item carried to Wave 2.2 kickoff: the Metal source builder
  > failed on the Trial account (image deploys worked), so confirm a from-source build (or
  > deploy prebuilt images from CI) before committing. Fly.io stays the one-day fallback.

- Internal service-to-service auth line, append:
  > SP3 confirmed `service.railway.internal` is reachable service-to-service by plain HTTP
  > on any port and is NXDOMAIN on the public internet, and that a service without a
  > generated domain has no public endpoint. The static-bearer assumption holds: the
  > `/internal` endpoint is not publicly reachable, so the blast radius stays forced
  > disconnects, not data.

## Appendix: teardown proof

Everything created for SP3 was destroyed. Account state (one throwaway SSH key added for
`railway ssh`) was also removed. Proof captured at the end of the run:

```
# services deleted one by one, then the list is empty:
$ railway service list
No services found in environment 'production'

# project deletion accepted:
$ railway delete -p adbfe7a5-3469-4682-9fb3-086bfa64bfe0 -y --json
{"id":"adbfe7a5-3469-4682-9fb3-086bfa64bfe0"}

# deletedAt went from null (pre-teardown) to a timestamp (scheduled hard delete):
$ railway usage projects --json
project: crossy-sp3-spike | deletedAt: 2026-07-11T03:35:19.873Z

# the throwaway SSH key is gone, registry back to its original empty state:
$ railway ssh keys list
No SSH keys registered with Railway.
```

Railway schedules the project's hard delete, so `railway list` still shows the name during
the window; the services are already deleted (no compute, no billing) and `deletedAt` is
set. Local test processes were killed and verified: `pgrep -af crossy-v4` shows no
`idle.js`, `deflate.js`, or `hello.js` process. The throwaway toy code and probe scripts
were deleted from the worktree before this report was committed.
