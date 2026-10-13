import { useState } from 'react'
import { isOperationActive, type OperationState } from '../hooks/useModemSession'
import { parseBackup, type ModemBackup } from '../modem/backup'
import { describeUsbnet, planFactoryUsbnet, planRestore, type SetupPlan } from '../modem/plan'
import type { ModemSnapshot } from '../modem/status'
import OperationProgress from './OperationProgress'

interface RestorePanelProps {
  snapshot: ModemSnapshot
  operation: OperationState | null
  connected: boolean
  originalBackup: ModemBackup | null
  onRun: (plan: SetupPlan) => void
  onReconnect: () => void
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('zh-CN', { hour12: false })
}

export default function RestorePanel({
  snapshot,
  operation,
  connected,
  originalBackup,
  onRun,
  onReconnect,
}: RestorePanelProps) {
  const [imported, setImported] = useState<ModemBackup | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const backup = imported ?? originalBackup
  const ownOperation = operation?.kind === 'restore' ? operation : null
  const active = isOperationActive(operation)

  let plan: SetupPlan | null = null
  let planError: string | null = null
  try {
    plan = backup ? planRestore(backup, snapshot) : planFactoryUsbnet(snapshot)
  } catch (error) {
    planError = (error as Error).message
  }

  async function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      setImported(parseBackup(await file.text()))
      setImportError(null)
    } catch (error) {
      setImportError((error as Error).message)
    }
  }

  return (
    <section className="card" aria-labelledby="restore-title">
      <div className="card__header">
        <div>
          <p className="card__step">需要时</p>
          <h2 id="restore-title">恢复原始配置（还给无人机用）</h2>
        </div>
        <label className="button button--ghost file-button">
          导入备份文件
          <input type="file" accept="application/json,.json" onChange={handleImport} />
        </label>
      </div>

      {backup ? (
        <dl className="backup-summary" data-testid="backup-summary">
          <div>
            <dt>来源</dt>
            <dd>{imported ? '导入的备份文件' : '首次连接时自动备份'}</dd>
          </div>
          <div>
            <dt>备份时间</dt>
            <dd>{formatTime(backup.createdAt)}</dd>
          </div>
          <div>
            <dt>USB 网卡模式</dt>
            <dd>{describeUsbnet(backup.usbnet)}</dd>
          </div>
          <div>
            <dt>APN</dt>
            <dd>{backup.pdpContexts.find((c) => c.cid === 1)?.apn || '（空）'}</dd>
          </div>
        </dl>
      ) : (
        <p className="card__lede">没有找到这块模块的备份，可以导入之前下载的备份文件。</p>
      )}

      {importError && <p className="notice notice--error">{importError}</p>}
      {planError && <p className="notice notice--error">{planError}</p>}
      {plan && plan.warnings.length > 0 && (
        <ul className="notice notice--warn notice--list">
          {plan.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      {ownOperation && <OperationProgress operation={ownOperation} onReconnect={onReconnect} />}

      {ownOperation?.status === 'done' ? (
        <p className="notice notice--good">已恢复，模块可以重新装回无人机使用。</p>
      ) : plan && plan.steps.length === 0 ? (
        <p className="notice notice--good" data-testid="restore-noop">
          当前配置与备份一致，无需恢复。
        </p>
      ) : (
        plan && (
          <button
            type="button"
            className="button button--secondary"
            disabled={!connected || active}
            onClick={() => onRun(plan)}
          >
            {backup ? '恢复到备份配置' : '仅把 USB 网卡模式改回 0'}
          </button>
        )
      )}
    </section>
  )
}
