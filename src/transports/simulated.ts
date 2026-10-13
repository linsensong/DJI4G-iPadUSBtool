import { AtChannel, probe, type ByteLink } from '../modem/at'
import type { PdpContext } from '../modem/parse'
import type { Connector } from '../modem/workflow'

export interface SimulatedModuleOptions {
  usbnet?: number
  pdpContexts?: PdpContext[]
  simInserted?: boolean
  /** IMSI of the inserted SIM; the default is a China Telecom card. */
  imsi?: string
  registered?: boolean
  /** Real firmware sometimes restarts on its own right after `AT+QCFG="usbnet",N`. */
  autoRebootOnUsbnet?: boolean
  rebootDelayMs?: number
  echo?: boolean
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

class SimulatedLink implements ByteLink {
  readonly closed: Promise<void>
  readonly description = '演示模式 · 模拟的大疆一代 4G 模块'
  private handler: (chunk: Uint8Array) => void = () => {}
  private pendingInput = ''
  private isClosed = false
  private resolveClosed!: () => void

  constructor(private readonly module: SimulatedModule) {
    this.closed = new Promise((resolve) => {
      this.resolveClosed = resolve
    })
  }

  onData(handler: (chunk: Uint8Array) => void): void {
    this.handler = handler
  }

  async write(data: Uint8Array<ArrayBuffer>): Promise<void> {
    if (this.isClosed) throw new Error('模拟模块已断开')
    this.pendingInput += decoder.decode(data)
    let index = this.pendingInput.indexOf('\r')
    while (index >= 0) {
      const command = this.pendingInput.slice(0, index).trim()
      this.pendingInput = this.pendingInput.slice(index + 1)
      if (command) {
        const response = this.module.handle(command)
        setTimeout(() => this.emit(response), 5)
      }
      index = this.pendingInput.indexOf('\r')
    }
  }

  emit(text: string): void {
    if (!this.isClosed) this.handler(encoder.encode(text))
  }

  async close(): Promise<void> {
    this.detach()
  }

  detach(): void {
    if (this.isClosed) return
    this.isClosed = true
    this.resolveClosed()
  }
}

/**
 * In-browser stand-in for the DJI module, answering with the response formats
 * of its Quectel firmware. Powers demo mode and the automated tests.
 */
export class SimulatedModule {
  usbnet: number
  pdpContexts: PdpContext[]
  simInserted: boolean
  imsi: string
  registered: boolean
  readonly imei = '860000123456789'
  readonly usbcfg = '0x2CA3,0x4006,1,1,1,1,1,0,0'
  /** Every command received, in order, for assertions. */
  readonly history: string[] = []
  private echo: boolean
  private readonly autoRebootOnUsbnet: boolean
  private readonly rebootDelayMs: number
  private attached = true
  private link: SimulatedLink | null = null

  constructor(options: SimulatedModuleOptions = {}) {
    this.usbnet = options.usbnet ?? 0
    this.pdpContexts = (options.pdpContexts ?? [{ cid: 1, pdpType: 'IPV4V6', apn: '' }]).map(
      (context) => ({ ...context }),
    )
    this.simInserted = options.simInserted ?? true
    this.imsi = options.imsi ?? '460110123456789'
    this.registered = options.registered ?? true
    this.autoRebootOnUsbnet = options.autoRebootOnUsbnet ?? false
    this.rebootDelayMs = options.rebootDelayMs ?? 4000
    this.echo = options.echo ?? true
  }

  get isAttached(): boolean {
    return this.attached
  }

  /** Returns a fresh link while the module is on the bus, otherwise null. */
  connect(): ByteLink | null {
    if (!this.attached) return null
    this.link?.detach()
    this.link = new SimulatedLink(this)
    return this.link
  }

  /** Simulates USB re-enumeration: the current link drops, a new one appears later. */
  reboot(): void {
    if (!this.attached) return
    this.attached = false
    this.link?.detach()
    this.link = null
    setTimeout(() => {
      this.attached = true
    }, this.rebootDelayMs)
  }

  handle(command: string): string {
    this.history.push(command)
    const body = this.respond(command)
    return `${this.echo ? `${command}\r` : ''}\r\n${body}\r\n`
  }

  private respond(command: string): string {
    const upper = command.toUpperCase()
    const simError = '+CME ERROR: 10'
    const lte = this.simInserted && this.registered

    if (upper === 'AT') return 'OK'
    if (upper === 'ATE0' || upper === 'ATE1') {
      this.echo = upper === 'ATE1'
      return 'OK'
    }
    if (upper === 'ATI') return 'Quectel\r\nQDC507\r\nRevision: QDC507DEMO_R01\r\n\r\nOK'
    if (upper === 'AT+CGMR') return 'QDC507DEMO_R01\r\n\r\nOK'
    if (upper === 'AT+CGSN') return `${this.imei}\r\n\r\nOK`
    if (upper === 'AT+CPIN?') return this.simInserted ? '+CPIN: READY\r\n\r\nOK' : simError
    if (upper === 'AT+CIMI') return this.simInserted ? `${this.imsi}\r\n\r\nOK` : simError
    if (upper === 'AT+QCCID') {
      return this.simInserted ? '+QCCID: 89860321000000000017\r\n\r\nOK' : simError
    }
    if (upper === 'AT+CFUN?') return '+CFUN: 1\r\n\r\nOK'
    if (upper === 'AT+CSQ') return `+CSQ: ${lte ? 24 : 99},99\r\n\r\nOK`
    if (upper === 'AT+COPS?') return lte ? '+COPS: 0,0,"CHN-CT",7\r\n\r\nOK' : '+COPS: 0\r\n\r\nOK'
    if (upper === 'AT+CEREG?') return `+CEREG: 0,${lte ? 1 : 2}\r\n\r\nOK`
    if (upper === 'AT+QNWINFO') {
      return lte
        ? '+QNWINFO: "FDD LTE","46011","LTE BAND 3",1825\r\n\r\nOK'
        : '+QNWINFO: No Service\r\n\r\nOK'
    }
    if (upper === 'AT+CGDCONT?') {
      const lines = this.pdpContexts.map(
        (c) => `+CGDCONT: ${c.cid},"${c.pdpType}","${c.apn}","0.0.0.0",0,0,0,0`,
      )
      return [...lines, '', 'OK'].join('\r\n')
    }
    const cgdcont = /^AT\+CGDCONT=(\d+),"([^"]*)","([^"]*)"$/i.exec(command)
    if (cgdcont) {
      const cid = Number(cgdcont[1])
      const context = { cid, pdpType: cgdcont[2], apn: cgdcont[3] }
      this.pdpContexts = [...this.pdpContexts.filter((c) => c.cid !== cid), context].sort(
        (a, b) => a.cid - b.cid,
      )
      return 'OK'
    }
    if (/^AT\+QCFG="USBNET"\??$/.test(upper)) return `+QCFG: "usbnet",${this.usbnet}\r\n\r\nOK`
    const usbnet = /^AT\+QCFG="USBNET",([0-3])$/.exec(upper)
    if (usbnet) {
      this.usbnet = Number(usbnet[1])
      if (this.autoRebootOnUsbnet) setTimeout(() => this.reboot(), 20)
      return 'OK'
    }
    if (/^AT\+QCFG="USBCFG"\??$/.test(upper)) return `+QCFG: "usbcfg",${this.usbcfg}\r\n\r\nOK`
    if (upper === 'AT+CFUN=1,1') {
      setTimeout(() => this.reboot(), 20)
      return 'OK'
    }
    return 'ERROR'
  }
}

export function createSimulatedConnector(module: SimulatedModule): Connector {
  const open = async () => {
    const link = module.connect()
    if (!link) return null
    const channel = new AtChannel(link)
    if (await probe(channel)) return channel
    await link.close()
    return null
  }
  return {
    kind: 'demo',
    async request() {
      const channel = await open()
      if (!channel) throw new Error('模拟模块正在重启，请稍后再试')
      return channel
    },
    reconnect: open,
  }
}
