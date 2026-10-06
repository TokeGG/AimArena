// Matchmaking: which room a joining player lands in.
//  - Quick Play: straight into the fullest open room for the chosen mode + map (or a new one).
//  - Ranked: queue with a rating band that widens while waiting; if no human match shows up within
//    RANKED_WAIT seconds a fresh room is made (bots fill the empty slots).
export const RANKED_WAIT = 8;      // seconds before a ranked search gives up on finding humans
export const BAND_START = 250;     // allowed rating gap at the start of a search
export const BAND_GROW = 60;       // ... plus this much per second waited

export class Lobby {
  /** createRoom(mode, mapId, ranked, bots) -> Room.  now() -> ms (injectable for tests). */
  constructor(createRoom, now = () => Date.now()) {
    this.createRoom = createRoom;
    this.now = now;
    this.rooms = [];
    this.tickets = [];
  }

  waited(t) { return (this.now() - t.since) / 1000; }
  band(t) { return Math.min(1200, BAND_START + BAND_GROW * this.waited(t)); }

  fits(room, t) {
    if (room.mode !== t.mode || room.mapId !== t.map || room.ranked !== t.ranked) return false;
    if (room.emptyT > 10 || room.private) return false;
    const open = room.openSlots();
    if (t.team === 0 || t.team === 1) { if (open[t.team] < 1) return false; } else if (open[0] + open[1] < 1) return false;
    if (t.ranked) {
      if (room.round > 2) return false; // do not drop people into the late stage of a ranked match
      const hs = room.humans();
      if (hs.length) {
        const avg = hs.reduce((a, p) => a + (p.rating || 1000), 0) / hs.length;
        if (Math.abs(avg - t.rating) > this.band(t)) return false;
      }
    }
    return true;
  }

  /** Best existing room for this request, or null. */
  findRoom(t) {
    let best = null, bs = -1;
    for (const r of this.rooms) {
      if (!this.fits(r, t)) continue;
      const humans = r.humans().length;
      if (t.ranked && humans === 0) continue; // an all-bot ranked room is no better than a fresh one
      // fill rooms that already have players first (their open bot slots go to the newcomer); same bot level breaks ties
      const score = humans * 10 + (r.phase === 'matchEnd' ? 0 : 1) + ((r.botLevel || 'normal') === (t.bots || 'normal') ? 0.5 : 0);
      if (score > bs) { bs = score; best = r; }
    }
    return best;
  }

  make(t) {
    const room = this.createRoom(t.mode, t.map, t.ranked, t.bots);
    this.rooms.push(room);
    return room;
  }

  /** Place the ticket in a room via t.place(room) -> boolean. Returns true when placed. */
  _place(t, room) { return t.place(room) === true; }

  /** Quick play places immediately; ranked joins the queue. Returns true if placed right away. */
  enter(t) {
    t.since = this.now();
    if (!t.ranked) {
      const room = this.findRoom(t) || this.make(t);
      if (this._place(t, room)) return true;
      const fresh = this.make(t); // the slot vanished between the check and the join
      return this._place(t, fresh);
    }
    this.tickets.push(t);
    this.tick();
    return !this.tickets.includes(t);
  }

  cancel(t) {
    const i = this.tickets.indexOf(t);
    if (i >= 0) this.tickets.splice(i, 1);
  }

  /** Called a couple of times per second. */
  tick() {
    for (const t of [...this.tickets]) {
      if (!this.tickets.includes(t)) continue; // placed as someone's partner earlier in this loop
      const room = this.findRoom(t);
      if (room && this._place(t, room)) { this.cancel(t); continue; }
      // pair with another searching player in the same bucket and compatible rating band
      const mate = this.tickets.find((o) => o !== t && o.mode === t.mode && o.map === t.map &&
        Math.abs(o.rating - t.rating) <= Math.min(this.band(t), this.band(o)));
      if (mate) {
        const fresh = this.make(t);
        if (this._place(t, fresh)) {
          this.cancel(t);
          if (this._place(mate, fresh)) this.cancel(mate);
        }
        continue;
      }
      if (this.waited(t) >= RANKED_WAIT) {
        const fresh = this.make(t);
        if (this._place(t, fresh)) this.cancel(t);
      }
    }
  }

  /** Drop rooms nobody has been in for a while. */
  sweep() {
    for (let i = this.rooms.length - 1; i >= 0; i--) if (this.rooms[i].emptyT > 15) this.rooms.splice(i, 1);
  }

  /** For queue progress messages. */
  queueInfo(t) {
    return { waited: Math.floor(this.waited(t)), searching: this.tickets.filter((o) => o.mode === t.mode && o.map === t.map).length };
  }
}
