import { AtChannel, probe, type ByteLink } from '../modem/at'
import type { Connector } from '../modem/workflow'
import { DJI_VENDOR_ID, QUECTEL_VENDOR_ID } from './webusb'

export const MODULE_SERIAL_FILTERS: SerialPortFilter[] = [
  { usbVendorId: DJI_VENDOR_ID },
  { usbVendorId: QUECTEL_VENDOR_ID },
]

function isModulePort(port: SerialPort): boolean {
  const { usbVendorId } = port.getInfo()
  return usbVendorId === DJI_VENDOR_ID || usbVendorId === QUECTEL_VENDOR_ID
}

export class WebSerialLink implements ByteLink {
  readonly closed: Promise<void>
  private handler: (chunk: Uint8Array) => void = () => {}
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private closing = false
  private isClosed = false
  private markClosed!: () => void
  private readonly onDisconnect = () => this.markClosed()
  private readonly loop: Promise<void>

  private constructor(private readonly port: SerialPort) {
    this.closed = new Promise((resolve) => {
      this.markClosed = () => {
        if (this.isClosed) return
        this.isClosed = true
        port.removeEventListener('disconnect', this.onDisconnect)
        resolve()
      }
    })
    port.addEventListener('disconnect', this.onDisconnect)
    this.loop = this.readLoop()
  }

  static async open(port: SerialPort): Promise<WebSerialLink> {
    await port.open({ baudRate: 115200 })
    return new WebSerialLink(port)
  }

  get description(): string {
    const { usbVendorId, usbProductId } = this.port.getInfo()
    const id = [usbVendorId, usbProductId]
      .map((value) => (value ?? 0).toString(16).padStart(4, '0'))
      .join(':')
    return `Web Serial · 串口 ${id}`
  }

  onData(handler: (chunk: Uint8Array) => void): void {
    this.handler = handler
  }

  async write(data: Uint8Array<ArrayBuffer>): Promise<void> {
    const writable = this.port.writable
    if (!writable) throw new Error('串口不可写')
    const writer = writable.getWriter()
    try {
      await writer.write(data)
    } finally {
      writer.releaseLock()
    }
  }

  async close(): Promise<void> {
    if (this.isClosed || this.closing) return
    this.closing = true
    try {
      await this.reader?.cancel()
    } catch {
      // The stream already errored because the port went away.
    }
    // SerialPort.close() rejects while the readable stream is still locked.
    await this.loop
    try {
      await this.port.close()
    } catch {
      // Already closed or unplugged.
    }
    this.markClosed()
  }

  private async readLoop(): Promise<void> {
    while (!this.closing && this.port.readable) {
      const reader = this.port.readable.getReader()
      this.reader = reader
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          if (value && value.byteLength > 0) this.handler(value)
        }
      } catch {
        // Non-fatal errors leave a fresh `readable` behind; an unplug sets it to null.
      } finally {
        reader.releaseLock()
        this.reader = null
      }
    }
    if (!this.closing) this.markClosed()
  }
}

export async function openWebSerialChannel(
  port: SerialPort,
  probeTimeoutMs = 1000,
): Promise<AtChannel> {
  let link: WebSerialLink
  try {
    link = await WebSerialLink.open(port)
  } catch (error) {
    throw new Error(`无法打开串口：${(error as Error).message}。请先关闭 llcom 等占用串口的软件。`, { cause: error })
  }
  const channel = new AtChannel(link)
  if (await probe(channel, probeTimeoutMs)) return channel
  await link.close()
  throw new Error('这个串口没有响应 AT 指令，请换一个（Windows 下通常叫「Quectel USB AT Port」）。')
}

export function createWebSerialConnector(
  serial: Serial = navigator.serial,
  { showAllPorts = false }: { showAllPorts?: boolean } = {},
): Connector {
  return {
    kind: 'webserial',
    async request() {
      const port = await serial.requestPort(showAllPorts ? {} : { filters: MODULE_SERIAL_FILTERS })
      return openWebSerialChannel(port)
    },
    async reconnect() {
      const ports = (await serial.getPorts()).filter(isModulePort)
      for (const port of ports) {
        try {
          return await openWebSerialChannel(port)
        } catch {
          // Probably the DIAG or NMEA port; try the next one.
        }
      }
      return null
    },
  }
}
