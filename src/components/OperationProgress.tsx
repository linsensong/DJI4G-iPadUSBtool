import type { OperationState } from '../hooks/useModemSession'

const ICONS: Record<OperationState['steps'][number]['status'], string> = {
  pending: '○',
  running: '◌',
  done: '✓',
  failed: '✕',
}

interface OperationProgressProps {
  operation: OperationState
  onReconnect: () => void
}

export default function OperationProgress({ operation, onReconnect }: OperationProgressProps) {
  return (
    <div className="progress" data-testid="operation-progress" aria-live="polite">
      <ol className="progress__list">
        {operation.steps.map((step) => (
          <li key={step.id} className={`progress__step progress__step--${step.status}`}>
            <span className="progress__icon" aria-hidden>
              {ICONS[step.status]}
            </span>
            <div className="progress__body">
              <span className="progress__title">{step.title}</span>
              {step.command && <code className="progress__command">{step.command}</code>}
              {step.detail && <span className="progress__detail">{step.detail}</span>}
            </div>
          </li>
        ))}
      </ol>

      {operation.message && (
        <p
          className={`notice ${operation.status === 'failed' ? 'notice--error' : 'notice--warn'}`}
          role={operation.status === 'failed' ? 'alert' : undefined}
        >
          {operation.message}
        </p>
      )}

      {operation.status === 'needs-user' && (
        <button type="button" className="button" onClick={onReconnect}>
          重新连接模块
        </button>
      )}
    </div>
  )
}
