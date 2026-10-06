# Aim Arena

A fast arena shooter that runs in your browser. 2v2, 3v3 or free-for-all, three skills of your choice, bots to fill empty slots, ranked matches and a leaderboard. Nothing to download or install.

## Play now

**https://aimarena.onrender.com**

Open the link in Chrome, Edge or Firefox on a computer (mouse and keyboard), pick a mode, a map, your look and three skills, then press **QUICK PLAY** (or **RANKED** once you have an account).

- The first visit after a quiet spell can take up to a minute while the server wakes up. If the page is slow, wait and reload.
- It needs a normal internet connection. A wired or good wifi connection gives the fairest hits.
- Guests can play everything except ranked, XP and the leaderboard. Sign up (name + password) in the menu to keep your level, unlocks and rating.
- If the game looks outdated after an update, press **Ctrl+Shift+R** to reload fresh.
- Invite friends by sending them the link: anyone who picks the same mode and map is placed in the same room.

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
| Gladiator Colosseum | 56 m | North / south | Round sand arena, pillar ring, low arcs |
| Agora Market | 48 m | North / south | Compact market square, fast flanks |
| Ember Dunes | 76 m | West / east | Wide desert ruins, dune ridges |
| Ashpit | 64 m | Free-for-all | Lava pit with bridges and pillars (FFA) |
| Necropolis | 96 m | Free-for-all | Ruined graveyard city with four districts and lava pits |
- **Between matches**: after a match ends you get 15 seconds to change skills for the next one.
## Hit feedback

Damage numbers float off enemies you hit (gold and bigger for headshots, with a two-tone ding), a red arc shows the direction you were hit from, and the kill feed is top right. After you die to a player, a 3 second kill-cam replays the last moments from the killer's eyes.
## Ammo and fire rate

One shot every half second. You start every round (and every respawn in free-for-all) with 15 rounds. A kill gives +5, up to 30. There is no reload: at 0 you can't shoot, only use skills, until you get a kill (or the next round). The ammo count is bottom right, with a bar showing the shot cooldown. Tune AMMO_START, AMMO_KILL, AMMO_MAX and FIRE_INTERVAL at the top of `sim.js`.
## Spectating

Menu > Watch live games lists every game with at least one real player (map, mode, score, who is playing, how many are watching). Click WATCH to follow a player in first person. Click, the arrow keys or A/D switch players, right click goes back, LEAVE returns to the menu. Spectators can't affect the game, and up to 20 can watch one room.
## Controls (rebindable under KEYBINDS in the menu or pause screen)

Every action (including Fire and the three skills) can use a keyboard key, any mouse button (left, right, middle, side buttons) or a scroll-wheel notch. The CROSSHAIR button opens the crosshair editor (shape, colour, size, thickness, gap, opacity, outline, centre dot).

| Key | Action |
|---|---|
| W A S D | Move |
| Space | Jump |
| C or Shift (hold) | Crouch: 75% speed, lower view, smaller hitbox, no jumping |
| Mouse | Aim. Left click shoots, one shot per click (semi-auto) |
| Wheel | Unbound by default; can be bound to any action |
| Q / E / R | Your three chosen skills |
| Esc | Pause menu |
## Characters and customization

Everyone has the same stats: 150 health, speed 7.0, normal heal. Shots to kill: 7 body / 4 head. Nothing about your character changes how you play.

The main menu is one compact screen: name, mode and team, then four tiles (Map, Skills, Character, Options) that each open their own page, then Watch live / Leaderboard / Profile / Daily / Practice / Admin and the play buttons.

**Bots** (next to Team): Easy, Normal, Hard or Insane. It sets how well the bots in your match aim and how fast they react. Players who pick different levels are put in different rooms. Ranked always uses Normal.

Menu > Character (Customize) changes how you look: body style (Striker, Vanguard, Phantom, Warden), helmet (8), shoulders (6), back piece (7), material (8), kill effect (8), plus primary, secondary and glow colours (presets or any colour). Randomize and Reset are there too. Your look is saved in your browser and everyone in the match sees it. Team colour still shows on a glowing band so you can tell sides apart. Fast graphics lowers character detail.

Maps use generated textures (marble, forged metal, ice, brick, crypt stone) with per-theme details such as snow caps, ember strips and moss. Enemy name plates show only while that enemy is visible; allies always show.
## Skills (pick any three, 5 skill points to spend)

Each skill costs 1 or 2 points. The default set (Dash, Heal, Shield) uses all 5.

**How skills fire.** Most skills are shot-based. Instant: Dash, Shield, Heal, Pushback, Frost Nova, Blink. Buff your next rifle shot: Bind, Barbed Rounds, Overcharge. **Aimed** (marked "Press, then shoot" in the picker): Shockwave, Fire Pool, Grapple, Smoke, Decoy, Slow Trap, Mark, Gravity Well, Polymorph. Press the key (the card glows gold, crosshair turns gold, "ARMED: SHOOT TO CAST" shows), then click: that shot carries the skill, uses no ammo, does no rifle damage, and starts the cooldown. Press the key again to put it away, or press another aimed skill's key to swap. Decoy and Slow Trap land where the shot lands. The cooldown only starts when the shot fires. Dying, a new round or Polymorph clears the armed skill. In `sim.js` a skill is aimed when its entry has `aim: true`.

| Spell | Cooldown | Effect |
|---|---|---|
| Dash | 5s | Burst of speed in your move direction |
| Shield | 14s | 40% less damage for 2.5s |
| Heal | 18s | Restore 50 HP |
| Shockwave | 10s | Aimed shot: pushes the first enemy hit straight back. No damage |
| Pushback | 10s | Blast around you: shoves every enemy within 7m away from you. No damage |
| Blink | 9s | Teleport 9m forward where you look (stops at walls) |
| Grapple | 8s | Hook the wall you aim at (28m) and pull yourself to it. No cooldown if nothing is hooked |
| Smoke | 14s | Smoke cloud where you aim, blocks sight for 7s |
| Decoy | 16s | A fake copy of you runs forward for 6s; an enemy shot at it is wasted |
| Bind | 11s | Your next rifle shot (6s to use it) roots the enemy it hits for 1.8s |
| Fire Pool | 14s | Ignite the ground where you aim (3m wide, 5s): burns enemies standing in it |
| Frost Nova | 12s | 12 damage and 3s slow to enemies within 5m |
| Barbed Rounds | 14s | 6s: rifle hits cause bleed (worse while the target moves) |
| Slow Trap | 12s | Drop a mine where you stand (max 2, lasts 45s). First enemy to step on it is slowed 3s |
| Mark | 14s | Tag the enemy you aim at: your team sees them through walls for 5s. No cooldown on a miss |
| Gravity Well | 16s | Where you aim: pulls everything within 4.5m toward the centre for 2.5s, slowing enemies |
| Polymorph | 18s | Aimed shot: turns the enemy into a sheep for 2s. They can move but cannot shoot or cast |
| Overcharge | 14s | Your next rifle shot (6s to use it) does double damage |

Rifle: 22 body / 45 headshot damage, 150 HP, 0.5s between shots. Sounds are soft synthesized tones with a Volume slider under Options. Lava on Foundry burns anyone touching the floor in it.
## Scoreboard, recap, HUD style and practice (v0.9)

- **Scoreboard:** hold **Tab** during a match to see both teams (or everyone in free-for-all) with kills, deaths and K/D, bots marked BOT.
- **Match recap:** the page between matches (where you pick skills again) now starts with your kills/deaths, accuracy, headshot %, damage, best streak and skills used, plus a table for every player with an MVP tag.
- **Damage numbers and health bars:** Menu > Options > Numbers & bars, or the same button in the pause menu. You can change damage number size, colours, outline, motion (rise / pop / still) and how long they last; the bars above players (size, thickness, opacity, names, health number, team / by-health / custom colours); and your own health bar (size, number, colour). Saved in your browser.
- **Practice** (menu tile): *Aim range* is the old target range. *Custom match* is a private match against bots with your own rules: mode and map, bot level, rounds to win and round length (or kills to win and match length in free-for-all), skills on/off, headshots only, infinite ammo. Nothing counts toward stats, rank or challenges, and it is never listed under Watch live.
- **Quick Play** fills a room that already has players (taking over a bot slot) before it makes a new room. The bot level of a room is set by whoever created it.

## Titles, icons and name colours (v0.9.1)

Profile > **Edit profile** (signed in). Pick a **title** (Rookie, Marksman, Duelist, Gladiator, Champion, Legend by level; Slayer / Reaper by kills; Victor / Warlord by match wins; Gold / Platinum / Diamond / Olympian by rating), an **icon** (12, unlocked by level, the crown at rating 1800) and a **name colour** (9, by level). Locked ones show what unlocks them. What you pick shows next to your name on the scoreboard, recap, leaderboard, kill feed and above your head (icon).

The game owner can also wear any custom title, icon and colour, and can award special ones to players.

## Rivals and sounds

- Rivalry: every kill between two signed-in human players on opposite teams adds to a lifetime head-to-head. From the second encounter a toast shows `you 7 - 4 them` (with NEMESIS when you are 2+ behind). Profile lists your top rivals. Bots and guests do not count.
- Every kind of hit has its own sound: normal, headshot, overcharged (deep thump), bound (chain), into a shield (clang), barbed (squelch), frost nova (chime). Skills also have their own cues (trap snap, mark ping, gravity drone, polymorph baa, overcharge power-up).
## Match end, kill effects, daily challenges

- After every match: PLAY AGAIN (everyone pressing it starts the next match in 2s; otherwise the normal 15s timer runs) and LEAVE.
- Kill effects: what everybody sees where YOU score a kill. Burst (free), Embers Lv3, Frost shatter Lv6, Lightning Lv9, Confetti Lv12, Ghost rise Lv16, Gold coins Lv20, Void collapse Lv25. Clicking one in the customizer previews it.
- New parts: Crown helm Lv18, Skull mask Lv22, Orbs Lv15, Crystals Lv24, Halo Lv16, Wings Lv27, Gilded material Lv20, Void material Lv26.
- Daily challenges (menu button): 3 per day (easy / medium / hard) paying 40 / 70 / 110 XP. Same for everyone, reset at midnight US Central. Kills and damage on bots do not count, and matches only count with 2+ real players. Needs a signed-in account.
## Rifle and skins

Everyone carries an AK-style rifle (built from simple shapes, no downloads). The **Rifle skin** row in the customizer picks a paint job; other players see it on your gun too, and the menu podium previews it. Unlock levels: Classic AK (free), Redline Lv2, Jungle Camo Lv4, Wasteland Lv6, Frostbite Lv8, Neon Grid Lv11, Inferno Lv14, Toxic Lv17, Gilded Lv20, Void Prism Lv24. Neon Grid uses your glow colour; the small strip on top of the rifle always uses it. Skins are cosmetic only. To tune where the rifle sits on screen, edit `GUN_X`, `GUN_Y`, `GUN_Z`, `GUN_SCALE` near the top of the viewmodel block in `main.js`.
## Levels, unlocks, leaderboard, practice range

- XP: +5 per enemy kill, +40 per finished match, +60 for a win. Level = 1 + floor(sqrt(XP / 60)), max 30.
- Customizer parts unlock by level (locked ones show a lock and the level needed). Guests are level 1 and earn nothing.
- Leaderboard (menu button): Wins, Kills, Rating tabs, top 25. Wins = match wins in any mode. Profile shows level, XP, kills, deaths, K/D, wins.
- Practice range: private room with 5 moving target dummies, infinite ammo, no timer. Panel shows shots, hits, accuracy, headshots. Backspace resets. Nothing counts toward stats.
## Accounts

Sign up in the menu (name + password, 6-72 characters). Passwords are never stored, only a salted scrypt hash. Rank tiers: Bronze, Silver (1000), Gold (1200), Platinum (1400), Diamond (1600), Olympian (1800).

## Fair play and safety

- The server decides everything (movement, hits, ammo, cooldowns), so a modified client cannot give itself damage, ammo or speed. Enemies you cannot see are not even sent to your browser, so wall-hacks have nothing to read.
- Spectators see the match 8 seconds late so a watching friend cannot call out positions.
- Suspicious behaviour is logged for the owner to review (input flooding, firing during cooldown, view snapping, runs of perfect headshots, repeated reports).
- Report a player from the pause menu or end screen. Names are filtered for profanity, leetspeak and impersonation.
- Your IP address is never stored; moderation logs only keep a 12-character salted hash.
- Your password and login token are only ever sent to this site. Never type your password anywhere else, and the owner will never ask you for it.

## For the owner (hosting and moderation)

Players do not need any of this. The game is hosted on Render from the GitHub repo `TokeGG/aimarena`; every push to `main` redeploys it (wait for **Deploy live**, then players reload with Ctrl+Shift+R). Running it locally is only for development: `node server.js` (Node 18+, no dependencies) then open http://localhost:3000, and `npm test` runs the test suite.

### Environment variables (Render > Environment)

| Variable | Purpose |
|---|---|
| `ADMIN_KEY` | Secret of 12+ characters that unlocks `/admin`. Without it the admin page is switched off. |
| `OWNER_USERS` | Comma-separated game account names that count as owner (free-form title, icon and name colour). |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Free Upstash Redis database so accounts, stats, bans and logs survive restarts (Render's free disk is wiped on every restart). |
| `TRUST_PROXY_HOPS` | Set to `1` on Render so the real player address (not Render's proxy) is used for limits and bans. |
| `ALLOWED_ORIGINS` | Extra origins allowed to open game sockets (a custom domain). The site's own address is always allowed. |
| `MAX_CONN_PER_IP` | Sockets allowed per address (default 10). |
| `SPEC_DELAY` | Spectator delay in seconds (default 8, `0` = off). |
| `IP_SALT` | Secret salt for address hashes (set any random string so hashes can't be reversed). |
| `BLOCKED_WORDS` | Comma-separated extra words to block in names. |
| `PORT`, `DATA_DIR` | Port and fallback data folder (Render sets the port itself). |

### Upstash setup

1. Create a free Redis database at https://upstash.com.
2. Copy the REST URL and REST TOKEN.
3. Add them as `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in Render and redeploy.

Without them the menu warns that accounts are temporary. `/api/status` shows `persistent: true` when it works.

### Moderating (the Admin page)

1. Set `ADMIN_KEY`, then open `https://aimarena.onrender.com/admin` (or the **Admin** menu button) and press Unlock.
2. Tabs: who is online (account and address hash), flags and reports, bans, Ban someone, and **Owner & titles**.
3. Click Ban account or Ban IP on a row, choose a duration, Ban. The player is disconnected immediately. Unban from the Bans tab.

**Owner and titles:** in the Owner & titles tab type your game account name and press Make owner. Then Profile > Edit profile has an **Owner** box for any title, emoji icon and name colour. You can also award a custom title, icon and colour to any player there, and remove it again. Everything is checked on the server.

### Security measures

| Area | Protection |
|---|---|
| Authority | Server-authoritative simulation; input rate limit; lag-compensation rewind capped by measured ping; per-viewer snapshot culling. |
| Accounts | scrypt password hashes, random 32-byte session tokens in a bearer header (no cookies, so no CSRF), 30-day expiry, generic login errors, constant-time checks, reserved/impersonating usernames refused. |
| Rate limits | Auth requests per IP, 6 new accounts per IP per hour, 10 login tries per account per 5 minutes, admin key guesses 8 per minute (only wrong keys count), report limits per player. |
| Admin | Key compared in constant time, never stored in the page or logs, disabled unless `ADMIN_KEY` is 12+ characters. |
| WebSocket | Same-site origin check, banned-address check, per-address connection cap, 8 KB message and reassembled-message cap, masked frames only, reserved bits/unknown opcodes/oversized or fragmented control frames dropped, slow-reader backlog cap, flood kick. |
| HTTP server | Only listed game files are served (source, tests and data are not), GET/HEAD only for files, 4 KB JSON body cap, header/request timeouts against slow-loris, crash guards. |
| Browser | Content-Security-Policy (scripts only from this site and the pinned jsDelivr three.js build), no framing, no MIME sniffing, HSTS, same-origin opener/resource policy, no referrer, camera/mic/geolocation off. All player text is HTML-escaped before display. |
| Privacy | IP addresses are never stored, only a salted 12-character hash. |

Known gap: three.js is loaded from the jsDelivr CDN (pinned to version 0.170.0). Hosting that one file from this server would let the CSP drop the CDN entirely.

### Files (all in one flat folder)

| File | Role |
|---|---|
| `index.html` | Menu and HUD |
| `main.js` | Client: rendering, prediction, input, keybinds, HUD |
| `world.js`, `textures.js`, `character.js`, `weapon.js` | Arena visuals, generated textures, characters, rifle |
| `maps.js` | Map data (keep walls point-mirrored so teams stay fair) |
| `sim.js` | Shared movement, raycasts, skills, profile rules |
| `game.js`, `lobby.js` | Rooms, rounds, bots; Quick Play and ranked queue |
| `auth.js`, `store.js`, `safety.js` | Accounts and Elo, Upstash/file storage, names and moderation |
| `server.js`, `ws-lite.js` | HTTP + built-in WebSocket server (60 Hz sim, 30 Hz snapshots), admin page |
| `test/` | `npm test`: bot matches on every map, live sockets, ranked queue, accounts, lag compensation, skills, safety |

### Known limits

- Lag compensation rewinds enemies up to 0.4 s; above about 400 ms ping hits feel unfair.
- Players do not collide with each other.
- Kills on bots give no kill stats or XP (matches and wins still do). The practice range counts nothing.
- Stats and the leaderboard only persist with Upstash connected.
