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
| Q / E / R | Your three chosen skills |
| Esc | Pause menu |

## Models (pick one)

| Model | HP | Speed | Notes |
|---|---|---|---|
| Striker | 100 | 7 | Balanced |
| Vanguard | 130 | 6.2 | Tanky, slower |
| Phantom | 80 | 8 | Fast, fragile |
| Warden | 105 | 6.8 | Heals 50% more |

## Skills (pick any three, any model)

| Spell | Cooldown | Effect |
|---|---|---|
| Dash | 5s | Burst of speed in your move direction |
| Shield | 14s | 60% less damage for 2.5s |
| Heal | 18s | Restore 35 HP |
| Shockwave | 12s | 25 damage and knockback to enemies within 6m |
| Bind | 11s | Instant shot along your crosshair: roots the first enemy hit for 1.8s |
| Fire Pool | 14s | Ignite the ground where you aim (3m wide, 5s): burns enemies standing in it |
| Frost Nova | 12s | 12 damage and 3s slow to enemies within 5m |
| Incendiary Rounds | 16s | 6s: rifle hits leave fire under the target's feet |
| Barbed Rounds | 14s | 6s: rifle hits cause bleed (worse while the target moves) |
| Explosive Rounds | 15s | 6s: rifle hits explode for 14 damage to other enemies within 3m |

Rifle: 22 body / 45 headshot damage, 100 HP, 0.18s between shots.

## Layout (all files sit in one flat folder)

| File | Role |
|---|---|
| `index.html` | Menu (champion + 3 skills) and HUD |
| `main.js` | Client: rendering, prediction/interpolation, input, HUD logic |
| `world.js` | Olympus arena visuals (sky, marble, columns, torches) and menu podium |
| `sim.js` | Movement, map, raycasts, skills/models list. Used by server and client |
| `game.js` | Room: rounds, hitscan, spells, bot AI |
| `server.js`, `ws-lite.js` | HTTP + built-in WebSocket server (60 Hz sim, 30 Hz snapshots) |
| `test/` | `npm test`: bot matches, live WebSocket client, lag compensation, skills, map |

## Known limits

- Lag compensation rewinds enemies up to 0.4s for shots and Bind. Very high ping (over about 400ms) is still unfair.
- Players do not collide with each other.
- One map. Edit `buildWalls()` in `sim.js` (keep it point-mirrored so teams stay fair).
- No matchmaking, accounts or ranks yet. Rooms are created per mode when someone joins.
