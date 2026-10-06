# Friends, parties, 1v1 duel with ring of death, in-game team switching

Target version: 0.10.0 (stays below 1.0). Date: 2026-10-06.

## Goal
Make Aim Arena easier to play with friends and add a fast competitive mode:
1. A friends list with request/accept and live status.
2. Parties that queue together or play in a private room.
3. A 1v1 duel mode with dedicated arenas and a sudden-death ring.
4. Remove the Auto/Blue/Red picker from the main menu; sides are assigned automatically and can be switched in-game.

## Decisions already made with the owner
- Parties: BOTH queue-together (default) and a private-room toggle.
- Friends: request and accept (not instant add).
- Ring: sudden death only; every value is a named constant for later tuning.
- 1v1: first to 3 round wins; dedicated duel arenas; ranked allowed, shares the existing rating.
- Team switching: only in unranked matches, during pre-round freeze and the between-match screen.

## Non-goals
Voice/text chat, friend-of-friend discovery, party-only ranked ladders, per-mode rating, spectating friends' private rooms, cross-server presence.

## 1. Friends
**Data (auth.js user record):** `friends: string[]`, `reqIn: string[]`, `reqOut: string[]`, `blocked: string[]`, `hidden: boolean` (appear offline). All lowercase usernames. Caps: 50 friends, 20 pending each way, 50 blocked.
**Operations (new `social.js`, pure functions over the record store, serialised per user like signup):** `addRequest(a,b)`, `accept(a,b)` (writes both sides, clears both pending lists), `decline`, `remove` (both sides), `block` (also removes friendship and pending), `unblock`. Requests are refused for self, unknown or banned accounts, anyone who blocked the sender, existing friends, and when caps are hit. A reciprocal request auto-accepts.
**WebSocket messages (signed-in sockets only, bearer-verified at join):** `fr_list`, `fr_add {name}`, `fr_accept {name}`, `fr_decline {name}`, `fr_remove {name}`, `fr_block {name}`, `fr_hide {on}`. Server replies `fr_state {friends:[{name,status,room?}], reqIn, reqOut}` and pushes `fr_state` diffs to affected online users.
**Status** is derived from a server-side `presence` map (username to socket): `offline`, `menu`, `match` (mode and map), `party`. Hidden users report `offline`; only accepted friends see status.
**Limits:** 10 requests/min and 30/hour per account, names pass the existing name filter, message size stays under the 8 KB cap.
**UI:** Friends tile on the main menu opens a subpage (list, add box, pending in/out, block list, Appear offline). Online friend rows have Invite and Join (Join only when the room has an open slot and is not private).

## 2. Parties
**State (in memory, new `party.js`):** `{id, leader, members[], private, createdAt}`; one party per user; max size 4 (FFA), 3 (2v2, 3v3), 2 (duel); ranked caps 2 (2v2) and 3 (3v3), duel ranked 2.
**Messages:** `pt_invite {name}` (friends only, expires in 60 s), `pt_accept`, `pt_decline`, `pt_leave`, `pt_kick {name}` (leader), `pt_private {on}` (leader), `pt_state` pushed to members.
**Leader rules:** leader's mode, map, bot level and Play buttons drive the party; others see "Waiting for leader". If the leader leaves, the longest-standing member leads; empty parties are deleted. Disconnects remove the member.
**Placement:** Lobby gains group tickets: `{members[], size, ...}`. A room fits a group only if all members can sit on one team (team modes) or enough open slots exist (FFA); bot slots count as open and are taken over. Placement is all-or-nothing; if no room fits, a fresh room is created for the group. Ranked groups use the average rating for the band. In duel, a 2-person party is placed on opposite sides of one room (friend duel).
**Private party room:** uses the existing `private` room option (like custom matches): not listed, no stats/rank/challenges, only party members may join.
**Between matches:** the party stays together; the room's existing PLAY AGAIN flow applies.

## 3. Duel mode
**Mode id:** `duel` (2 players, one per team). Rounds: first to 3 wins (`winRounds = 3`), reusing round, scoreboard, recap and skill-pick logic. Bots fill an empty side at the chosen bot level.
**Maps:** two new mirrored small maps, `duel_a`, `duel_b`, flagged `duel: true`, with a centre point. `test/maps.mjs` extended: mirrored walls, 100% reachable, spawns equidistant from centre.
**Ranked:** allowed; ticket matching as for other team modes; uses the existing rating and Elo.
**Menu:** 1v1 button added to the mode row; map list filters to duel maps.

## 4. Ring of death (duel only)
Constants at the top of `sim.js`: `RING_START = 45` (seconds into a round), `RING_SHRINK_TIME = 25`, `RING_START_RADIUS` (map-derived), `RING_MIN_RADIUS = 3`, `RING_DPS = 8`, `RING_DPS_RAMP = 2` (extra dps per second outside).
Server (`game.js`): after `RING_START` the safe radius shrinks linearly to the minimum around the map centre; players outside take damage each tick, ramping while they remain outside; the ring resets each round. Kills credit no one (environmental) and use a "ring" kill-feed cause.
Snapshot: `rg = [centreX, centreZ, radius, active]` added to snapshots during duel rounds. Client draws a translucent wall/ground ring, shows it on the minimap if present, and a HUD "OUTSIDE THE RING" warning with a red vignette.
Tests: ring starts on time, radius monotonic, damage ramps, resets on new round, absent in other modes.

## 5. Team picking
Remove the Auto/Blue/Red block from the main menu; the client sends `team: -1` always. Server assigns the side with open slots (keeps parties together, balances otherwise).
**Switch:** new message `switch_team`, allowed only when the room is unranked, the phase is the pre-round freeze or between-match screen, and the other team has an open slot (a bot there is replaced). Button in pause menu and recap; rebindable key. HUD shows your team.

## Server and file changes
- `auth.js`: extend user record and sanitisation (friend fields never exposed to other users).
- `social.js` (new): friend operations. `party.js` (new): parties. `lobby.js`: group tickets. `sim.js`: ring constants, duel mode constants, `VERSION`. `game.js`: duel mode, ring, `switch_team`. `maps.js`: duel maps. `server.js`: message routing, presence, rate limits, STATIC_FILES unchanged. `main.js`, `index.html`: Friends subpage, party bar, 1v1 button, ring rendering and HUD, team switch UI, team picker removal.
- README: player-facing sections for friends, parties, duel, ring.

## Security
All new messages require a verified account, are rate limited, size-capped and validated server-side (names via USER_RE, party/room ownership checks). Friend data is private to the account; status is only sent to accepted friends. No new endpoints are unauthenticated. Blocks stop requests and invites.

## Testing
New tests: `test/social.mjs` (request/accept/decline/remove/block, caps, rate limits, privacy of status), `test/party.mjs` (invite flow, leader handover, group placement all-or-nothing, private rooms), `test/duel.mjs` (round flow, ring timing and damage, bots, duel maps), extended `test/lobby.mjs`, `test/safety.mjs`, `test/maps.mjs`. Browser tests: friends subpage, party bar, absence of team picker, switch button. `npm test` must pass; browser tests pass except the known flaky ones.

## Risks
- Group placement in the lobby is the most delicate change; covered by dedicated tests.
- Parties and presence are lost on server restart (acceptable; friend lists are persisted).
- Ring tuning will need playtesting; constants are isolated for that.
