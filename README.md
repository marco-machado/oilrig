# Ocean Home

A first-person, multiplayer WebGPU world. Your home is a glass pavilion on a converted single-deck offshore platform, 20 m above the open ocean, with a helipad, a lower walkway, a stair tower down to a boat landing, and a swim platform. It is furnished, a helicopter calls on a schedule, and a tender is moored at the landing. AI agents can come aboard through a REST/SSE API or MCP and appear to everyone as ordinary avatars. Everything is procedural: geometry, materials, sky, ocean and sound. No assets are downloaded.

Built on Three.js r186 (`WebGPURenderer` + TSL), Rapier 0.21 physics, recast-navigation 0.43, Hono + `ws` on Node 24.

![Reference vs. Ocean Home](docs/screenshots/compare-reference.png)

## Run it

```bash
pnpm install
```

```bash
pnpm dev
```

Open http://localhost:5173. The client (Vite, port 5173) proxies `/ws`, `/api` and `/mcp` to the world server (port 8787). You need a WebGPU browser: current Chrome or Edge, or Safari 26+.

To run a second copy next to the first, set the ports: `PORT=8790 node apps/server/src/index.ts` and `CLIENT_PORT=5180 SERVER_URL=http://localhost:8790 pnpm --filter @ocean-home/client exec vite`.

Production (the server also serves the built client):

```bash
pnpm build && pnpm start
```

Then open http://localhost:8787.

### Controls

| Key | Action |
|---|---|
| W A S D / arrows | Move |
| Shift | Run |
| Space | Jump |
| E | Open / close the door you're looking at |
| T or Enter | Chat |
| Tab (hold) | Who's on board |
| Esc | Menu: graphics quality, FOV, sensitivity, invert look, volume |

Gamepads work too: left stick moves, right stick looks, A jumps, X interacts, LB runs.

## Configuration (server environment)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` / `HOST` | `8787` / `0.0.0.0` | Listen address |
| `JOIN_PASSWORD` | unset | If set, players must enter it to join |
| `DAY_LENGTH_MINUTES` | `120` | Real minutes per in-game day |
| `REAL_TIME` | `false` | Use the real clock at the platform's location (off Rio de Janeiro) |
| `TIME_OFFSET_HOURS` | `0` | Shift the in-game clock |
| `WEATHER_SEED` | `1337` | Seed of the deterministic weather sequence |
| `DATA_DIR` / `DB_PATH` | `apps/server/data` | SQLite file holding chat history and player colours |
| `STATIC_DIR` | `apps/client/dist` | Built client to serve |
| `HELI_INTERVAL_MINUTES` | `15` | Time between helicopter arrivals |
| `HELI_STAY_MINUTES` | `4` | How long it stays on the pad |
| `HELI_FIRST_ARRIVAL_MINUTES` | `1` | Delay before the first arrival after start |
| `AGENTS_PER_KEY` / `MAX_AGENTS` | `3` / `24` | AI avatars per API key, and in total |
| `AGENT_IDLE_MINUTES` | `30` | An agent with no API calls for this long leaves |

## Deploy

`docker/` has a Dockerfile, a compose file and a Caddyfile. Caddy is included because WebGPU only runs in a secure context (HTTPS), except on localhost.

```bash
DOMAIN=home.example.com JOIN_PASSWORD=change-me docker compose -f docker/compose.yaml up -d --build
```

## Bring an AI agent aboard

![An AI agent on the helipad, seen from the terrace; the helicopter holds off until the pad is clear](docs/screenshots/agent-on-helipad.png)

Agents use bearer API keys. Keys are stored as SHA-256 hashes in the server's SQLite file; the key itself is printed once.

```bash
pnpm keys create my-agent --rate 120
```

`pnpm keys list` shows them and `pnpm keys revoke <id>` disables one. Each key has its own rate limit (requests per minute, with bursts of a quarter of that); over it, the API answers `429` with `Retry-After`. In Docker: `docker compose -f docker/compose.yaml exec app node apps/server/src/cli/keys.ts create my-agent`.

### MCP (Claude and other MCP clients)

The server speaks MCP over Streamable HTTP at `/mcp` (`@modelcontextprotocol/server` 2.x, stateless per request). To add it to Claude Code:

```bash
claude mcp add --transport http ocean-home http://localhost:8787/mcp --header "Authorization: Bearer ohk_…"
```

Then ask Claude to join, walk somewhere and say hello. The avatar belongs to the key, so the tools need no session.

| Tool | What it does |
|---|---|
| `join_world` | Come aboard with a name (optionally at a place). Returns the existing avatar if the key already has one of that name. |
| `leave_world` | Leave. |
| `look` | Perception: objects in view, nearby avatars, zone and area, time, weather, the helicopter. |
| `list_places` | Named destinations (`helipad`, `living-room`, `boat-landing`, `firepit`, `hammocks`…). |
| `move_to` | Walk a navmesh route to a place, an object (`living-sofa`, `door-east`), an avatar, or `[x, y, z]`. Doors on the route are opened. Waits for arrival unless `wait: false`. |
| `walk` | Step forward, backward, left or right for a distance or a time. |
| `turn` | By degrees, to a compass heading, or to face something. |
| `interact` | Open, close or toggle a door within reach (4 m, the same rule people have). |
| `say` | Chat. People see it in the chat log and in a bubble over the avatar. |
| `read_messages` | Chat heard since the last call. |
| `get_world_status` | Time, weather, who is aboard, doors, helicopter schedule. |

### REST and SSE

Everything is under `/api/v1`, described by an OpenAPI 3.1 document at `/api/v1/openapi.json` (generated from the zod schemas with `@hono/zod-openapi`).

| Method and path | |
|---|---|
| `GET /world` | Status: time, weather, avatars, doors, helicopter |
| `GET /places` | Named places |
| `GET /avatars`, `POST /avatars` | Your avatars; spawn one (`{ "name", "place"? }`) |
| `GET /avatars/{id}`, `DELETE /avatars/{id}` | Status; leave |
| `POST /avatars/{id}/actions` | `{ "action": { "type": "move_to" \| "walk" \| "turn" \| "interact" \| "stop", … }, "wait"?, "timeoutSeconds"? }` |
| `GET /avatars/{id}/perception` | Perception |
| `POST /avatars/{id}/chat`, `GET /avatars/{id}/messages` | Say something; unread chat |
| `GET /chat` | Recent chat |
| `GET /events` | Server-Sent Events: `join`, `leave`, `chat`, `door`, `weather`, `helicopter`. Send `Last-Event-ID` to replay what you missed. |

```bash
curl -s -X POST localhost:8787/api/v1/avatars -H "Authorization: Bearer $KEY" -H 'content-type: application/json' -d '{"name":"Scout"}'
```

```bash
curl -s -X POST localhost:8787/api/v1/avatars/$ID/actions -H "Authorization: Bearer $KEY" -H 'content-type: application/json' -d '{"action":{"type":"move_to","place":"helipad"}}'
```

```bash
curl -N localhost:8787/api/v1/events -H "Authorization: Bearer $KEY"
```

### How agents work

- **Bodies:** each agent is simulated on the server at 60 Hz with the same `CharacterMotor` the browser uses for prediction, so it climbs the same ramps and is stopped by the same walls, rails, glass and furniture. Browsers get agents in the normal snapshots and draw them as normal avatars, with an **AI** badge on the name tag.
- **Navigation:** a recast/detour navmesh (tile cache, 10 cm cells, 0.4 m agent radius) is generated at start-up from the triangles of the actual Rapier colliders. Doorways count as open; an agent opens a closed door when its route passes through it. The parked helicopter is a tile-cache obstacle, so routes go around it. If the target cannot be reached, the agent walks to the closest reachable point and says so (`nearest`).
- **Perception** is computed, not rendered: semantic objects (furniture, doors, stairs, pool, helipad, planters, legs, the tender, the helicopter) within a 120° field of view and range are checked with Rapier ray casts from eye height. Clear glass does not block sight; frosted glass, walls and furniture do. Bearings are degrees from straight ahead, positive to the right.

```json
{
  "self": { "position": [-5.79, 20.14, -4.99], "heading": 290, "facing": "W", "zone": "pavilion",
            "area": { "id": "living-room", "name": "Living room", "distance": 0.2 }, "surface": "stone", "task": null },
  "time": { "local": "02:27", "daylight": "night", "sunElevation": -56.7 },
  "weather": { "kind": "clear", "windSpeedMs": 5.2, "windFrom": "S", "waveHeightM": 0.6 },
  "visible": [
    { "id": "living-sofa", "kind": "sofa", "distance": 4, "bearing": 27, "direction": "ahead-right" },
    { "id": "coffee-table", "kind": "coffee-table", "distance": 5.4, "bearing": 40, "direction": "ahead-right" }
  ],
  "avatars": [], "helicopter": null
}
```

## Life on board

- **Furniture**, procedural like everything else and solid (colliders in the shared layout): a sofa, coffee table and rug in the living room, a dining table with six chairs, a stone kitchen island with bar stools and a back counter, a bed with nightstands and lamps, a freestanding bath, a firepit lounge with three outdoor sofas and real flames, sun loungers by the pool, and two hammock nets slung between the hangers on the north side of the lower walkway (you can jump onto them).
- **Helicopter:** arrives on the server's schedule from the open-sea side, into the wind, and lands on the pad. It holds off while anyone stands within 7 m of the pad centre, waves off if someone steps under it during the descent, shuts down while parked (it is solid then) and spins up before leaving. The server broadcasts only phase changes; every client evaluates the same pose function from the shared clock. Rotor wash flattens the sea and sends ragged foam rings outward, and kicks up spray on the deck. The sound is synthesized: blade slap from a pulse train at the blade-passing frequency, band-passed noise chopped by it, turbine whine and tail-rotor buzz, placed in 3D with distance filtering and Doppler.
- **Tender:** a rigid-inflatable boat moored at the boat landing. A compute pass samples the FFT ocean at five points around the hull (inverting the choppy horizontal displacement by fixed-point iteration) and reads the heights back from the GPU; heave, pitch and roll follow them through damped springs.

| | |
|---|---|
| ![Firepit lounge at dusk](docs/screenshots/firepit-lounge.png) | ![Living room](docs/screenshots/living-room.png) |
| ![Helicopter landing with rotor wash](docs/screenshots/helicopter-landing.png) | ![Tender at the boat landing](docs/screenshots/tender.png) |

## How it fits together

```
packages/shared   One source of truth for client and server:
                  layout (every beam, deck, stair, rail, door and piece of furniture as data),
                  Rapier colliders built from it, the character motor, sun/moon astronomy, the
                  seeded weather model, the helicopter schedule and pose function, zod protocol
                  schemas, snapshot interpolation.
apps/server       Shared world: clock + weather, players and agents, server-side movement
                  validation (Rapier shape casts), doors, chat, helicopter schedule, SQLite.
                  WebSocket at /ws, /healthz.
  src/agents      Navmesh (recast tile cache), agent bodies and tasks, perception.
  src/api         REST + SSE (/api/v1), MCP (/mcp), API keys and rate limits.
apps/client       WebGPU renderer, FFT ocean (TSL compute) with GPU height readback, physical
                  sky with stars and moon, TSL procedural materials, furniture, helicopter and
                  rotor wash, tender, clustered night lights, light-probe GI in the pavilion,
                  post (GTAO, TRAA, bloom, lens flare; SSR on Ultra), rain, synthesized audio,
                  first-person controls, avatars, UI.
```

The client predicts its own movement with the same motor the tests use. The server accepts poses only if they are physically plausible: speed, climb rate, no passing through walls, rails, furniture, closed doors or the parked helicopter, and no standing inside geometry. Otherwise it sends a correction. Agents are simulated by the server itself with the same motor, so they need no validation.

Every layout element, place and zone has a semantic `id`/`kind`; the server's in-process event bus (`join`, `leave`, `chat`, `door`, `weather`, `helicopter`) feeds the SSE stream and the agents' inboxes.

## Tests

```bash
pnpm test
```

These are behaviour tests (Vitest), with no mocks and no snapshot-of-self:

- **Walkability:** the real character controller walks every route: rooms, pool, helipad, both stairs, a full walkway lap, and down the tower to the swim platform, all with the furniture in place; it is stopped by the kitchen island, threads around the living-room seating, reaches the firepit lounge, and can jump onto a hammock net.
- **Containment:** random walkers for 4 simulated minutes from 11 starting points (including the hammock nets and the firepit lounge) never fall into the sea.
- **Agent navigation:** an agent walks navmesh routes from the terrace to all 19 places (stairs, tower and all), opens closed doors on its way, keeps a body's width from furniture, goes around the parked helicopter, gets as close as it can to an unreachable roof, and is stopped by the helipad's net stop.
- **Perception:** clear glass does not block sight; the bedroom divider wall and the frosted bath glass do; objects outside the field of view are not reported; bearings and distances of other avatars are right; zone, area, time and weather are reported.
- **Helicopter:** a full schedule flown in simulated time lands exactly on the pad, never dips into the deck or skims the sea, never moves faster than a helicopter can, shuts down and spins up; it holds while the pad is occupied, waves off when someone walks under it, comes in from downwind over the open sea, is solid while parked, and moves anyone underneath clear at touchdown.
- **REST and SSE API:** missing, malformed and revoked keys are refused; keys are never stored in plain text; rate limits are per key; a spawned avatar is seen by a WebSocket player, walks to a place and chats; events stream in order and replay with `Last-Event-ID`; avatars are private to their key; the keys CLI creates, lists and revokes keys a running server honours.
- **MCP:** over Streamable HTTP with the official client: the eleven tools are listed; join → move_to the helipad → say hello is seen and heard by a WebSocket player; `read_messages` hears a reply once; `interact` refuses doors out of reach and opens one in reach; `leave_world` is seen.
- **Sun position:** checked against independent references: solstice and equinox geometry, and NOAA solar-noon times.
- **Weather:** values stay in physical bounds, nothing jumps between samples, every weather kind is reached, and the sequence is deterministic.
- **Movement validation:** honest runs, stair climbs and jumps are accepted; teleports, speed hacks, flying, and clipping through doors or rails are rejected.
- **Interpolation:** snapshots under jitter and out-of-order delivery still produce smooth motion.
- **Server:** protocol fuzzing, two-player sync (movement, chat, doors), and session restore.

Browser checks use Playwright with the installed Chrome and a temporary profile:

```bash
pnpm test:render
```

Every quality preset renders with no console or WebGPU errors. Two more checks run in the browser: the tender's heave follows the wave heights read back from the GPU, and a landing helicopter spins its rotor and drives the deck spray and sea wash.

```bash
pnpm perf
```

Measures frame rate at 2560×1440 on High from five viewpoints.

```bash
pnpm screenshots
```

Writes the verification captures to `docs/screenshots/`.

### Visual debug URLs

Add query parameters to view a fixed scene: `?offline&cam=ref&date=2026-12-21&hour=8.4&weather=storm&q=ultra`

- **Cameras:** `ref`, `refn`, `aerial`, `deck`, `helipad`, `swim`, `interior`, `walkway`, `living`, `kitchen`, `bedroom`, `lounge`, `hammocks`, `tender`, `pad`.
- **Weather:** `clear`, `fair`, `overcast`, `rain`, `storm`, `fog`.
- **Helicopter:** `heli=approach|hold|descend|landed|depart` fixes a phase; `heliT=<seconds>` starts that far into it (e.g. `cam=pad&heli=descend&heliT=20`).

## Credits

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
