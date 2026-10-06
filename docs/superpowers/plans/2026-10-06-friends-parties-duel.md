# Friends, Parties, 1v1 Duel + Ring, Team Switching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 1v1 duels with a sudden-death ring, in-game team switching (menu picker removed), a request/accept friends list with live status, and parties that queue together or play in a private room.

**Architecture:** Duel is mode `1` (players per team) in the existing `Room`, with new duel-only maps and a server-owned ring. Friends are persisted on account records (`social.js`); presence and parties live in server memory (`party.js`) and everything talks over the existing authenticated WebSocket. The lobby gains group tickets so a party is placed all-or-nothing.

**Tech Stack:** Node 18+ ESM, zero dependencies, custom `ws-lite.js`, plain-JS client with three.js (CDN), tests are standalone `node test/*.mjs` chained by `npm test`.

**Spec:** `docs/superpowers/specs/2026-10-06-friends-parties-duel-design.md`

## Global Constraints

- Versions stay below 1.0; this release is `0.10.0` (bump `VERSION` in `sim.js`, `CLIENT_VERSION` in `main.js`, `version` in `package.json` together).
- Zero npm dependencies; flat file layout (new files sit in the repo root next to `server.js`).
- Server is authoritative: every new message is validated server-side, size-capped by the 8 KB WebSocket limit, and requires a verified account (guests get an error message, never state changes).
- Ring constants live at the top of `sim.js`: `RING_START = 45`, `RING_SHRINK_TIME = 25`, `RING_MIN_RADIUS = 3`, `RING_DPS = 8`, `RING_DPS_RAMP = 2`.
- Caps: 50 friends, 20 pending each way, 50 blocked; friend requests 10/min and 30/hour per account; party invites expire after 60 s; party max 4 (FFA), 3 (2v2/3v3), 2 (duel); ranked party caps 2 (2v2), 3 (3v3), 2 (duel).
- Duel: first to 3 round wins (`WIN_ROUNDS` unchanged), ranked allowed and shares the existing rating, duel maps are not offered to 2v2/3v3 and vice versa.
- Team switching only in unranked rooms, only during `countdown` or `matchEnd`, only when the other team has an open (bot) slot.
- All player-visible text is HTML-escaped on the client (`esc()`); usernames validated with `USER_RE` from `auth.js`.
- Commit with the attribution lines from the session reminder; run `npm test` before every commit; do not push (the owner asks for pushes).

## Review Focus

- A guest (no token) sends `fr_*`, `pt_*` or `switch_team`: expected a clear error and no state change, never a crash.
- A friend request to yourself, a banned or unknown account, differing username case, or a duplicate: expected refusal with a message and no duplicate entries.
- A party member disconnects, or the leader leaves, while the party is queued or being placed: expected the rest of the party is still placed together and leadership transfers.
- Two players press Switch team at the same time for the last open slot: expected exactly one succeeds and the other keeps their side.
- The ring is active while spectating or lag-compensated shots happen: expected `rg` reaches spectators and viewers (not dropped by snapshot culling) and ring deaths do not credit a killer or crash kill-feed code.

---

## File Structure

| File | Responsibility |
|---|---|
| `social.js` (new) | Pure friend/block/request operations over account records, with caps and validation. |
| `party.js` (new) | In-memory parties and invites; no sockets, returns state objects and events. |
| `maps.js` | Adds `duel_a`, `duel_b` (flag `duel: true`), `DUEL_MAP_IDS`; `TEAM_MAP_IDS` excludes duel maps. |
| `sim.js` | Ring constants, `ringRadius(t)` helper, `VERSION`. |
| `game.js` | Room mode `1`, ring state/damage, `switchTeam(p)`, group placement `addGroup`. |
| `lobby.js` | Group tickets (`members`), `fits` for groups. |
| `auth.js` | Friend fields on the record, kept private from `publicProfile`. |
| `server.js` | `hello` socket auth, presence, `fr_*`, `pt_*`, `switch_team` routing and limits. |
| `main.js`, `index.html` | 1v1 button, ring render/HUD, switch button, Friends subpage, party bar. |
| `test/duel.mjs`, `test/social.mjs`, `test/party.mjs` (new) | Per-feature tests; added to `npm test`. |

---

### Task 1: Duel maps

**Files:**
- Modify: `maps.js` (add maps, exports), `sim.js:79` (re-export `DUEL_MAP_IDS`)
- Test: `test/maps.mjs`

**Interfaces:**
- Produces: `MAPS.duel_a`, `MAPS.duel_b` with `duel: true`, `ffa: false`, size ≤ 20 and one spawn per team; `export const DUEL_MAP_IDS: string[]`; `TEAM_MAP_IDS` no longer contains duel ids; `DUEL_MAP_IDS` re-exported from `sim.js`.

- [ ] **Step 1: Extend `test/maps.mjs`** with assertions: `DUEL_MAP_IDS` equals `['duel_a','duel_b']`; `TEAM_MAP_IDS` includes neither; each duel map has walls point-mirrored (reuse the existing mirror check), is 100% reachable (reuse the existing reachability check), and `spawnPoint(0,0)` and `spawnPoint(1,0)` are the same distance from `(0,0)` (within 0.01).
- [ ] **Step 2: Run** `node test/maps.mjs`. Expected: FAIL (`DUEL_MAP_IDS` undefined).
- [ ] **Step 3: Implement** the two maps in `maps.js` using `build()`: `duel_a` "Pit Stop" size 16 with a low central cover block and four pillars; `duel_b` "Crossroads" size 18 with two long walls forming an X-shaped lane. Both: team-0 spawn at the north edge (derived mirror for team 1), the same fields other maps have (`id`, `name`, `tagline`, `size`, `ffa:false`, `spawns`, `walls`, `hazards: []`, theme fields copied from `agora`). Add `duel: true`; define `DUEL_MAP_IDS = MAP_IDS.filter((id) => MAPS[id].duel)` and make `TEAM_MAP_IDS` filter out `ffa` and `duel`.
- [ ] **Step 4: Re-export** `DUEL_MAP_IDS` from `sim.js` next to the other map exports.
- [ ] **Step 5: Run** `node test/maps.mjs`. Expected: `maps: ok`.
- [ ] **Step 6: Commit** `feat: duel maps`.

### Task 2: Duel mode in Room, join and lobby

**Files:**
- Modify: `game.js` (`Room` constructor: `this.duel = mode === 1`, `size`), `server.js` `handleJoin` (accept `m.mode === 1`, choose from `DUEL_MAP_IDS`), `lobby.js` (no change expected; verify)
- Test: `test/duel.mjs` (new), `package.json` test script

**Interfaces:**
- Consumes: `DUEL_MAP_IDS` (Task 1).
- Produces: `new Room(1, 'duel_a')` yields 2 players (one per team), `room.duel === true`, `room.size === 1`; join message `{t:'join', mode:1, map, queue:'quick'|'ranked'|'custom'}` places the player; snapshot `mode: 1`.

- [ ] **Step 1: Write `test/duel.mjs`** (headless, using `Room` directly): a room `new Room(1,'duel_a')` has exactly 2 players on teams 0 and 1; `addHuman` takes one bot slot per team and a third `addHuman` returns null; a bot-vs-bot duel stepped for 3000 ticks reaches `phase === 'matchEnd'` with a score of 3 for the winner and never throws; over the websocket (spawn server like `test/safety.mjs`) `join {mode:1}` yields `welcome` with `mode:1` and a map in `DUEL_MAP_IDS`, and `join {mode:2, map:'duel_a'}` falls back to a normal team map.
- [ ] **Step 2: Run** `node test/duel.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** in `game.js`: `this.duel = mode === 1;` and make sure `this.size` uses `mode` for duels (already does). In `handleJoin`: `const mode = ffa ? 'ffa' : m.mode === 3 ? 3 : m.mode === 1 ? 1 : 2;` and `const allowed = ffa ? FFA_MAP_IDS : mode === 1 ? DUEL_MAP_IDS : TEAM_MAP_IDS;`. Import `DUEL_MAP_IDS` from `./sim.js`.
- [ ] **Step 4: Add** `node test/duel.mjs` to the `npm test` chain in `package.json`.
- [ ] **Step 5: Run** `node test/duel.mjs && npm test`. Expected: all pass.
- [ ] **Step 6: Commit** `feat: 1v1 duel mode`.

### Task 3: Ring of death (server)

**Files:**
- Modify: `sim.js` (constants, helper), `game.js` (`resetRound`, `step`, `snapshot`, kill cause)
- Test: `test/duel.mjs`

**Interfaces:**
- Consumes: duel rooms (Task 2).
- Produces: `export function ringRadius(roundElapsed, startRadius): number` in `sim.js` (returns `startRadius` until `RING_START`, then linear to `RING_MIN_RADIUS` over `RING_SHRINK_TIME`, never below the minimum); `Room.ring = { t, r, on }` updated every step in duel rooms only; snapshot field `rg: [r2(r), 1]` when active else absent; ring damage routed through `damage(victim, amount, null, false, 'ring')`; kill-feed event has `cause: 'ring'`, awards no kill and no ammo.

- [ ] **Step 1: Write failing tests** in `test/duel.mjs`: `ringRadius(0, 16) === 16`, `ringRadius(45, 16) === 16`, `ringRadius(70, 16) === 3`, `ringRadius(200, 16) === 3`, strictly decreasing between 45 and 70; in a live duel room with both players `isBot` frozen outside radius (place them at the arena corner, set `roundT` so elapsed is 60 s), after 60 ticks their hp dropped and the drop per second grows over two consecutive seconds; in a 2v2 room with the same elapsed time hp is untouched and the snapshot has no `rg`; `resetRound()` clears `ring`; a ring death emits no `kills` credit (killer's `kills` unchanged).
- [ ] **Step 2: Run** `node test/duel.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** constants and `ringRadius` in `sim.js`. In `game.js` `step()` (live phase, duel only): compute elapsed as `roundTime - roundT`, update `this.ring`, and for each alive player with `hypot(x, z) > ring.r` accumulate `p.ringT += dt` and apply `(RING_DPS + RING_DPS_RAMP * p.ringT) * dt` damage; reset `p.ringT = 0` when inside or on `resetRound`. Start radius is `MAPS[mapId].size - 1`. Add `rg` to `snapshot()` and make sure `viewSnapshot` copies it through unchanged.
- [ ] **Step 4: Run** `node test/duel.mjs && node test/spectate.mjs && node test/visibility.mjs`. Expected: pass.
- [ ] **Step 5: Commit** `feat: sudden-death ring in duels`.

### Task 4: Duel and ring on the client

**Files:**
- Modify: `index.html` (mode row, ring warning element), `main.js` (mode button handler, ring mesh from snapshot `rg`, HUD warning, minimap if present, map picker filter), `world.js` if the ring mesh belongs with other arena visuals
- Test: `test/browser_test2.py`-style check in the scratchpad runner (not in the repo); manual checklist in the commit message

**Interfaces:**
- Consumes: snapshot `mode`, `rg`.
- Produces: `#m1` button "1 v 1" in `.modes`; map picker lists `duel` maps only for mode 1 and excludes them otherwise; ring mesh (translucent cylinder wall) positioned at origin with radius `rg[0]`; `#ringwarn` shown while the local player's distance to origin exceeds `rg[0]`.

- [ ] **Step 1: Add** `<button id="m1">1 v 1</button>` before `m2` and wire it exactly like `m2`/`m3` (selected state, stored mode, `join` message `mode: 1`); update the map list builder to use `DUEL_MAP_IDS` for mode 1.
- [ ] **Step 2: Render** the ring: create a mesh on first `rg`, scale to the radius every snapshot, hide when `rg` is absent; add `#ringwarn` and a red vignette class toggled when outside.
- [ ] **Step 3: Verify** with the Playwright runner against a stubbed three.js: clicking 1 v 1 sends `mode:1`, the map list shows only duel maps, a fabricated snapshot with `rg` toggles `#ringwarn` for a player outside the radius, no page errors.
- [ ] **Step 4: Commit** `feat: 1v1 button, ring visuals and warning`.

### Task 5: Automatic sides and in-game Switch team

**Files:**
- Modify: `index.html` (remove `#teamblock` team picker), `main.js` (always send `team: -1`, Switch button in pause menu and recap, rebindable key `switchTeam`), `game.js`, `server.js`
- Test: `test/lobby.mjs`, `test/duel.mjs` or a new section in `test/safety.mjs`

**Interfaces:**
- Produces: `Room.switchTeam(p): boolean` (false when ranked, phase not `countdown`/`matchEnd`, FFA, or no open slot on the other team; otherwise swaps `p` with a bot on the other team, preserving the bot as a bot on the old side); client message `{t:'switch_team'}`; server replies `{t:'team', team}` to the player on success and `{t:'error', msg}` on refusal; welcome/snapshot already carry `team`.

- [ ] **Step 1: Write failing tests**: `switchTeam` succeeds in an unranked countdown with a bot on the other team and the player's `team`/`slot` change and a bot now occupies the old slot; fails when ranked, when `phase === 'live'`, when the other team has no bot; two humans calling it for the single open slot: first true, second false; guests can use it (no account needed); over the socket a `switch_team` during `live` yields an `error`.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** `switchTeam` in `game.js` (swap `team` and `slot` between the human and a bot target, then `resetRound` position for just those two players), route `switch_team` in `server.js` with a 1 per second per-socket limit.
- [ ] **Step 4: Client**: delete the team picker block and its handlers (`#teampick`, `data-team` CSS can stay unused only if removing it breaks nothing; remove dead CSS), send `team: -1`, add Switch team buttons and the rebindable key, show current team on the HUD.
- [ ] **Step 5: Run** `npm test` and the browser tests for no page errors and no `#teampick`.
- [ ] **Step 6: Commit** `feat: automatic team assignment and in-game team switch`.

### Task 6: Friend operations on accounts (`social.js`)

**Files:**
- Create: `social.js`, `test/social.mjs`
- Modify: `auth.js` (record defaults, `publicProfile` must not expose friend fields), `package.json` (test chain)

**Interfaces:**
- Consumes: `auth.updateUser(username, mutatorFn)`, `auth.getUser(username)`, `USER_RE`.
- Produces: `createSocial(auth, mod)` returning `{ request(from, to), accept(me, other), decline(me, other), remove(me, other), block(me, other), unblock(me, other), setHidden(me, on), state(me) }`; each returns `{ ok: true, state }` or `{ ok: false, error }`. `state(me)` returns `{ friends: string[], reqIn: string[], reqOut: string[], blocked: string[], hidden: boolean }` (lowercase names). Record fields: `friends`, `reqIn`, `reqOut`, `blocked`, `hidden`.

- [ ] **Step 1: Write `test/social.mjs`** with an in-memory store: request then accept makes both sides friends and clears both pending lists; reciprocal requests auto-accept; refusals (each with `ok:false`): self, unknown user, banned user, already friends, blocked by target, request when caps are hit (20 pending, 50 friends), duplicate pending; names are case-insensitive (`Bob` equals `bob`) and stored lowercase without duplicates; `remove` deletes both sides; `block` removes friendship and pending in both directions and prevents later requests from the blocked user; `publicProfile(user)` contains none of `friends`, `reqIn`, `reqOut`, `blocked`, `hidden`.
- [ ] **Step 2: Run** `node test/social.mjs`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `social.js`; every mutation of two records runs inside the per-user serialisation already used by `updateUser`, updating the lexicographically smaller username first to avoid deadlock. Add defaults for the new fields wherever records are loaded or created, and ensure `sanitize`/`publicProfile` omit them.
- [ ] **Step 4: Run** `node test/social.mjs && node test/auth.mjs`. Expected: ok.
- [ ] **Step 5: Commit** `feat: friend operations on accounts`.

### Task 7: Friends over the socket, presence and limits

**Files:**
- Modify: `server.js` (message routing, `hello`, presence map, rate limits, pushes), `ws-lite.js` unchanged
- Test: `test/social.mjs` (socket section)

**Interfaces:**
- Consumes: `createSocial` (Task 6).
- Produces: client messages `{t:'hello', token}` (binds `ws.user` for a signed-in socket not yet in a room), `{t:'fr_list'}`, `{t:'fr_add', name}`, `{t:'fr_accept', name}`, `{t:'fr_decline', name}`, `{t:'fr_remove', name}`, `{t:'fr_block', name}`, `{t:'fr_hide', on}`; server replies `{t:'fr_state', friends:[{name, st:'off'|'menu'|'match'|'party', mode?, map?, rid?, open?}], reqIn, reqOut, blocked, hidden}` and pushes the same shape to affected online users on any change (request received, accepted, friend went on/offline, joined or left a match). `presence`: `Map<username, ws>`; status derived from `ws.room` and party membership; `hidden` users report `off`; only accepted friends receive status.

- [ ] **Step 1: Write socket tests**: two accounts A and B each `hello`; A `fr_add B`, B receives `fr_state` with A in `reqIn`; B `fr_accept A`, both see each other with `st:'menu'`; when A joins a match B receives `st:'match'` with `mode`/`map`; A `fr_hide` makes B see `off`; a guest `fr_add` gets `{t:'error'}` and no crash; the 11th `fr_add` within a minute gets a rate-limit error; a non-friend never receives A's status; closing A's socket pushes `off` to B.
- [ ] **Step 2: Run** and confirm FAIL.
- [ ] **Step 3: Implement** in `server.js`: `hello` verifies the token with `auth.userFromToken` and registers `presence`; unregister on close; after any social change call `pushState(username)` for the actor and the other party; per-account limiters via `makeLimiter(10, 60_000)` and `makeLimiter(30, 3_600_000)`; reject banned users and apply `nameAllowed`/`USER_RE` to target names; `handleJoin` also registers presence for users joining a match and calls `pushStatusToFriends`.
- [ ] **Step 4: Run** `npm test`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: friends list over the socket with live status`.

### Task 8: Friends UI

**Files:**
- Modify: `index.html` (Friends tile and subpage markup/CSS), `main.js` (socket `hello`, `fr_*` handlers, rendering)
- Test: Playwright runner (scratchpad) against the stubbed three.js

**Interfaces:**
- Consumes: `fr_state` (Task 7).
- Produces: `#friendsbtn` tile, `#friends` subpage with list, `#fradd` input + button, pending-in with Accept/Decline, pending-out, blocked list with Unblock, `#frhide` toggle; each online friend row has Invite (Task 11 wires it) and Join; all names pass through `esc()`.

- [ ] **Step 1: Implement** the tile and subpage using the existing menu subpage pattern (same open/close helpers as Maps/Skills); send `hello` on socket open whenever a token exists and again after login.
- [ ] **Step 2: Render** states from `fr_state`; Join sends `join` with the friend's `mode`/`map` and is disabled when `open` is false.
- [ ] **Step 3: Verify** with Playwright: a fabricated `fr_state` renders names escaped (a name containing `<b>` appears as text), buttons send the right `fr_*` messages, guests see "Sign in to use friends".
- [ ] **Step 4: Commit** `feat: friends subpage`.

### Task 9: Parties (`party.js`) and socket messages

**Files:**
- Create: `party.js`, `test/party.mjs`
- Modify: `server.js` (routing, expiry timer), `package.json` (test chain)

**Interfaces:**
- Produces: `createParties()` returning `{ invite(leaderName, targetName), accept(name, leaderName), decline(name, leaderName), leave(name), kick(leader, name), setPrivate(leader, on), partyOf(name), maxSize(mode, ranked): number, tick(nowMs) }`; each mutator returns `{ ok, error?, party? }` where `party = { id, leader, members: string[], private: boolean }`; client messages `{t:'pt_invite', name}`, `{t:'pt_accept', name}` (name = inviter), `{t:'pt_decline', name}`, `{t:'pt_leave'}`, `{t:'pt_kick', name}`, `{t:'pt_private', on}`; server pushes `{t:'pt_state', party | null}` to every member and `{t:'pt_invited', from}` to the target.

- [ ] **Step 1: Write `test/party.mjs`** (pure): invite requires friendship (injected `areFriends(a,b)`); one party per user; invite expires after 60 s via `tick`; accepting a full party fails; leader leaving promotes the longest-standing member; last member leaving deletes the party; `kick` is leader-only; `maxSize` returns 4 for `'ffa'`, 3 for 2 and 3, 2 for 1, and ranked 2 for mode 2, 3 for mode 3, 2 for mode 1.
- [ ] **Step 2: Run** and confirm FAIL.
- [ ] **Step 3: Implement** `party.js` (Maps keyed by username and party id; no socket references) and route the messages in `server.js` with the same account and rate-limit requirements; on socket close call `leave`; push `pt_state` after each change.
- [ ] **Step 4: Add** socket tests to `test/party.mjs`: invite, accept, both receive `pt_state`; non-friend invite refused; guest refused.
- [ ] **Step 5: Run** `npm test`. Expected: pass.
- [ ] **Step 6: Commit** `feat: parties`.

### Task 10: Group placement and private party rooms

**Files:**
- Modify: `lobby.js` (group tickets), `game.js` (`addGroup`), `server.js` (leader Play places the whole party)
- Test: `test/lobby.mjs`, `test/party.mjs`

**Interfaces:**
- Consumes: `Lobby.enter`, `Room.openSlots`, party state (Task 9).
- Produces: `Room.addGroup(members: Array<{ws,name,loadout,model,opts}>): Player[] | null` — all-or-nothing: returns null (and changes nothing) unless all fit on one team (duel: two members on opposite teams; FFA: enough bot slots); tickets may carry `members` and `size`; `Lobby.fits` requires `size` open slots on a single team for groups; ranked group rating is the average of members; `private: true` party rooms use `new Room(mode, map, { private: true, ... })`, are never found by `findRoom`, and accept only party members.

- [ ] **Step 1: Write failing tests**: `addGroup` of 2 into 2v2 with 2 open slots on one team succeeds and both share a team; into a room where each team has only one open slot returns null and leaves all players unchanged; a 2-party in duel lands on opposite teams; FFA group of 4 takes 4 bot slots; lobby places a 3-party into a fresh room when no room fits and never splits it; party ranked average rating respects the band; a private party room is never returned by `findRoom` and refuses a non-member join.
- [ ] **Step 2: Run** and confirm FAIL.
- [ ] **Step 3: Implement** `addGroup` by first verifying capacity and only then calling `addHuman` per member; extend the `ticket.place(room)` contract so group tickets call `room.addGroup`; in `server.js`, when a party leader presses Play, build one group ticket from all members' sockets (members who disconnected before placement are dropped, and the remaining members are still placed together), send each member their own `welcome`, and clear non-leaders' "waiting" state; party `private` creates the private room instead of using the lobby.
- [ ] **Step 4: Run** `npm test`. Expected: pass.
- [ ] **Step 5: Commit** `feat: group placement and private party rooms`.

### Task 11: Party UI, docs, version and release checks

**Files:**
- Modify: `index.html`, `main.js` (party bar, Invite button wiring, leader-only Play, private toggle), `README.md`, `sim.js`, `main.js` `CLIENT_VERSION`, `package.json`
- Test: Playwright runner, `npm test`

**Interfaces:**
- Consumes: `pt_state`, `pt_invited`, `fr_state`.
- Produces: `#partybar` listing members with leader badge, Leave, Private toggle (leader), Kick (leader); non-leaders see "Waiting for leader" instead of active Play buttons; an invite toast with Accept/Decline.

- [ ] **Step 1: Implement** the party bar and toast; Invite on friend rows sends `pt_invite`; Play buttons send the normal `join` only for leaders or non-party users (the server places the whole party).
- [ ] **Step 2: Update `README.md`** player-facing sections: Friends, Parties (queue together / private), 1v1 Duel and ring, team switching; add the new env/limits only if any exist (none are new).
- [ ] **Step 3: Bump** version to `0.10.0` in the three places.
- [ ] **Step 4: Run** `npm test` and the three browser test scripts plus a Playwright check that `#teampick` no longer exists, the party bar renders from a fabricated `pt_state`, and no page errors occur.
- [ ] **Step 5: Run the security suite** `node test/safety.mjs` and confirm the new message types are covered by the guest-refusal assertions added in Tasks 7 and 9.
- [ ] **Step 6: Commit** `release: v0.10.0 friends, parties, duel and ring` and sync to `/home/claude/aimarena` as in earlier releases.
