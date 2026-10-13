import { describe, expect, it, vi } from 'vitest'
import { AtChannel, AtTimeoutError, LinkClosedError, probe, type ByteLink } from './at'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

class FakeLink implements ByteLink {
  readonly description = 'fake'
  readonly written: string[] = []
  readonly closed: Promise<void>
  private handler: (chunk: Uint8Array) => void = () => {}
  private resolveClosed!: () => void

  constructor(private readonly responder?: (command: string, link: FakeLink) => void) {
    this.closed = new Promise((resolve) => {
      this.resolveClosed = resolve
    })
  }

  onData(handler: (chunk: Uint8Array) => void) {
    this.handler = handler
  }

  async write(data: Uint8Array<ArrayBuffer>) {
    const text = decoder.decode(data)
    this.written.push(text)
    this.responder?.(text.replace(/\r$/, ''), this)
  }

  push(text: string) {
    this.handler(encoder.encode(text))
  }

  async close() {
    this.resolveClosed()
  }
}

describe('AtChannel', () => {
  it('strips the echo and returns information lines before OK', async () => {
    const link = new FakeLink((command, l) => l.push(`${command}\r\r\n+CSQ: 24,99\r\n\r\nOK\r\n`))
    const channel = new AtChannel(link)

    const result = await channel.send('AT+CSQ')

    expect(link.written).toEqual(['AT+CSQ\r'])
    expect(result).toMatchObject({ ok: true, final: 'OK', lines: ['+CSQ: 24,99'] })
  })

  it('assembles responses split across arbitrary chunk boundaries', async () => {
    const link = new FakeLink((_command, l) => {
      for (const piece of ['\r', '\n+QCFG: "usb', 'net",1\r', '\n\r\nO', 'K\r', '\n']) l.push(piece)
    })
    const channel = new AtChannel(link)

    const result = await channel.send('AT+QCFG="usbnet"')

    expect(result.lines).toEqual(['+QCFG: "usbnet",1'])
    expect(result.ok).toBe(true)
  })

  it('reports ERROR and +CME ERROR as failed results instead of throwing', async () => {
    const replies = ['\r\nERROR\r\n', '\r\n+CME ERROR: 10\r\n']
    const link = new FakeLink((_command, l) => l.push(replies.shift()!))
    const channel = new AtChannel(link)

    await expect(channel.send('AT+FOO')).resolves.toMatchObject({ ok: false, final: 'ERROR' })
    await expect(channel.send('AT+CPIN?')).resolves.toMatchObject({
      ok: false,
      final: '+CME ERROR: 10',
    })
  })

  it('runs one command at a time', async () => {
    const link = new FakeLink()
    const channel = new AtChannel(link)

    const first = channel.send('AT+CSQ')
    const second = channel.send('AT+COPS?')
    await Promise.resolve()
    expect(link.written).toEqual(['AT+CSQ\r'])

    link.push('\r\n+CSQ: 10,99\r\n\r\nOK\r\n')
    await first
    await vi.waitFor(() => expect(link.written).toEqual(['AT+CSQ\r', 'AT+COPS?\r']))
    link.push('\r\n+COPS: 0,0,"CHN-CT",7\r\n\r\nOK\r\n')
    await expect(second).resolves.toMatchObject({ lines: ['+COPS: 0,0,"CHN-CT",7'] })
  })

  it('forwards unsolicited lines to listeners without mixing them into the next response', async () => {
    const link = new FakeLink((_command, l) => l.push('\r\nOK\r\n'))
    const channel = new AtChannel(link)
    const unsolicited: string[] = []
    channel.onUnsolicited((line) => unsolicited.push(line))

    link.push('\r\nRDY\r\n\r\n+CPIN: READY\r\n')
    const result = await channel.send('AT')

    expect(unsolicited).toEqual(['RDY', '+CPIN: READY'])
    expect(result.lines).toEqual([])
  })

  it('rejects with AtTimeoutError when the module stays silent', async () => {
    const channel = new AtChannel(new FakeLink())
    await expect(channel.send('AT', 20)).rejects.toBeInstanceOf(AtTimeoutError)
  })

  it('rejects the pending command with LinkClosedError when the link drops', async () => {
    const link = new FakeLink()
    const channel = new AtChannel(link)

    const pending = channel.send('AT+CFUN=1,1', 5000)
    await Promise.resolve()
    await link.close()

    await expect(pending).rejects.toBeInstanceOf(LinkClosedError)
    expect(channel.isOpen).toBe(false)
    await expect(channel.send('AT')).rejects.toBeInstanceOf(LinkClosedError)
  })

  it('refuses commands that do not start with AT or contain line breaks', async () => {
    const link = new FakeLink()
    const channel = new AtChannel(link)

    await expect(channel.send('reboot')).rejects.toThrow('AT 指令必须以 AT 开头')
    await expect(channel.send('AT\rAT+CFUN=0')).rejects.toThrow('换行')
    expect(link.written).toEqual([])
  })

  it('probe() is true only for an OK answer', async () => {
    const ok = new AtChannel(new FakeLink((_c, l) => l.push('\r\nOK\r\n')))
    const error = new AtChannel(new FakeLink((_c, l) => l.push('\r\nERROR\r\n')))
    const silent = new AtChannel(new FakeLink())

    expect(await probe(ok)).toBe(true)
    expect(await probe(error)).toBe(false)
    expect(await probe(silent, 20)).toBe(false)
  })
})
