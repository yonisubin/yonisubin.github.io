// Hexborne's online relay: a tiny WebSocket server on Node built-ins only (no dependencies).
//   node civilization/server/server.mjs [port]      (default 8787, or $PORT)
// It knows nothing about the game. Players join rooms by a short code; the room's creator is the
// host, whose browser runs the authoritative game. The server only passes JSON messages between
// the host and the guests (see civilization/src/net/). It also serves civilization/dist at
// /civilization/ when that folder exists, so LAN players can open http://<this-machine>:8787/civilization/.
import { createServer } from 'node:http';
import { createHash, randomInt } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.argv[2] || process.env.PORT || 8787);
const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const MAX_MESSAGE = 64 * 1024 * 1024; // a full game state can be a few MB
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.wasm': 'application/wasm' };

// ---- Static files (optional) ----
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') return void res.end('ok');
  if (!url.pathname.startsWith('/civilization/') || !existsSync(DIST)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return void res.end('Hexborne relay server. Open /civilization/ (needs `npm run build:civ`) or connect a game to ws://this-host:' + PORT);
  }
  let file = normalize(join(DIST, decodeURIComponent(url.pathname.slice('/civilization/'.length))));
  if (!file.startsWith(DIST)) return void res.writeHead(403).end();
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});

// ---- WebSocket (RFC 6455) ----
let nextId = 1;
/** room code → { host: Client, clients: Map<id, Client> } */
const rooms = new Map();

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade ?? '').toLowerCase() !== 'websocket') return socket.destroy();
  const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);
  const client = { id: nextId++, socket, room: null, name: '', buf: Buffer.alloc(0), parts: [], alive: true };
  socket.on('data', (d) => {
    client.buf = Buffer.concat([client.buf, d]);
    try {
      readFrames(client);
    } catch (e) {
      console.warn(`client ${client.id}: ${e.message}`);
      socket.destroy();
    }
  });
  socket.on('close', () => leave(client));
  socket.on('error', () => leave(client));
});

/** Parse every complete frame in the client's buffer. Client frames are always masked. */
function readFrames(c) {
  for (;;) {
    const b = c.buf;
    if (b.length < 2) return;
    const fin = (b[0] & 0x80) !== 0;
    const op = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let at = 2;
    if (len === 126) {
      if (b.length < 4) return;
      len = b.readUInt16BE(2);
      at = 4;
    } else if (len === 127) {
      if (b.length < 10) return;
      len = Number(b.readBigUInt64BE(2));
      at = 10;
    }
    if (len > MAX_MESSAGE) throw new Error('message too large');
    const maskAt = at;
    if (masked) at += 4;
    if (b.length < at + len) return;
    const payload = Buffer.from(b.subarray(at, at + len));
    if (masked) for (let i = 0; i < len; i++) payload[i] ^= b[maskAt + (i & 3)];
    c.buf = b.subarray(at + len);
    if (op === 0x8) return void c.socket.end(frame(Buffer.alloc(0), 0x8));
    if (op === 0x9) {
      c.socket.write(frame(payload, 0xa));
      continue;
    }
    if (op === 0xa) continue;
    // Text (1) or continuation (0) frames: collect until FIN.
    c.parts.push(payload);
    if (!fin) continue;
    const text = Buffer.concat(c.parts).toString('utf8');
    c.parts = [];
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      continue;
    }
    onMessage(c, msg);
  }
}

function frame(payload, op = 0x1) {
  const n = payload.length;
  const head = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
  if (n >= 126 && n < 65536) {
    head[0] = 0x80 | op;
    head[1] = 126;
    head.writeUInt16BE(n, 2);
  } else if (n >= 65536) {
    head[0] = 0x80 | op;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(n), 2);
  }
  return Buffer.concat([head, payload]);
}

function send(c, msg) {
  if (!c.socket.destroyed) c.socket.write(frame(Buffer.from(JSON.stringify(msg), 'utf8')));
}

// ---- Rooms ----
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function newCode() {
  for (;;) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_LETTERS[randomInt(CODE_LETTERS.length)];
    if (!rooms.has(code)) return code;
  }
}

function onMessage(c, m) {
  switch (m.t) {
    case 'create': {
      if (c.room) return;
      const code = newCode();
      c.name = String(m.name ?? 'Host').slice(0, 24);
      c.room = code;
      rooms.set(code, { host: c, clients: new Map([[c.id, c]]) });
      send(c, { t: 'joined', room: code, you: c.id, host: c.id });
      console.log(`room ${code} created by ${c.name}`);
      return;
    }
    case 'join': {
      if (c.room) return;
      const code = String(m.room ?? '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) return send(c, { t: 'error', error: `no room called ${code}` });
      c.name = String(m.name ?? 'Guest').slice(0, 24);
      c.room = code;
      room.clients.set(c.id, c);
      send(c, { t: 'joined', room: code, you: c.id, host: room.host.id });
      send(room.host, { t: 'peer', id: c.id, name: c.name, joined: true });
      return;
    }
    case 'to': {
      // Relay: to the host, to one client, or to everyone else in the room.
      const room = rooms.get(c.room);
      if (!room) return;
      const out = { t: 'msg', from: c.id, msg: m.msg };
      if (m.to === 'host') send(room.host, out);
      else if (m.to === 'all') for (const o of room.clients.values()) o !== c && send(o, out);
      else {
        const o = room.clients.get(Number(m.to));
        if (o) send(o, out);
      }
      return;
    }
  }
}

function leave(c) {
  if (!c.alive) return;
  c.alive = false;
  const room = rooms.get(c.room);
  if (!room) return;
  room.clients.delete(c.id);
  if (room.host === c) {
    for (const o of room.clients.values()) send(o, { t: 'closed' });
    rooms.delete(c.room);
    console.log(`room ${c.room} closed`);
  } else send(room.host, { t: 'peer', id: c.id, name: c.name, joined: false });
}

server.listen(PORT, () => console.log(`Hexborne relay listening on :${PORT}`));
