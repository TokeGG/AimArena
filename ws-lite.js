// Minimal RFC 6455 WebSocket server (text frames only), so the project needs no npm packages.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 8192; // every legitimate game message is far smaller than this

class MiniSocket extends EventEmitter {
  constructor(socket) {
    super();
    this.s = socket;
    this.buf = Buffer.alloc(0);
    this.readyState = 1;
    this.frag = null;
    socket.on('data', (d) => {
      this.buf = Buffer.concat([this.buf, d]);
      try { this.parse(); } catch { this.terminate(); }
    });
    socket.on('close', () => this._closed());
    socket.on('error', () => this._closed());
  }

  _closed() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit('close');
  }

  terminate() {
    try { this.s.destroy(); } catch { /* ignore */ }
    this._closed();
  }

  parse() {
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = !!(b[0] & 0x80);
      const op = b[0] & 0x0f;
      const masked = !!(b[1] & 0x80);
      let len = b[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (b.length < 4) return;
        len = b.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (b.length < 10) return;
        len = Number(b.readBigUInt64BE(2));
        off = 10;
      }
      if (len > MAX_PAYLOAD || !masked) { this.terminate(); return; }
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4);
      const payload = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
      this.buf = b.subarray(off + 4 + len);
      this.handle(op, fin, payload);
    }
  }

  handle(op, fin, payload) {
    if (op === 0x8) { this.writeFrame(0x8, Buffer.alloc(0)); this.s.end(); return; }
    if (op === 0x9) { this.writeFrame(0xa, payload); return; }
    if (op === 0xa) return;
    if (op === 0x1 || op === 0x2 || op === 0x0) {
      if (op !== 0) this.frag = [];
      if (!this.frag) return;
      this.frag.push(payload);
      if (fin) {
        const full = Buffer.concat(this.frag);
        this.frag = null;
        this.emit('message', full.toString('utf8'));
      }
    }
  }

  writeFrame(op, payload) {
    if (this.readyState !== 1 && op !== 0x8) return;
    const len = payload.length;
    let h;
    if (len < 126) {
      h = Buffer.from([0x80 | op, len]);
    } else if (len < 65536) {
      h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 126; h.writeUInt16BE(len, 2);
    } else {
      h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(len), 2);
    }
    this.s.write(Buffer.concat([h, payload]));
  }

  send(str) { this.writeFrame(0x1, Buffer.from(str)); }
}

/** `verify(req)` may veto a connection (origin check, per-IP limits) before the handshake completes. */
export function attachWebSocket(httpServer, onConnection, verify) {
  httpServer.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (String(req.headers.upgrade).toLowerCase() !== 'websocket' || !key) { socket.destroy(); return; }
    if (verify && !verify(req)) { socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.setNoDelay(true);
    onConnection(new MiniSocket(socket), req);
  });
}
