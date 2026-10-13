import { describe, expect, it } from 'vitest'
import { createWebSerialConnector, openWebSerialChannel } from './webserial'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

class FakeSerialPort extends EventTarget {
  readable: ReadableStream<Uint8Array> | null = null
  writable: WritableStream<Uint8Array> | null = null
  openedWith: SerialOptions | null = null
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null

  constructor(
    private readonly answersAt = true,
    private readonly info: SerialPortInfo = { usbVendorId: 0x2ca3, usbProductId: 0x4006 },
  ) {
    super()
  }

  getInfo() {
    return this.info
  }

  async open(options: SerialOptions) {
    this.openedWith = options
    this.readable = new ReadableStream({
      start: (controller) => {
        this.controller = controller
      },
    })
    this.writable = new WritableStream({
      write: (chunk) => {
        const command = decoder.decode(chunk).replace(/\r$/, '')
        if (!this.answersAt) return
        const body = command === 'AT' ? 'OK' : `+QCFG: "usbnet",1\r\n\r\nOK`
        this.controller?.enqueue(encoder.encode(`${command}\r\r\n${body}\r\n`))
      },
    })
  }

  async close() {
    if (this.readable?.locked || this.writable?.locked) {
      throw new TypeError('Cannot close a port with locked streams')
    }
    this.readable = null
    this.writable = null
    this.openedWith = null
  }

  unplug() {
    this.controller?.error(new DOMException('The device has been lost.', 'NetworkError'))
    this.readable = null
    this.writable = null
    this.dispatchEvent(new Event('disconnect'))
  }
}

class FakeSerial {
  constructor(readonly ports: FakeSerialPort[]) {}

  async getPorts() {
    return this.ports as unknown as SerialPort[]
  }

  async requestPort() {
    return this.ports[0] as unknown as SerialPort
  }
}

const asPort = (port: FakeSerialPort) => port as unknown as SerialPort

describe('openWebSerialChannel', () => {
  it('opens at 115200 baud and exchanges AT commands', async () => {
    const port = new FakeSerialPort()
    const channel = await openWebSerialChannel(asPort(port), 50)

    expect(port.openedWith).toEqual({ baudRate: 115200 })
    await expect(channel.send('AT+QCFG="usbnet"')).resolves.toMatchObject({
      ok: true,
      lines: ['+QCFG: "usbnet",1'],
    })
  })

  it('rejects a port that does not answer AT and closes it again', async () => {
    const port = new FakeSerialPort(false)
    await expect(openWebSerialChannel(asPort(port), 20)).rejects.toThrow('Quectel USB AT Port')
    expect(port.openedWith).toBeNull()
  })

  it('unlocks the streams before closing the port', async () => {
    const port = new FakeSerialPort()
    const channel = await openWebSerialChannel(asPort(port), 50)

    await channel.close()
    expect(port.openedWith).toBeNull()
    expect(channel.isOpen).toBe(false)
  })

  it('notices when the cable is pulled', async () => {
    const port = new FakeSerialPort()
    const channel = await openWebSerialChannel(asPort(port), 50)

    port.unplug()
    await channel.closed
    expect(channel.isOpen).toBe(false)
  })
})

describe('createWebSerialConnector', () => {
  it('finds the AT port among the module ports after a reboot', async () => {
    const diag = new FakeSerialPort(false)
    const at = new FakeSerialPort(true)
    const unrelated = new FakeSerialPort(true, { usbVendorId: 0x0403, usbProductId: 0x6001 })
    const connector = createWebSerialConnector(
      new FakeSerial([unrelated, diag, at]) as unknown as Serial,
    )

    const channel = await connector.reconnect()

    expect(channel).not.toBeNull()
    expect(at.openedWith).not.toBeNull()
    expect(unrelated.openedWith).toBeNull()
    expect(diag.openedWith).toBeNull()
  })
})
