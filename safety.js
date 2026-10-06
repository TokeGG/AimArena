// Player-safety helpers: name filtering, reserved names, IP handling and the moderation log / ban list.
import crypto from 'node:crypto';

// Strong profanity / hate-speech stems. Short ones (<5 letters) must be a whole word, longer ones match anywhere
// (so "class" is fine but "f_u_c_k" is not). Add your own with the BLOCKED_WORDS env var (comma separated).
const STEMS = ['fuck', 'shit', 'bitch', 'cunt', 'nigg', 'fagg', 'retard', 'nazi', 'hitler', 'whore', 'pussy', 'asshole', 'bastard', 'dickhead', 'porn', 'molest', 'pedo', 'rapist', 'kys'];
const WHOLE = ['dick', 'cock', 'cum', 'anal', 'slut', 'rape', 'kkk', 'tits', 'sex', 'fag', 'coon', 'spic', 'nig', 'ass'];
export const RESERVED = new Set(['admin', 'administrator', 'moderator', 'mod', 'server', 'system', 'staff', 'support', 'owner', 'dev', 'developer', 'anthropic', 'claude', 'aimarena', 'guest',
  'apollo', 'athena', 'ares', 'hermes', 'zeus', 'hera', 'artemis', 'hades', 'nike', 'eros', 'atlas', 'helios']);
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'i', '+': 't' };

const extra = String(process.env.BLOCKED_WORDS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);

const squash = (s) => s.toLowerCase().replace(/[01345878@$!|+]/g, (c) => LEET[c] || c).replace(/[^a-z]/g, '');

/** True when a name contains blocked language (leetspeak, separators and repeats are normalised away). */
const ALLOW = ['scunthorpe', 'shiitake', 'cocktail', 'hancock', 'class', 'bassist', 'analyst', 'pedometer', 'pedophile_awareness'];
export function isBlockedName(raw) {
  const s = String(raw || '');
  let flat = squash(s);
  for (const a of ALLOW) flat = flat.split(a).join('');
  const flatRep = flat.replace(/(.)\1+/g, '$1'); // "fuuuck" -> "fuck"
  for (const w of [...STEMS, ...extra]) {
    const wr = w.replace(/(.)\1+/g, '$1');
    if (flat.includes(w) || flatRep.includes(wr)) return true;
  }
  const tokens = s.toLowerCase().replace(/[01345878@$!|+]/g, (c) => LEET[c] || c).split(/[^a-z]+/).filter(Boolean);
  for (const t of tokens) if (WHOLE.includes(t) || WHOLE.includes(t.replace(/(.)\1+/g, '$1'))) return true;
  return false;
}
export const isReservedName = (raw) => RESERVED.has(squash(String(raw || '')));
export const nameAllowed = (raw) => !isBlockedName(raw) && !isReservedName(raw);

/** Display name for a guest: cleaned, or a neutral fallback when it is not allowed. */
export function guestName(raw) {
  const n = String(raw || '').replace(/[^\w \-]/g, '').trim().slice(0, 14);
  if (!n || !nameAllowed(n)) return `Player${100 + Math.floor(Math.random() * 900)}`;
  return n;
}

const SALT = process.env.IP_SALT || process.env.ADMIN_KEY || 'aim-arena';
/** Short irreversible id for an IP address (raw addresses are never stored or logged). */
export const ipHash = (ip) => crypto.createHash('sha256').update(`${SALT}|${ip}`).digest('hex').slice(0, 12);

/** Client address from a request. TRUST_PROXY_HOPS = how many proxies are in front (Render: 1). */
export function clientIp(req) {
  const hops = Math.max(0, Number(process.env.TRUST_PROXY_HOPS) || 0);
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (xff.length && hops > 0) return xff[Math.max(0, xff.length - hops)];
  if (xff.length) return xff[0];
  return String((req.socket && req.socket.remoteAddress) || '');
}

/** Moderation log + ban list, kept in memory and saved to the store (so Upstash keeps it across restarts). */
export function createModeration(store) {
  let log = [];
  let bans = [];
  let timer = null;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      store.set('mod:log', JSON.stringify(log.slice(-300))).catch(() => {});
      store.set('mod:bans', JSON.stringify(bans)).catch(() => {});
    }, 3000);
    if (timer.unref) timer.unref();
  };
  const ready = (async () => {
    try { const l = await store.get('mod:log'); if (l) log = JSON.parse(l); } catch { /* ignore */ }
    try { const b = await store.get('mod:bans'); if (b) bans = JSON.parse(b); } catch { /* ignore */ }
  })();
  const live = () => { const now = Date.now(); bans = bans.filter((b) => !b.until || b.until > now); return bans; };
  return {
    ready,
    add(entry) { log.push({ t: Date.now(), ...entry }); if (log.length > 400) log.splice(0, log.length - 300); save(); },
    list: (n = 150) => log.slice(-n).reverse(),
    bans: () => live().map((b) => ({ ...b })),
    isBanned(type, id) { const k = String(id || '').toLowerCase(); return live().find((b) => b.type === type && b.id === k) || null; },
    ban(type, id, hours, reason) {
      const k = String(id || '').toLowerCase();
      if (!k || (type !== 'user' && type !== 'ip')) return false;
      bans = live().filter((b) => !(b.type === type && b.id === k));
      bans.push({ type, id: k, reason: String(reason || '').slice(0, 120), t: Date.now(), until: hours > 0 ? Date.now() + hours * 3600e3 : 0 });
      save();
      return true;
    },
    unban(type, id) { const k = String(id || '').toLowerCase(); const n = bans.length; bans = bans.filter((b) => !(b.type === type && b.id === k)); save(); return bans.length !== n; },
  };
}
