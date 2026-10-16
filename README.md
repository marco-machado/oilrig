# Ocean Home

A first-person, multiplayer WebGPU world. Your home is a glass pavilion on a converted single-deck offshore platform, 20 m above the open ocean, with a helipad, a lower walkway, a stair tower down to a boat landing, and a swim platform. Everything is procedural: geometry, materials, sky, ocean and sound. No assets are downloaded.

Built on Three.js r186 (`WebGPURenderer` + TSL), Rapier 0.21 physics, Hono + `ws` on Node 24.

![Reference vs. Ocean Home](docs/screenshots/compare-reference.png)

## Run it

```bash
pnpm install
```

```bash
pnpm dev
```

Open http://localhost:5173. The client (Vite, port 5173) proxies `/ws` to the world server (port 8787). You need a WebGPU browser: current Chrome or Edge, or Safari 26+.

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

## Deploy

`docker/` has a Dockerfile, a compose file and a Caddyfile. Caddy is included because WebGPU only runs in a secure context (HTTPS), except on localhost.

```bash
DOMAIN=home.example.com JOIN_PASSWORD=change-me docker compose -f docker/compose.yaml up -d --build
```

## How it fits together

```
packages/shared   One source of truth for client and server:
                  layout (every beam, deck, stair, rail and door as data), Rapier colliders
                  built from it, the character motor, sun/moon astronomy, the seeded weather
                  model, zod protocol schemas, snapshot interpolation.
apps/server       Shared world: clock + weather, players, server-side movement validation
                  (Rapier shape casts), doors, chat, SQLite. WebSocket at /ws, /healthz.
apps/client       WebGPU renderer, FFT ocean (TSL compute), physical sky with stars and moon,
                  TSL procedural materials, clustered night lights, light-probe GI in the
                  pavilion, post (GTAO, TRAA, bloom, lens flare; SSR on Ultra), rain,
                  synthesized audio, first-person controls, avatars, UI.
```

The client predicts its own movement with the same motor the tests use. The server accepts poses only if they are physically plausible: speed, climb rate, no passing through walls, rails or closed doors, and no standing inside geometry. Otherwise it sends a correction.

### Ready for v2

Every layout element, place and zone has a semantic `id`/`kind`, and the server has an in-process event bus (`join`, `leave`, `chat`, `door`, `weather`). The planned REST/SSE/MCP API, AI agent avatars (navmesh + structured perception), helicopter, furniture and boats build on these without restructuring.

## Tests

```bash
pnpm test
```

These are behaviour tests (Vitest), with no mocks and no snapshot-of-self:

- **Walkability:** the real character controller walks every route: rooms, pool, helipad, both stairs, a full walkway lap, and down the tower to the swim platform.
- **Containment:** random walkers for 4 simulated minutes from 9 starting points never fall into the sea.
- **Sun position:** checked against independent references: solstice and equinox geometry, and NOAA solar-noon times.
- **Weather:** values stay in physical bounds, nothing jumps between samples, every weather kind is reached, and the sequence is deterministic.
- **Movement validation:** honest runs, stair climbs and jumps are accepted; teleports, speed hacks, flying, and clipping through doors or rails are rejected.
- **Interpolation:** snapshots under jitter and out-of-order delivery still produce smooth motion.
- **Server:** protocol fuzzing, two-player sync (movement, chat, doors), and session restore.

Browser checks use Playwright with the installed Chrome and a temporary profile:

```bash
pnpm test:render
```

Every quality preset renders with no console or WebGPU errors.

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

- **Cameras:** `ref`, `refn`, `aerial`, `deck`, `helipad`, `swim`, `interior`, `walkway`.
- **Weather:** `clear`, `fair`, `overcast`, `rain`, `storm`, `fog`.

## Credits

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
