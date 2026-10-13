import { maskIdentifier } from '../lib/environment'
import type { SimState } from '../modem/parse'
import { describeUsbnet, IPAD_USBNET_MODE, USBNET_MODES } from '../modem/plan'
import { primaryContext, type ModemSnapshot } from '../modem/status'

interface StatusPanelProps {
  snapshot: ModemSnapshot
  reading: boolean
  onRefresh: () => void
}

const SIM_TEXT: Record<SimState['kind'], string> = {
  ready: '已就绪',
  absent: '未插卡',
  'pin-required': '需要 PIN 码',
  'puk-required': '需要 PUK 码',
  busy: '正在初始化',
  error: '异常',
}

type Tone = 'good' | 'warn' | 'bad' | 'neutral'

function Tile({
  label,
  value,
  hint,
  tone = 'neutral',
  testId,
}: {
  label: string
  value: React.ReactNode
  hint?: string
  tone?: Tone
  testId?: string
}) {
  return (
    <div className={`tile tile--${tone}`} data-testid={testId}>
      <span className="tile__label">{label}</span>
      <span className="tile__value">{value}</span>
      {hint && <span className="tile__hint">{hint}</span>}
    </div>
  )
}

function SignalBars({ bars }: { bars: number }) {
  return (
    <span className="bars" aria-label={`信号 ${bars} 格`}>
      {[1, 2, 3, 4].map((level) => (
        <span key={level} className={`bars__bar ${level <= bars ? 'bars__bar--on' : ''}`} />
      ))}
    </span>
  )
}

export default function StatusPanel({ snapshot, reading, onRefresh }: StatusPanelProps) {
  const { identity, sim, signal, registration, network, usbnet, usbcfg, carrier } = snapshot
  const apn = primaryContext(snapshot)
  const usbnetReady = usbnet === IPAD_USBNET_MODE

  return (
    <section className="card" aria-labelledby="status-title">
      <div className="card__header">
        <div>
          <p className="card__step">模块状态</p>
          <h2 id="status-title">{identity.model ? `${identity.manufacturer ?? ''} ${identity.model}`.trim() : '已连接的模块'}</h2>
        </div>
        <button type="button" className="button button--ghost" onClick={onRefresh} disabled={reading}>
          {reading ? '读取中…' : '刷新'}
        </button>
      </div>

      <div className="tiles">
        <Tile
          label="USB 网卡模式"
          value={describeUsbnet(usbnet)}
          hint={usbnet !== null ? USBNET_MODES[usbnet]?.hint : undefined}
          tone={usbnetReady ? 'good' : 'warn'}
          testId="tile-usbnet"
        />
        <Tile
          label="SIM 卡"
          value={`${SIM_TEXT[sim.kind]}${carrier ? ` · ${carrier.name}` : ''}`}
          hint={snapshot.iccid ? `ICCID ${maskIdentifier(snapshot.iccid)}` : undefined}
          tone={sim.kind === 'ready' ? 'good' : 'bad'}
          testId="tile-sim"
        />
        <Tile
          label="蜂窝网络"
          value={registration?.label ?? '未知'}
          hint={
            network && network.accessTech !== 'No Service'
              ? [network.accessTech, network.band].filter(Boolean).join(' · ')
              : snapshot.operator?.name ?? undefined
          }
          tone={registration?.registered ? 'good' : 'warn'}
        />
        <Tile
          label="信号"
          value={
            signal ? (
              <>
                <SignalBars bars={signal.bars} />
                <span>{signal.dbm !== null ? `${signal.dbm} dBm` : '无信号'}</span>
              </>
            ) : (
              '未知'
            )
          }
          hint={signal ? `CSQ ${signal.rssi}` : undefined}
          tone={signal && signal.bars >= 2 ? 'good' : 'warn'}
        />
        <Tile
          label="APN（上下文 1）"
          value={apn ? apn.apn || '（空，由网络分配）' : '未配置'}
          hint={apn?.pdpType}
          testId="tile-apn"
        />
        <Tile
          label="USB 身份"
          value={
            usbcfg
              ? `${usbcfg.vendorId.toString(16).padStart(4, '0')}:${usbcfg.productId.toString(16).padStart(4, '0')}`
              : '未知'
          }
          hint={usbcfg ? `功能位 ${usbcfg.flags.join(',')}` : undefined}
        />
        <Tile label="IMEI" value={maskIdentifier(snapshot.imei)} hint={identity.revision ?? undefined} />
      </div>
    </section>
  )
}
