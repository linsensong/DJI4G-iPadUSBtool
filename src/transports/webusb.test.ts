import { describe, expect, it } from 'vitest'
import { LinkClosedError } from '../modem/at'
import {
  createWebUsbConnector,
  findBulkCandidates,
  matchesModule,
  openWebUsbChannel,
  WebUsbAccessError,
} from './webusb'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

interface FakeInterface {
  number: number
  cls: number
  bulkIn?: number
  bulkOut?: number
}

/** Interface layout of the DJI module in ECM mode: DIAG, NMEA, AT, MODEM, then CDC-ECM. */
const DJI_INTERFACES: FakeInterface[] = [
  { number: 0, cls: 0xff, bulkIn: 1, bulkOut: 1 },
  { number: 1, cls: 0xff, bulkIn: 2, bulkOut: 2 },
  { number: 2, cls: 0xff, bulkIn: 3, bulkOut: 3 },
  { number: 3, cls: 0xff, bulkIn: 4, bulkOut: 4 },
  { number: 4, cls: 0x02 },
  { number: 5, cls: 0x0a, bulkIn: 6, bulkOut: 5 },
]

function configurationOf(interfaces: FakeInterface[]): USBConfiguration {
  return {
    configurationValue: 1,
    configurationName: null,
    interfaces: interfaces.map((spec) => {
      const endpoints = [
        ...(spec.bulkIn ? [{ endpointNumber: spec.bulkIn, direction: 'in', type: 'bulk' }] : []),
        ...(spec.bulkOut ? [{ endpointNumber: spec.bulkOut, direction: 'out', type: 'bulk' }] : []),
        ...(spec.cls === 0x02 ? [{ endpointNumber: 7, direction: 'in', type: 'interrupt' }] : []),
      ] as USBEndpoint[]
      const alternate = {
        alternateSetting: 0,
        interfaceClass: spec.cls,
        interfaceSubclass: 0,
        interfaceProtocol: 0,
        interfaceName: null,
        endpoints,
      } as USBAlternateInterface
      return {
        interfaceNumber: spec.number,
        alternate,
        alternates: [alternate],
        claimed: false,
      } as USBInterface
    }),
  }
}

type Waiter = { resolve: (r: USBInTransferResult) => void; reject: (e: Error) => void }

class FakeUsbDevice {
  vendorId = 0x2ca3
  productId = 0x4006
  productName = 'Baiwang'
  opened = false
  readonly configuration: USBConfiguration
  readonly claimed = new Set<number>()
  private readonly queues = new Map<number, { chunks: Uint8Array[]; waiters: Waiter[] }>()

  constructor(
    private readonly interfaces: FakeInterface[] = DJI_INTERFACES,
    /** Interfaces that answer AT commands. */
    private readonly atInterfaces = new Set([2, 3]),
    private readonly lockedInterfaces = new Set<number>(),
  ) {
    this.configuration = configurationOf(interfaces)
  }

  async open() {
    this.opened = true
  }

  async close() {
    this.opened = false
    for (const n of [...this.claimed]) await this.releaseInterface(n)
  }

  async selectConfiguration() {}

  async claimInterface(n: number) {
    if (this.lockedInterfaces.has(n)) throw new DOMException('Unable to claim interface.', 'NetworkError')
    this.claimed.add(n)
  }

  async releaseInterface(n: number) {
    this.claimed.delete(n)
    const spec = this.interfaces.find((i) => i.number === n)
    if (spec?.bulkIn) this.failWaiters(spec.bulkIn, new DOMException('aborted', 'AbortError'))
  }

  async clearHalt() {}

  async transferOut(endpoint: number, data: BufferSource): Promise<USBOutTransferResult> {
    const spec = this.interfaces.find((i) => i.bulkOut === endpoint)!
    const command = decoder.decode(data as Uint8Array).replace(/\r$/, '')
    if (this.atInterfaces.has(spec.number)) {
      const body = command === 'AT' ? 'OK' : `+ECHO: ${command}\r\n\r\nOK`
      this.deliver(spec.bulkIn!, `\r\n${body}\r\n`)
    }
    return { status: 'ok', bytesWritten: (data as Uint8Array).byteLength }
  }

  transferIn(endpoint: number): Promise<USBInTransferResult> {
    const queue = this.queue(endpoint)
    const chunk = queue.chunks.shift()
    if (chunk) return Promise.resolve({ status: 'ok', data: new DataView(chunk.buffer) })
    return new Promise((resolve, reject) => queue.waiters.push({ resolve, reject }))
  }

  unplug() {
    for (const endpoint of this.queues.keys()) {
      this.failWaiters(endpoint, new DOMException('The device was disconnected.', 'NotFoundError'))
    }
  }

  private deliver(endpoint: number, text: string) {
    const queue = this.queue(endpoint)
    const chunk = encoder.encode(text)
    const waiter = queue.waiters.shift()
    if (waiter) waiter.resolve({ status: 'ok', data: new DataView(chunk.buffer) })
    else queue.chunks.push(chunk)
  }

  private failWaiters(endpoint: number, error: Error) {
    const queue = this.queue(endpoint)
    for (const waiter of queue.waiters.splice(0)) waiter.reject(error)
  }

  private queue(endpoint: number) {
    let queue = this.queues.get(endpoint)
    if (!queue) {
      queue = { chunks: [], waiters: [] }
      this.queues.set(endpoint, queue)
    }
    return queue
  }
}

class FakeUsb extends EventTarget {
  constructor(readonly devices: FakeUsbDevice[] = []) {
    super()
  }

  async getDevices() {
    return this.devices as unknown as USBDevice[]
  }

  async requestDevice() {
    if (this.devices.length === 0) throw new DOMException('No device selected.', 'NotFoundError')
    return this.devices[0] as unknown as USBDevice
  }

  disconnect(device: FakeUsbDevice) {
    device.unplug()
    this.dispatchEvent(Object.assign(new Event('disconnect'), { device }))
  }
}

const asDevice = (device: FakeUsbDevice) => device as unknown as USBDevice
const asUsb = (usb: FakeUsb) => usb as unknown as USB

describe('findBulkCandidates', () => {
  it('prefers the Quectel AT port and skips the CDC network interfaces', () => {
    const candidates = findBulkCandidates(configurationOf(DJI_INTERFACES))
    expect(candidates.map((c) => c.interfaceNumber)).toEqual([2, 3, 0, 1])
    expect(candidates[0]).toEqual({ interfaceNumber: 2, endpointIn: 3, endpointOut: 3 })
  })
})

describe('matchesModule', () => {
  it('accepts the DJI identity and re-identified Quectel modules only', () => {
    expect(matchesModule({ vendorId: 0x2ca3, productId: 0x4006 })).toBe(true)
    expect(matchesModule({ vendorId: 0x2c7c, productId: 0x0125 })).toBe(true)
    expect(matchesModule({ vendorId: 0x2ca3, productId: 0x0008 })).toBe(false)
  })
})

describe('openWebUsbChannel', () => {
  it('talks AT over interface 2', async () => {
    const device = new FakeUsbDevice()
    const channel = await openWebUsbChannel(asDevice(device), asUsb(new FakeUsb()), 50)

    expect(channel.description).toContain('接口 2')
    await expect(channel.send('AT+CSQ')).resolves.toMatchObject({ ok: true, lines: ['+ECHO: AT+CSQ'] })
    expect([...device.claimed]).toEqual([2])
  })

  it('falls back to the next interface when the AT port is held by a driver', async () => {
    const device = new FakeUsbDevice(DJI_INTERFACES, new Set([2, 3]), new Set([2]))
    const channel = await openWebUsbChannel(asDevice(device), asUsb(new FakeUsb()), 50)
    expect(channel.description).toContain('接口 3')
  })

  it('explains when every interface is owned by the operating system', async () => {
    const device = new FakeUsbDevice(DJI_INTERFACES, new Set([2]), new Set([0, 1, 2, 3]))
    await expect(openWebUsbChannel(asDevice(device), asUsb(new FakeUsb()), 50)).rejects.toThrow(
      '被系统驱动占用',
    )
  })

  it('releases everything when no interface answers', async () => {
    const device = new FakeUsbDevice(DJI_INTERFACES, new Set())
    const opening = openWebUsbChannel(asDevice(device), asUsb(new FakeUsb()), 20)

    await expect(opening).rejects.toBeInstanceOf(WebUsbAccessError)
    expect(device.claimed.size).toBe(0)
    expect(device.opened).toBe(false)
  })

  it('closes the channel when the module is unplugged', async () => {
    const device = new FakeUsbDevice()
    const usb = new FakeUsb([device])
    const channel = await openWebUsbChannel(asDevice(device), asUsb(usb), 50)

    usb.disconnect(device)
    await channel.closed
    await expect(channel.send('AT')).rejects.toBeInstanceOf(LinkClosedError)
  })

  it('closes the device once the session channel is closed', async () => {
    const device = new FakeUsbDevice()
    const channel = await openWebUsbChannel(asDevice(device), asUsb(new FakeUsb()), 50)

    await channel.close()
    expect(device.opened).toBe(false)
    expect(device.claimed.size).toBe(0)
  })
})

describe('createWebUsbConnector', () => {
  it('reconnects to an already authorised module without a picker', async () => {
    const other = new FakeUsbDevice()
    other.vendorId = 0x1234
    const usb = new FakeUsb([other])
    const connector = createWebUsbConnector(asUsb(usb))
    await expect(connector.reconnect()).resolves.toBeNull()

    usb.devices.push(new FakeUsbDevice())
    const channel = await connector.reconnect()
    expect(channel?.description).toContain('Baiwang')
  })
})
