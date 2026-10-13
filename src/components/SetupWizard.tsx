import { useState } from 'react'
import { isOperationActive, type OperationState } from '../hooks/useModemSession'
import type { ModemBackup } from '../modem/backup'
import { CARRIERS } from '../modem/carriers'
import {
  describeUsbnet,
  IPAD_USBNET_MODE,
  planIpadSetup,
  recommendApn,
  type ApnChoice,
  type ApnRecommendation,
  type SetupPlan,
} from '../modem/plan'
import { primaryContext, type ModemSnapshot } from '../modem/status'
import OperationProgress from './OperationProgress'

interface SetupWizardProps {
  snapshot: ModemSnapshot
  operation: OperationState | null
  connected: boolean
  originalBackup: ModemBackup | null
  onRun: (plan: SetupPlan) => void
  onReconnect: () => void
  onDownloadBackup: () => void
}

type ApnMode = 'recommended' | 'keep' | 'custom'

interface ApnOptionsProps {
  mode: ApnMode
  customApn: string
  currentApn: string
  recommendation: ApnRecommendation
  disabled: boolean
  onModeChange: (mode: ApnMode) => void
  onCustomApnChange: (apn: string) => void
}

function ApnOptions({
  mode,
  customApn,
  currentApn,
  recommendation,
  disabled,
  onModeChange,
  onCustomApnChange,
}: ApnOptionsProps) {
  return (
    <fieldset className="apn" disabled={disabled}>
      <legend>APN（接入点）</legend>
      <label className="apn__option">
        <input
          type="radio"
          name="apn"
          checked={mode === 'recommended'}
          onChange={() => onModeChange('recommended')}
        />
        <span>
          <strong>
            推荐：
            {recommendation.choice.kind === 'set'
              ? `设为「${recommendation.choice.apn}」`
              : '保持当前 APN'}
          </strong>
          <small>{recommendation.reason}</small>
        </span>
      </label>
      {recommendation.choice.kind === 'set' && (
        <label className="apn__option">
          <input
            type="radio"
            name="apn"
            checked={mode === 'keep'}
            onChange={() => onModeChange('keep')}
          />
          <span>
            <strong>保持当前 APN</strong>
            <small>{currentApn ? `「${currentApn}」` : '当前为空，由运营商网络自动分配'}</small>
          </span>
        </label>
      )}
      <label className="apn__option">
        <input
          type="radio"
          name="apn"
          checked={mode === 'custom'}
          onChange={() => onModeChange('custom')}
        />
        <span>
          <strong>自定义</strong>
          <small>{CARRIERS.map((carrier) => `${carrier.name} ${carrier.apn}`).join(' · ')}</small>
        </span>
      </label>
      {mode === 'custom' && (
        <input
          className="input"
          type="text"
          value={customApn}
          placeholder="例如 ctnet"
          aria-label="自定义 APN"
          onChange={(event) => onCustomApnChange(event.target.value)}
        />
      )}
    </fieldset>
  )
}

export default function SetupWizard({
  snapshot,
  operation,
  connected,
  originalBackup,
  onRun,
  onReconnect,
  onDownloadBackup,
}: SetupWizardProps) {
  const [apnMode, setApnMode] = useState<ApnMode>('recommended')
  const [customApn, setCustomApn] = useState('')
  const recommendation = recommendApn(snapshot)

  const choice: ApnChoice =
    apnMode === 'custom'
      ? { kind: 'set', apn: customApn }
      : apnMode === 'keep'
        ? { kind: 'keep' }
        : recommendation.choice

  let plan: SetupPlan | null = null
  let planError: string | null = null
  try {
    plan = planIpadSetup(snapshot, choice)
  } catch (error) {
    planError = (error as Error).message
  }

  const ownOperation = operation?.kind === 'ipad' ? operation : null
  const active = isOperationActive(operation)
  const nothingToDo = plan !== null && plan.steps.length === 0
  const showOptions = !ownOperation || ownOperation.status === 'failed'

  return (
    <section className="card card--primary" aria-labelledby="setup-title">
      <div className="card__header">
        <div>
          <p className="card__step">第 2 步</p>
          <h2 id="setup-title">一键切换为 iPad 网卡模式</h2>
        </div>
      </div>

      <p className="card__lede">
        {snapshot.usbnet === IPAD_USBNET_MODE ? (
          <>
            模块当前已是 <strong>1 · ECM</strong> 模式。
          </>
        ) : (
          <>
            把模块的 USB 网卡模式从 {describeUsbnet(snapshot.usbnet)} 切到 <strong>1 · ECM</strong>。
          </>
        )}
        ECM 是标准的 USB 以太网协议，iPadOS 自带驱动，iPad 上不需要安装任何 App。
      </p>

      {showOptions && (
        <>
          <ApnOptions
            mode={apnMode}
            customApn={customApn}
            currentApn={primaryContext(snapshot)?.apn ?? ''}
            recommendation={recommendation}
            disabled={active}
            onModeChange={setApnMode}
            onCustomApnChange={setCustomApn}
          />
          {planError && <p className="notice notice--error">{planError}</p>}
          {plan && plan.warnings.length > 0 && (
            <ul className="notice notice--warn notice--list">
              {plan.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
        </>
      )}

      <div className="backup-line">
        {originalBackup ? (
          <>
            <span>
              ✓ 原始配置已自动备份在本浏览器（usbnet={originalBackup.usbnet ?? '未知'}，APN=
              {originalBackup.pdpContexts.find((c) => c.cid === 1)?.apn || '空'}）
            </span>
            <button type="button" className="button button--ghost" onClick={onDownloadBackup}>
              下载备份文件
            </button>
          </>
        ) : (
          <span>正在备份原始配置…</span>
        )}
      </div>

      {plan && !nothingToDo && !ownOperation && (
        <div className="plan">
          <p className="plan__title">将依次发送以下指令：</p>
          <ol className="plan__steps">
            {plan.steps.map((step) => (
              <li key={step.id}>
                <span>{step.title}</span>
                <code>{step.command}</code>
              </li>
            ))}
          </ol>
        </div>
      )}

      {nothingToDo && !ownOperation && (
        <p className="notice notice--good" data-testid="already-ready">
          模块已经是 ECM 模式，APN 也无需修改。可以直接拔下模块，按第 3 步接到 iPad 上。
        </p>
      )}

      {ownOperation && <OperationProgress operation={ownOperation} onReconnect={onReconnect} />}

      {ownOperation?.status === 'done' && (
        <div className="success" data-testid="setup-success">
          <strong>配置完成！</strong>
          <span>
            现在拔下模块，用 USB-C 数据线接到 iPad，打开「设置 → 以太网」，应能看到名为
            「Baiwang」之类的网卡，IP 地址形如 192.168.225.x。详细说明见下方第 3 步。
          </span>
        </div>
      )}

      {!nothingToDo && ownOperation?.status !== 'done' && (
        <button
          type="button"
          className="button button--large"
          disabled={!connected || active || !plan}
          onClick={() => plan && onRun(plan)}
        >
          {active ? '正在配置…' : '开始配置（模块会自动重启）'}
        </button>
      )}
    </section>
  )
}
