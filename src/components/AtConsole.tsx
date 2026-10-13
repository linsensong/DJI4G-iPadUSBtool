import { useState } from 'react'
import type { AtResult } from '../modem/at'
import { assessCommand, type CommandRisk } from '../modem/plan'

interface AtConsoleProps {
  disabled: boolean
  onSend: (command: string, timeoutMs?: number) => Promise<AtResult>
}

interface LogEntry {
  id: number
  command: string
  output: string
  ok: boolean
}

const QUICK_COMMANDS = [
  'AT+CSQ',
  'AT+COPS?',
  'AT+CEREG?',
  'AT+QNWINFO',
  'AT+CGDCONT?',
  'AT+CGPADDR=1',
  'AT+QCFG="usbnet"',
]

let nextId = 0

export default function AtConsole({ disabled, onSend }: AtConsoleProps) {
  const [command, setCommand] = useState('')
  const [log, setLog] = useState<LogEntry[]>([])
  const [pendingRisk, setPendingRisk] = useState<CommandRisk | null>(null)
  const [sending, setSending] = useState(false)

  async function send(text: string, confirmed = false) {
    const trimmed = text.trim()
    if (!trimmed) return
    const risk = assessCommand(trimmed)
    if (risk.level === 'blocked' || (risk.level === 'danger' && !confirmed)) {
      setPendingRisk(risk)
      return
    }
    setPendingRisk(null)
    setSending(true)
    let entry: LogEntry
    try {
      const result = await onSend(trimmed, 10_000)
      entry = {
        id: nextId++,
        command: result.command,
        output: [...result.lines, result.final].join('\n'),
        ok: result.ok,
      }
    } catch (error) {
      entry = { id: nextId++, command: trimmed, output: (error as Error).message, ok: false }
    } finally {
      setSending(false)
    }
    setLog((current) => [...current.slice(-49), entry])
  }

  return (
    <section className="card" aria-labelledby="console-title">
      <div className="card__header">
        <div>
          <p className="card__step">高级</p>
          <h2 id="console-title">AT 指令调试台</h2>
        </div>
      </div>

      <div className="quick">
        {QUICK_COMMANDS.map((quick) => (
          <button
            key={quick}
            type="button"
            className="chip"
            disabled={disabled || sending}
            onClick={() => send(quick)}
          >
            {quick}
          </button>
        ))}
      </div>

      <form
        className="console__form"
        onSubmit={(event) => {
          event.preventDefault()
          void send(command)
        }}
      >
        <input
          className="input input--mono"
          type="text"
          value={command}
          placeholder='AT+QCFG="usbnet"'
          aria-label="AT 指令"
          spellCheck={false}
          autoCapitalize="off"
          onChange={(event) => {
            setCommand(event.target.value)
            setPendingRisk(null)
          }}
        />
        <button type="submit" className="button" disabled={disabled || sending}>
          发送
        </button>
      </form>

      {pendingRisk?.level === 'blocked' && (
        <p className="notice notice--error" role="alert">
          {pendingRisk.reason}
        </p>
      )}
      {pendingRisk?.level === 'danger' && (
        <div className="notice notice--warn" role="alert">
          <p>⚠️ 危险指令：{pendingRisk.reason}</p>
          <button
            type="button"
            className="button button--danger"
            onClick={() => send(command, true)}
          >
            我了解风险，仍然发送
          </button>
        </div>
      )}

      <div className="console__log" data-testid="console-log">
        {log.length === 0 ? (
          <span className="console__empty">指令与模块的回复会显示在这里。</span>
        ) : (
          log.map((entry) => (
            <div key={entry.id} className="console__entry">
              <span className="console__command">&gt; {entry.command}</span>
              <pre className={entry.ok ? 'console__ok' : 'console__error'}>{entry.output}</pre>
            </div>
          ))
        )}
      </div>
    </section>
  )
}
