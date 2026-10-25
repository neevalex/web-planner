// USB / UART via the Web Serial API (desktop Chromium browsers).
import { Transport } from './transport';

export const serialSupported = () => typeof navigator !== 'undefined' && 'serial' in navigator;

/** Why USB isn't available, in words the user can act on — or null when it is. */
export function serialUnavailableReason(): { text: string; localUrl?: string } | null {
  if (serialSupported()) return null;
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    const { port, pathname } = window.location;
    return {
      text: `USB needs a secure page. Chrome turns Web Serial off on plain http:// addresses other than localhost. On the computer the flight controller is plugged into, open the localhost address, or serve WebPlanner over https.`,
      localUrl: `http://localhost${port ? ':' + port : ''}${pathname}`,
    };
  }
  return { text: 'This browser has no Web Serial. Use Chrome or Edge on a computer, or connect over the network.' };
}

export class SerialTransport extends Transport {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private closing = false;
  label = 'USB';

  constructor(private baudRate: number, private existingPort?: SerialPort) { super(); }

  /** USB ids of the open port, used to find it again for auto-connect. */
  get usbInfo() { const i = this.port?.getInfo(); return { vid: i?.usbVendorId, pid: i?.usbProductId, baud: this.baudRate }; }

  /** Must be called from a user gesture (click) when no port was passed in. */
  async open(): Promise<void> {
    this.port = this.existingPort ?? await navigator.serial.requestPort();
    await this.port.open({ baudRate: this.baudRate, bufferSize: 64 * 1024 });
    const info = this.port.getInfo();
    this.label = info.usbVendorId
      ? `USB ${info.usbVendorId.toString(16).padStart(4, '0')}:${(info.usbProductId ?? 0).toString(16).padStart(4, '0')} @ ${this.baudRate}`
      : `Serial @ ${this.baudRate}`;
    this.writer = this.port.writable!.getWriter();
    this.closing = false;
    void this.readLoop();
  }

  private async readLoop() {
    const port = this.port!;
    let reason: string | undefined;
    try {
      while (port.readable && !this.closing) {
        this.reader = port.readable.getReader();
        try {
          for (;;) {
            const { value, done } = await this.reader.read();
            if (done) break;
            if (value) this.emitData(value);
          }
        } finally {
          this.reader.releaseLock();
          this.reader = null;
        }
      }
    } catch (e) {
      reason = (e as Error).message; // e.g. device unplugged
    }
    if (!this.closing) {
      await this.close().catch(() => {});
      this.emitClose(reason ?? 'Serial port closed');
    }
  }

  protected async send(data: Uint8Array): Promise<void> {
    if (!this.writer) throw new Error('Serial port not open');
    await this.writer.write(data);
  }

  async close(): Promise<void> {
    this.closing = true;
    try { await this.reader?.cancel(); } catch { /* ignore */ }
    try { this.writer?.releaseLock(); } catch { /* ignore */ }
    this.writer = null;
    try { await this.port?.close(); } catch { /* ignore */ }
    this.port = null;
  }
}

export interface RememberedPort { vid?: number; pid?: number; baud: number }

/** A previously granted port matching the remembered USB ids (no user gesture needed). */
export async function findRememberedPort(r: RememberedPort): Promise<SerialPort | null> {
  const ports = await grantedPorts();
  const match = ports.find((p) => { const i = p.getInfo(); return r.vid !== undefined && i.usbVendorId === r.vid && i.usbProductId === r.pid; });
  return match ?? (ports.length === 1 && r.vid === undefined ? ports[0] : null);
}

export async function grantedPorts(): Promise<SerialPort[]> {
  return serialSupported() ? navigator.serial.getPorts() : [];
}
