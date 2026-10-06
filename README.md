# Aim Arena

2v2 and 3v3 arena shooter with abilities, playable in the browser. Server-authoritative, bots fill empty slots, first team to 3 round wins takes the match.

## Run it

1. Install Node.js 18 or newer from https://nodejs.org
2. In this folder: `node server.js` (no `npm install` needed, there are no dependencies)
3. Open http://localhost:3000, pick a mode, a map, a team, a champion and three skills, then click QUICK PLAY or RANKED

The browser loads Three.js from a CDN (jsDelivr), so it needs internet access.

## Play modes

- **Quick play**: drops you straight into the fullest open room with the same mode, map and a free slot on your team (or makes one). Bots fill empty slots.
- **Ranked** (needs an account): searches for another player near your rating (band starts at 250 and widens 60 per second). After 8 seconds without a match, bots fill in. Elo K=32. Leaving a ranked match early counts as a loss.
- **Maps**: Olympus (marble, balanced), Foundry (lava pit in the middle), Frostpeak (open, sniper pillars), Labyrinth (tight corridors).
- **Between matches**: after a match ends you get 15 seconds to change champion and skills for the next one.

## Accounts

Sign up in the menu (name + password). Passwords are hashed (scrypt). Rank tiers: Bronze, Silver (1000), Gold (1200), Platinum (1400), Diamond (1600), Olympian (1800).

Render's free plan wipes the disk on every restart, so accounts only last if you connect a free Upstash Redis database:

1. Create a free database at https://upstash.com (Redis)
2. Copy the REST URL and REST TOKEN
3. In Render, Environment tab, add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, then redeploy

Without them the menu shows a warning that accounts are temporary. Locally you can set `DATA_DIR` to choose where the fallback file is kept.

## Play with friends

Anyone who can reach your server and picks the same mode, map and ranked setting joins the same room. On your home network, share `http://<your-computer-IP>:3000`. Over the internet, host the folder on any Node host (Render, Fly.io, a VPS). Set the port with the `PORT` environment variable.

## Controls (rebindable under CONTROLS in the menu or pause screen)

| Key | Action |
|---|---|
| W A S D | Move |
| Space | Jump |
| C or Shift (hold) | Crouch: half speed, lower view, smaller hitbox, no jumping |
| Mouse | Aim. Left click shoots, one shot per click (semi-auto) |
| Q / E / R | Your three chosen skills |
| Esc | Pause menu |

## Models (pick one)

| Model | HP | Speed | Notes |
|---|---|---|---|
| Striker | 100 | 7 | Balanced |
| Vanguard | 130 | 6.2 | Tanky, slower |
| Phantom | 80 | 8 | Fast, fragile |
| Warden | 105 | 6.8 | Heals 50% more |

Each model has its own look in game. Enemy name plates show only while that enemy is visible; allies always show.

## Skills (pick any three, any model)

| Spell | Cooldown | Effect |
|---|---|---|
| Dash | 5s | Burst of speed in your move direction |
| Shield | 14s | 60% less damage for 2.5s |
| Heal | 18s | Restore 35 HP |
| Shockwave | 10s | Aimed shot: pushes the first enemy hit straight back. No damage |
| Bind | 11s | Your next rifle shot (6s to use it) roots the enemy it hits for 1.8s |
| Fire Pool | 14s | Ignite the ground where you aim (3m wide, 5s): burns enemies standing in it |
| Frost Nova | 12s | 12 damage and 3s slow to enemies within 5m |
| Incendiary Rounds | 16s | 6s: rifle hits leave fire under the target's feet |
| Barbed Rounds | 14s | 6s: rifle hits cause bleed (worse while the target moves) |
| Explosive Rounds | 15s | 6s: rifle hits explode for 14 damage to other enemies within 3m |

Rifle: 22 body / 45 headshot damage, 100 HP, 0.18s between shots. Lava on Foundry burns anyone touching the floor in it.

## Layout (all files sit in one flat folder)

| File | Role |
|---|---|
| `index.html` | Menu (account, mode, map, team, champion, skills, controls) and HUD |
| `main.js` | Client: rendering, prediction/interpolation, input, keybinds, HUD logic |
| `world.js` | Themed arena visuals per map, player models, menu podium |
| `maps.js` | Map data: walls, hazards and visual theme for each map |
| `sim.js` | Movement, raycasts, skills/models list. Used by server and client |
| `game.js` | Room: rounds, hitscan, spells, bot AI |
| `lobby.js` | Quick play placement and ranked queue |
| `auth.js`, `store.js` | Accounts, sessions, Elo, Upstash/file storage |
| `server.js`, `ws-lite.js` | HTTP + built-in WebSocket server (60 Hz sim, 30 Hz snapshots) |
| `test/` | `npm test`: bot matches on every map, live WebSocket, ranked queue, accounts, lag compensation, skills, maps |

## Known limits

- Lag compensation rewinds enemies up to 0.4s for shots. Very high ping (over about 400ms) is still unfair.
- Players do not collide with each other.
- To add a map, add an entry to `maps.js` (keep walls point-mirrored so teams stay fair).
- No leaderboard yet.
