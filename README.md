# Aim Arena

2v2 and 3v3 arena shooter with abilities, playable in the browser. Server-authoritative, bots fill empty slots, first team to 3 round wins takes the match.

## Run it

1. Install Node.js 18 or newer from https://nodejs.org
2. In this folder: `node server.js` (no `npm install` needed, there are no dependencies)
3. Open http://localhost:3000, pick a mode, a map, a team, a champion and three skills, then click QUICK PLAY or RANKED (free-for-all has no ranked)

The browser loads Three.js from a CDN (jsDelivr), so it needs internet access.

## Play modes

- **Quick play**: drops you straight into the fullest open room with the same mode, map and a free slot on your team (or makes one). Bots fill empty slots.
- **Ranked** (needs an account): searches for another player near your rating (band starts at 250 and widens 60 per second). After 8 seconds without a match, bots fill in. Elo K=32. Leaving a ranked match early counts as a loss.
- **Free-for-all**: 8 players on the big Necropolis map (96 m wide), everyone for themselves. Respawn after 3 seconds with 1.5 seconds of spawn protection. First to 20 kills, or the best score after 5 minutes.
- **Maps** (each has its own size and layout):

| Map | Size | Teams | Feel |
|---|---|---|---|
| Temple of Zeus | 60 m | North / south | Balanced marble ruins around a central temple |
| Hades' Foundry | 40 m | Opposite corners | Small, a lava pit in the middle crossed by narrow bridges |
| Frostpeak | 84 m | West / east | Huge and open, long sight lines for snipers |
| Labyrinth | 36 m | North / south | A real maze, short sight lines, close fights |
| Necropolis | 96 m | Free-for-all | Ruined graveyard city with four districts and lava pits |
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

## Controls (rebindable under KEYBINDS in the menu or pause screen)

Every action (including Fire and the three skills) can use a keyboard key, any mouse button (left, right, middle, side buttons) or a scroll-wheel notch. The CROSSHAIR button opens the crosshair editor (shape, colour, size, thickness, gap, opacity, outline, centre dot).

| Key | Action |
|---|---|
| W A S D | Move |
| Space | Jump |
| C or Shift (hold) | Crouch: half speed, lower view, smaller hitbox, no jumping |
| Mouse | Aim. Left click shoots, one shot per click (semi-auto) |
| Wheel | Unbound by default; can be bound to any action |
| Q / E / R | Your three chosen skills |
| Esc | Pause menu |

## Champions (pick one)

More health always means slower movement. Fewer shots to kill = faster legs.

| Champion | Role | Health | Speed | Heal | Dies to (body / head shots) |
|---|---|---|---|---|---|
| Vanguard | Tank | 150 | 5.6 | 100% | 7 / 4 |
| Warden | Support | 115 | 6.4 | 150% | 6 / 3 |
| Striker | All-rounder | 100 | 7.0 | 100% | 5 / 3 |
| Phantom | Runner | 70 | 8.6 | 100% | 4 / 2 |

Each champion has its own look in game. Enemy name plates show only while that enemy is visible; allies always show.

## Skills (pick any three, any model)

| Spell | Cooldown | Effect |
|---|---|---|
| Dash | 5s | Burst of speed in your move direction |
| Shield | 14s | 40% less damage for 2.5s |
| Heal | 18s | Restore 35 HP |
| Shockwave | 10s | Aimed shot: pushes the first enemy hit straight back. No damage |
| Pushback | 10s | Blast around you: shoves every enemy within 7m away from you. No damage |
| Bind | 11s | Your next rifle shot (6s to use it) roots the enemy it hits for 1.8s |
| Fire Pool | 14s | Ignite the ground where you aim (3m wide, 5s): burns enemies standing in it |
| Frost Nova | 12s | 12 damage and 3s slow to enemies within 5m |
| Barbed Rounds | 14s | 6s: rifle hits cause bleed (worse while the target moves) |

Rifle: 22 body / 45 headshot damage, 100 HP, 0.18s between shots. Lava on Foundry burns anyone touching the floor in it.

## Layout (all files sit in one flat folder)

| File | Role |
|---|---|
| `index.html` | Menu (account, mode, map, team, champion, skills, controls) and HUD |
| `main.js` | Client: rendering, prediction/interpolation, input, keybinds, HUD logic |
| `world.js` | Themed arena visuals per map, player models, menu podium |
| `maps.js` | Map data: size, spawns, walls, hazards and visual theme for each map |
| `sim.js` | Movement, raycasts, skills/models list. Used by server and client |
| `game.js` | Room: rounds / free-for-all, hitscan, spells, bot AI |
| `lobby.js` | Quick play placement and ranked queue |
| `auth.js`, `store.js` | Accounts, sessions, Elo, Upstash/file storage |
| `server.js`, `ws-lite.js` | HTTP + built-in WebSocket server (60 Hz sim, 30 Hz snapshots) |
| `test/` | `npm test`: bot matches on every map, live WebSocket, ranked queue, accounts, lag compensation, skills, maps |

## Known limits

- Lag compensation rewinds enemies up to 0.4s for shots. Very high ping (over about 400ms) is still unfair.
- Players do not collide with each other.
- To add a map, add an entry to `maps.js` (keep walls point-mirrored so teams stay fair; `npm test` checks the rules).
- No leaderboard yet.
