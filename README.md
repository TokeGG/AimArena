# Aim Arena

2v2 and 3v3 arena shooter with abilities, playable in the browser. Server-authoritative, bots fill empty slots, first team to 3 round wins takes the match.

## Run it

1. Install Node.js 18 or newer from https://nodejs.org
2. In this folder: `node server.js` (no `npm install` needed, there are no dependencies)
3. Open http://localhost:3000, pick a mode and two spells, click PLAY

The browser loads Three.js from a CDN (jsDelivr), so it needs internet access.

## Play with friends

Anyone who can reach your server can join the same mode and replaces a bot on a team. On your home network, share `http://<your-computer-IP>:3000`. Over the internet you need to forward port 3000 on your router, or host the folder on any Node host (Render, Fly.io, a VPS). Set the port with the `PORT` environment variable.

## Controls

| Key | Action |
|---|---|
| W A S D | Move |
| Space | Jump |
| Mouse | Aim / left click shoots |
| Q / E | Your two chosen spells |
| Esc | Pause menu |

## Spells (pick two)

| Spell | Cooldown | Effect |
|---|---|---|
| Dash | 5s | Burst of speed in your move direction |
| Shield | 14s | 60% less damage for 2.5s |
| Heal | 18s | Restore 35 HP |
| Shockwave | 12s | 25 damage and knockback to enemies within 6m |

Rifle: 22 body / 45 headshot damage, 100 HP, 0.18s between shots.

## Layout

| File | Role |
|---|---|
| `shared/sim.js` | Movement, map, raycasts. Used by server and client so prediction matches |
| `game.js` | Room: rounds, hitscan, spells, bot AI |
| `server.js`, `ws-lite.js` | HTTP + built-in WebSocket server (60 Hz sim, 20 Hz snapshots) |
| `public/` | Client: rendering, prediction/interpolation, HUD |
| `test/headless.mjs` | `node test/headless.mjs`: bot-only matches + live WebSocket client |

## Known limits

- No lag compensation on hitscan: you shoot what the server sees, so high-ping players must lead slightly.
- Players do not collide with each other.
- One map. Edit `buildWalls()` in `shared/sim.js` (keep it point-mirrored so teams stay fair).
- No matchmaking, accounts or ranks yet. Rooms are created per mode when someone joins.
