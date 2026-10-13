import { AtChannel, probe, type ByteLink } from '../modem/at'
import type { Connector } from '../modem/workflow'

export const DJI_VENDOR_ID = 0x2ca3
export const DJI_PRODUCT_ID = 0x4006
export const QUECTEL_VENDOR_ID = 0x2c7c

/** Factory DJI identity, plus modules that other guides re-identified as Quectel. */
export const MODULE_USB_FILTERS: USBDeviceFilter[] = [
  { vendorId: DJI_VENDOR_ID, productId: DJI_PRODUCT_ID },
  { vendorId: QUECTEL_VENDOR_ID },
]

const VENDOR_SPECIFIC_CLASS = 0xff
/** Quectel firmware puts the AT port on interface 2 and the PPP modem port on 3. */
const PREFERRED_INTERFACES = [2, 3]

export interface BulkCandidate {
  interfaceNumber: number
  endpointIn: number
  endpointOut: number
}

export function matchesModule(device: Pick<USBDevice, 'vendorId' | 'productId'>): boolean {
  return MODULE_USB_FILTERS.some(
    (filter) =>
      filter.vendorId === device.vendorId &&
      (filter.productId === undefined || filter.productId === device.productId),
  )
}

/**
 * Lists vendor-specific interfaces with a bulk IN/OUT pair. Network (CDC) and
 * audio interfaces are skipped: the OS owns them and they never carry AT.
 */
export function findBulkCandidates(configuration: USBConfiguration): BulkCandidate[] {
  const candidates: BulkCandidate[] = []
  for (const usbInterface of configuration.interfaces) {
    const alternate = usbInterface.alternate ?? usbInterface.alternates[0]
    if (!alternate || alternate.interfaceClass !== VENDOR_SPECIFIC_CLASS) continue
    const bulk = alternate.endpoints.filter((endpoint) => endpoint.type === 'bulk')
    const endpointIn = bulk.find((endpoint) => endpoint.direction === 'in')
    const endpointOut = bulk.find((endpoint) => endpoint.direction === 'out')
    if (!endpointIn || !endpointOut) continue
    candidates.push({
      interfaceNumber: usbInterface.interfaceNumber,
      endpointIn: endpointIn.endpointNumber,
      endpointOut: endpointOut.endpointNumber,
    })
  }
  const rank = (candidate: BulkCandidate) => {
    const preferred = PREFERRED_INTERFACES.indexOf(candidate.interfaceNumber)
    return preferred >= 0 ? preferred : PREFERRED_INTERFACES.length + candidate.interfaceNumber
  }
  return candidates.sort((a, b) => rank(a) - rank(b))
}

export class WebUsbLink implements ByteLink {
  readonly closed: Promise<void>
  /** Set once this link is the session's AT channel, so closing it also closes the device. */
  ownsDevice = false
  private handler: (chunk: Uint8Array) => void = () => {}
  private isClosed = false
  private markClosed!: () => void
  private readonly detach: () => void

  constructor(
    private readonly device: USBDevice,
    private readonly candidate: BulkCandidate,
    usb: Pick<USB, 'addEventListener' | 'removeEventListener'> | undefined,
  ) {
    this.closed = new Promise((resolve) => {
      this.markClosed = () => {
        if (this.isClosed) return
        this.isClosed = true
        this.detach()
        resolve()
      }
    })
    const onDisconnect = (event: USBConnectionEvent) => {
      if (event.device === device) this.markClosed()
    }
    usb?.addEventListener('disconnect', onDisconnect)
    this.detach = () => usb?.removeEventListener('disconnect', onDisconnect)
    void this.readLoop()
  }

  get description(): string {
    const id = `${hex(this.device.vendorId)}:${hex(this.device.productId)}`
    return `WebUSB · ${this.device.productName || id} · 接口 ${this.candidate.interfaceNumber}`
  }

  onData(handler: (chunk: Uint8Array) => void): void {
    this.handler = handler
  }

  async write(data: Uint8Array<ArrayBuffer>): Promise<void> {
    const result = await this.device.transferOut(this.candidate.endpointOut, data)
    if (result.status !== 'ok') throw new Error(`USB 写入失败：${result.status}`)
  }

  async close(): Promise<void> {
    if (this.isClosed) return
    // Releasing the interface aborts the pending transferIn and ends the read loop.
    try {
      await this.device.releaseInterface(this.candidate.interfaceNumber)
    } catch {
      // Already released or the device is gone.
    }
    if (this.ownsDevice) {
      try {
        await this.device.close()
      } catch {
        // Already closed or unplugged.
      }
    }
    this.markClosed()
  }

  private async readLoop(): Promise<void> {
    while (!this.isClosed) {
      try {
        const result = await this.device.transferIn(this.candidate.endpointIn, 512)
        if (result.status === 'stall') {
          await this.device.clearHalt('in', this.candidate.endpointIn)
          continue
        }
        if (result.data && result.data.byteLength > 0) {
          this.handler(
            new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength),
          )
        }
      } catch {
        this.markClosed()
      }
    }
  }
}

function hex(value: number): string {
  return value.toString(16).padStart(4, '0')
}

export class WebUsbAccessError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WebUsbAccessError'
  }
}

/** Opens the device and finds the interface that answers `AT` with `OK`. */
export async function openWebUsbChannel(
  device: USBDevice,
  usb: Pick<USB, 'addEventListener' | 'removeEventListener'> | undefined = navigator.usb,
  probeTimeoutMs = 1000,
): Promise<AtChannel> {
  try {
    if (!device.opened) await device.open()
    if (!device.configuration) await device.selectConfiguration(1)
  } catch (error) {
    throw new WebUsbAccessError(
      `无法打开 USB 设备：${(error as Error).message}。macOS 请先退出 DJOneHub 等占用模块的程序；Windows 请改用「串口方式」；Linux 需要 udev 权限。`,
    )
  }
  const configuration = device.configuration
  const candidates = configuration ? findBulkCandidates(configuration) : []
  let claimFailures = 0
  for (const candidate of candidates) {
    try {
      await device.claimInterface(candidate.interfaceNumber)
    } catch {
      claimFailures += 1
      continue
    }
    const link = new WebUsbLink(device, candidate, usb)
    const channel = new AtChannel(link)
    if (await probe(channel, probeTimeoutMs)) {
      link.ownsDevice = true
      return channel
    }
    await link.close()
  }
  try {
    await device.close()
  } catch {
    // Nothing left to release.
  }
  if (candidates.length > 0 && claimFailures === candidates.length) {
    throw new WebUsbAccessError(
      '模块的 AT 接口被系统驱动占用。Windows 请改用「串口方式」；Linux 若已加载 option 驱动，也请改用串口方式。',
    )
  }
  throw new WebUsbAccessError('没有找到会响应 AT 指令的接口，请等模块启动完成（约 20 秒）后重试。')
}

export function createWebUsbConnector(usb: USB = navigator.usb): Connector {
  return {
    kind: 'webusb',
    async request() {
      const device = await usb.requestDevice({ filters: MODULE_USB_FILTERS })
      return openWebUsbChannel(device, usb)
    },
    async reconnect() {
      const devices = (await usb.getDevices()).filter(matchesModule)
      for (const device of devices) {
        try {
          return await openWebUsbChannel(device, usb)
        } catch {
          // Try the next authorised device, if any.
        }
      }
      return null
    },
  }
}
