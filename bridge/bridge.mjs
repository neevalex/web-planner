#!/usr/bin/env node
// WebPlanner bridge: relays MAVLink between browser WebSockets and UDP/TCP.
//
//   node bridge.mjs [--port 8765] [--host 127.0.0.1] [--default udpin:14550]
//
// The browser picks the link with the query string:
//   ws://host:8765/?udpin=14550            listen on UDP 14550, reply to last sender (SITL, Herelink, ELRS backpack...)
//   ws://host:8765/?udpout=10.0.0.5:14550  send to a fixed UDP address
//   ws://host:8765/?tcp=127.0.0.1:5760     TCP client (SITL serial0, ESP8266/ESP32 telemetry)
// With no query string, the --default link is used.
//
// Several browser tabs can share one link; every client receives all vehicle traffic.

import dgram from 'node:dgram';
import net from 'node:net';
import { WebSocketServer } from 'ws';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const WS_PORT = Number(args.port ?? process.env.BRIDGE_PORT ?? 8765);
const WS_HOST = args.host ?? process.env.BRIDGE_HOST ?? '127.0.0.1';
const DEFAULT_LINK = args.default ?? process.env.BRIDGE_DEFAULT ?? 'udpin:14550';

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function parseHostPort(s) {
  const i = s.lastIndexOf(':');
  const host = s.slice(0, i).replace(/^\[|\]$/g, '');
  const port = Number(s.slice(i + 1));
  if (!host || !(port > 0 && port < 65536)) throw new Error(`bad address "${s}"`);
  return { host, port };
}

function linkSpecFromUrl(url) {
  const q = new URL(url, 'ws://x').searchParams;
  if (q.has('udpin')) return `udpin:${Number(q.get('udpin'))}`;
  if (q.has('udpout')) return `udpout:${q.get('udpout')}`;
  if (q.has('tcp')) return `tcp:${q.get('tcp')}`;
  return DEFAULT_LINK;
}

/** One physical link, shared by all WebSocket clients that asked for the same spec. */
class Link {
  clients = new Set();
  constructor(spec) {
    this.spec = spec;
    const [kind, ...rest] = spec.split(':');
    const addr = rest.join(':');
    if (kind === 'udpin') this.openUdpIn(Number(addr));
    else if (kind === 'udpout') this.openUdpOut(parseHostPort(addr));
    else if (kind === 'tcp') this.openTcp(parseHostPort(addr));
    else throw new Error(`unknown link type "${kind}"`);
  }

  broadcast(buf) {
    for (const ws of this.clients) if (ws.readyState === 1) ws.send(buf, { binary: true });
  }

  openUdpIn(port) {
    if (!(port > 0 && port < 65536)) throw new Error('bad UDP port');
    this.sock = dgram.createSocket('udp4');
    this.peer = null;
    this.sock.on('message', (msg, rinfo) => {
      if (!this.peer || this.peer.address !== rinfo.address || this.peer.port !== rinfo.port) {
        log(`[${this.spec}] vehicle at ${rinfo.address}:${rinfo.port}`);
      }
      this.peer = rinfo;
      this.broadcast(msg);
    });
    this.sock.on('error', (e) => this.fail(e));
    this.sock.bind(port);
    this.write = (buf) => { if (this.peer) this.sock.send(buf, this.peer.port, this.peer.address); };
  }

  openUdpOut({ host, port }) {
    this.sock = dgram.createSocket(net.isIPv6(host) ? 'udp6' : 'udp4');
    this.sock.on('message', (msg) => this.broadcast(msg));
    this.sock.on('error', (e) => this.fail(e));
    this.write = (buf) => this.sock.send(buf, port, host);
  }

  openTcp({ host, port }) {
    const connect = () => {
      this.sock = net.connect({ host, port });
      this.sock.setNoDelay(true);
      this.sock.on('connect', () => log(`[${this.spec}] connected`));
      this.sock.on('data', (d) => this.broadcast(d));
      this.sock.on('error', (e) => log(`[${this.spec}] ${e.message}`));
      this.sock.on('close', () => {
        if (this.closed) return;
        log(`[${this.spec}] closed, retrying in 2s`);
        setTimeout(() => !this.closed && connect(), 2000);
      });
    };
    connect();
    this.write = (buf) => { if (this.sock.writable) this.sock.write(buf); };
  }

  fail(e) {
    log(`[${this.spec}] error: ${e.message}`);
    for (const ws of this.clients) ws.close(1011, e.message.slice(0, 120));
    this.close();
  }

  close() {
    this.closed = true;
    try { this.sock?.close?.(); this.sock?.destroy?.(); } catch { /* ignore */ }
    links.delete(this.spec);
  }
}

const links = new Map();

const wss = new WebSocketServer({ port: WS_PORT, host: WS_HOST });
wss.on('connection', (ws, req) => {
  let link;
  try {
    const spec = linkSpecFromUrl(req.url ?? '/');
    link = links.get(spec);
    if (!link) { link = new Link(spec); links.set(spec, link); log(`[${spec}] opened`); }
  } catch (e) {
    ws.close(1008, e.message);
    return;
  }
  link.clients.add(ws);
  log(`client ${req.socket.remoteAddress} -> ${link.spec} (${link.clients.size} client(s))`);
  ws.on('message', (data) => link.write(Buffer.from(data)));
  ws.on('close', () => {
    link.clients.delete(ws);
    if (link.clients.size === 0) { log(`[${link.spec}] no clients, closing`); link.close(); }
  });
});

wss.on('listening', () => {
  log(`WebPlanner bridge on ws://${WS_HOST}:${WS_PORT}  (default link: ${DEFAULT_LINK})`);
  if (WS_HOST !== '127.0.0.1' && WS_HOST !== 'localhost') {
    log('WARNING: bridge is reachable from the network. Anyone who can reach it can talk to your vehicle.');
  }
});
