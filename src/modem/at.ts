/**
 * Byte-level connection to the module's AT interface. WebUSB, Web Serial and
 * the simulated module all implement this so that AT framing lives in one place.
 */
export interface ByteLink {
  readonly description: string
  write(data: Uint8Array<ArrayBuffer>): Promise<void>
  /** Registers the consumer of incoming bytes, replacing any previous one. */
  onData(handler: (chunk: Uint8Array) => void): void
  /** Resolves once the link is gone, whether closed locally or unplugged. Never rejects. */
  readonly closed: Promise<void>
  close(): Promise<void>
}

export interface AtResult {
  command: string
  ok: boolean
  /** Final result code line, e.g. `OK` or `+CME ERROR: 10`. */
  final: string
  /** Information lines between the echo and the final result code. */
  lines: string[]
  raw: string
}

export class AtTimeoutError extends Error {
  constructor(
    readonly command: string,
    readonly partial: string,
  ) {
    super(`指令 ${command} 超时未响应`)
    this.name = 'AtTimeoutError'
  }
}

export class LinkClosedError extends Error {
  constructor(readonly command?: string) {
    super('与模块的连接已断开')
    this.name = 'LinkClosedError'
  }
}

export const DEFAULT_TIMEOUT_MS = 3000

const FINAL_RESULT =
  /^(OK|ERROR|NO CARRIER|NO DIALTONE|BUSY|NO ANSWER|\+CME ERROR:.*|\+CMS ERROR:.*)$/i

const encoder = new TextEncoder()

interface PendingCommand {
  command: string
  resolve: (result: AtResult) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface LineSpan {
  text: string
  end: number
}

function completeLines(text: string): LineSpan[] {
  const spans: LineSpan[] = []
  let start = 0
  for (const match of text.matchAll(/\r\n|\r|\n/g)) {
    const index = match.index ?? 0
    spans.push({ text: text.slice(start, index).trim(), end: index + match[0].length })
    start = index + match[0].length
  }
  return spans
}

export function normalizeCommand(command: string): string {
  const trimmed = command.trim()
  if (!/^AT/i.test(trimmed)) {
    throw new Error('AT 指令必须以 AT 开头')
  }
  if (/[\r\n]/.test(trimmed)) {
    throw new Error('AT 指令不能包含换行')
  }
  return trimmed
}

/**
 * Serialises AT commands over a {@link ByteLink}: one command in flight at a
 * time, echo stripped, unsolicited result codes forwarded to listeners.
 */
export class AtChannel {
  private readonly decoder = new TextDecoder()
  private buffer = ''
  private pending: PendingCommand | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private linkClosed = false
  private readonly unsolicitedListeners = new Set<(line: string) => void>()

  constructor(private readonly link: ByteLink) {
    link.onData((chunk) => this.receive(chunk))
    void link.closed.then(() => this.handleClosed())
  }

  get description(): string {
    return this.link.description
  }

  get closed(): Promise<void> {
    return this.link.closed
  }

  get isOpen(): boolean {
    return !this.linkClosed
  }

  send(command: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<AtResult> {
    let normalized: string
    try {
      normalized = normalizeCommand(command)
    } catch (error) {
      return Promise.reject(error)
    }
    const run = () => this.execute(normalized, timeoutMs)
    const result = this.queue.then(run, run)
    this.queue = result.catch(() => undefined)
    return result
  }

  onUnsolicited(listener: (line: string) => void): () => void {
    this.unsolicitedListeners.add(listener)
    return () => this.unsolicitedListeners.delete(listener)
  }

  async close(): Promise<void> {
    await this.link.close()
  }

  private execute(command: string, timeoutMs: number): Promise<AtResult> {
    if (this.linkClosed) {
      return Promise.reject(new LinkClosedError(command))
    }
    this.flushUnsolicited()
    return new Promise<AtResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending?.timer !== timer) return
        this.pending = null
        const partial = this.buffer
        this.buffer = ''
        reject(new AtTimeoutError(command, partial))
      }, timeoutMs)
      this.pending = { command, resolve, reject, timer }
      this.link.write(encoder.encode(`${command}\r`)).catch((error: unknown) => {
        if (this.pending?.timer !== timer) return
        clearTimeout(timer)
        this.pending = null
        reject(
          this.linkClosed
            ? new LinkClosedError(command)
            : error instanceof Error
              ? error
              : new Error(String(error)),
        )
      })
    })
  }

  private receive(chunk: Uint8Array): void {
    this.buffer += this.decoder.decode(chunk, { stream: true })
    if (this.pending) {
      this.tryComplete(this.pending)
    } else {
      this.flushUnsolicited()
    }
  }

  private tryComplete(pending: PendingCommand): void {
    const spans = completeLines(this.buffer)
    const finalIndex = spans.findIndex((span) => FINAL_RESULT.test(span.text))
    if (finalIndex < 0) return

    const finalSpan = spans[finalIndex]
    const raw = this.buffer.slice(0, finalSpan.end)
    this.buffer = this.buffer.slice(finalSpan.end)

    const lines = spans
      .slice(0, finalIndex)
      .map((span) => span.text)
      .filter((line) => line.length > 0)
    if (lines.length > 0 && lines[0].toUpperCase() === pending.command.toUpperCase()) {
      lines.shift()
    }

    clearTimeout(pending.timer)
    this.pending = null
    const final = finalSpan.text
    pending.resolve({
      command: pending.command,
      ok: final.toUpperCase() === 'OK',
      final,
      lines,
      raw,
    })
  }

  private flushUnsolicited(): void {
    const spans = completeLines(this.buffer)
    if (spans.length === 0) return
    this.buffer = this.buffer.slice(spans[spans.length - 1].end)
    for (const span of spans) {
      if (!span.text) continue
      for (const listener of this.unsolicitedListeners) listener(span.text)
    }
  }

  private handleClosed(): void {
    this.linkClosed = true
    const pending = this.pending
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending = null
    pending.reject(new LinkClosedError(pending.command))
  }
}

/** Sends a bare `AT`; true only when the interface answers `OK`. */
export async function probe(channel: AtChannel, timeoutMs = 1000): Promise<boolean> {
  try {
    const result = await channel.send('AT', timeoutMs)
    return result.ok
  } catch {
    return false
  }
}
