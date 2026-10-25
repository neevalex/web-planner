// MAVLink over WebSocket. Used with the WebPlanner bridge (bridge/bridge.mjs),
// which relays to UDP or TCP. The target is passed in the query string.
import { Transport } from './transport';

export type NetTarget =
  | { kind: 'udp-listen'; port: number }
  | { kind: 'udp'; host: string; port: number }
  | { kind: 'tcp'; host: string; port: number }
  | { kind: 'default' };

export function targetQuery(t: NetTarget): string {
  switch (t.kind) {
    case 'udp-listen': return `?udpin=${t.port}`;
    case 'udp': return `?udpout=${encodeURIComponent(`${t.host}:${t.port}`)}`;
    case 'tcp': return `?tcp=${encodeURIComponent(`${t.host}:${t.port}`)}`;
    default: return '';
  }
}

export function targetLabel(t: NetTarget): string {
  switch (t.kind) {
    case 'udp-listen': return `UDP :${t.port}`;
    case 'udp': return `UDP ${t.host}:${t.port}`;
    case 'tcp': return `TCP ${t.host}:${t.port}`;
    default: return 'Bridge';
  }
}

export class WebSocketTransport extends Transport {
  private ws: WebSocket | null = null;
  private closing = false;
  readonly label: string;
  private url: string;

  constructor(bridgeUrl: string, target: NetTarget) {
    super();
    this.url = bridgeUrl.replace(/\/?$/, '/') + targetQuery(target);
    this.label = targetLabel(target);
  }

  open(): Promise<void> {
    this.closing = false;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      ws.binaryType = 'arraybuffer';
      let opened = false;
      const timer = setTimeout(() => { if (!opened) { ws.close(); reject(new Error(`Bridge not reachable at ${this.url}`)); } }, 5000);
      ws.onopen = () => { opened = true; clearTimeout(timer); this.ws = ws; resolve(); };
      ws.onmessage = (ev) => {
        if (ev.data instanceof ArrayBuffer) this.emitData(new Uint8Array(ev.data));
      };
      ws.onerror = () => { if (!opened) { clearTimeout(timer); reject(new Error(`Bridge not reachable at ${this.url}`)); } };
      ws.onclose = (ev) => {
        this.ws = null;
        if (opened && !this.closing) this.emitClose(ev.reason || 'Bridge connection closed');
      };
    });
  }

  protected async send(data: Uint8Array): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(data as Uint8Array<ArrayBuffer>);
  }

  async close(): Promise<void> {
    this.closing = true;
    this.ws?.close();
    this.ws = null;
  }
}
