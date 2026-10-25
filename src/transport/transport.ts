// A Transport is a raw byte pipe. MAVLink framing happens above it.

export type TransportState = 'closed' | 'opening' | 'open';

export abstract class Transport {
  abstract readonly label: string;
  private dataHandlers = new Set<(data: Uint8Array) => void>();
  private closeHandlers = new Set<(reason?: string) => void>();
  bytesIn = 0;
  bytesOut = 0;

  abstract open(): Promise<void>;
  abstract close(): Promise<void>;
  protected abstract send(data: Uint8Array): Promise<void>;

  async write(data: Uint8Array): Promise<void> {
    this.bytesOut += data.length;
    await this.send(data);
  }

  onData(fn: (data: Uint8Array) => void) { this.dataHandlers.add(fn); return () => this.dataHandlers.delete(fn); }
  onClose(fn: (reason?: string) => void) { this.closeHandlers.add(fn); return () => this.closeHandlers.delete(fn); }

  protected emitData(data: Uint8Array) {
    this.bytesIn += data.length;
    for (const fn of this.dataHandlers) fn(data);
  }
  protected emitClose(reason?: string) {
    for (const fn of this.closeHandlers) fn(reason);
  }
}
