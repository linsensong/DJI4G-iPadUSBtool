import type { ConnectionState } from '../hooks/useModemSession'
import {
  PLATFORM_NAMES,
  recommendedConnection,
  type BrowserSupport,
} from '../lib/environment'
import type { ConnectionKind } from '../modem/workflow'

interface ConnectPanelProps {
  support: BrowserSupport
  connection: ConnectionState
  onConnect: (kind: ConnectionKind) => void
  onReconnect: () => void
  onDisconnect: () => void
}

interface MethodCard {
  kind: ConnectionKind
  title: string
  subtitle: string
  description: string
  available: boolean
  unavailableReason: string
}

const STATUS_TEXT: Record<ConnectionState['status'], string> = {
  idle: '未连接',
  connecting: '正在连接…',
  connected: '已连接',
  rebooting: '模块正在重启…',
  lost: '连接已断开',
}

export default function ConnectPanel({
  support,
  connection,
  onConnect,
  onReconnect,
  onDisconnect,
}: ConnectPanelProps) {
  const recommended = recommendedConnection(support.platform)
  const busy = connection.status === 'connecting' || connection.status === 'rebooting'
  const insecure = !support.secureContext

  const methods: MethodCard[] = [
    {
      kind: 'webusb',
      title: 'USB 直连',
      subtitle: 'WebUSB · 适合 macOS / Android / Linux',
      description: '浏览器直接访问模块的 AT 接口，无需安装驱动。',
      available: support.webUsb && !insecure,
      unavailableReason: insecure ? '需要 https 或 localhost' : '当前浏览器不支持 WebUSB',
    },
    {
      kind: 'webserial',
      title: '串口',
      subtitle: 'Web Serial · 适合 Windows',
      description: '先安装移远 USB 驱动，在弹窗里选「Quectel USB AT Port」。',
      available: support.webSerial && !insecure,
      unavailableReason: insecure ? '需要 https 或 localhost' : '当前浏览器不支持 Web Serial',
    },
    {
      kind: 'demo',
      title: '演示模式',
      subtitle: '无需硬件',
      description: '用模拟模块完整走一遍配置流程，熟悉每一步会发生什么。',
      available: true,
      unavailableReason: '',
    },
  ]

  return (
    <section className="card" aria-labelledby="connect-title">
      <div className="card__header">
        <div>
          <p className="card__step">第 1 步</p>
          <h2 id="connect-title">在电脑上连接模块</h2>
        </div>
        <span className={`pill pill--${connection.status}`} data-testid="connection-status">
          {STATUS_TEXT[connection.status]}
        </span>
      </div>

      <p className="card__lede">
        把插好 SIM 卡的模块用<strong>支持数据传输</strong>的 USB 线接到电脑，用桌面版 Chrome 或
        Edge 打开本页面。当前系统：{PLATFORM_NAMES[support.platform]}。
      </p>

      <div className="methods">
        {methods.map((method) => (
          <button
            key={method.kind}
            type="button"
            className={`method ${recommended === method.kind ? 'method--recommended' : ''}`}
            disabled={!method.available || busy}
            onClick={() => onConnect(method.kind)}
          >
            <span className="method__title">
              {method.title}
              {recommended === method.kind && <span className="method__badge">推荐</span>}
            </span>
            <span className="method__subtitle">{method.subtitle}</span>
            <span className="method__description">
              {method.available ? method.description : method.unavailableReason}
            </span>
          </button>
        ))}
      </div>

      {connection.description && connection.status === 'connected' && (
        <div className="connection-bar">
          <span className="connection-bar__dot" aria-hidden />
          <span className="connection-bar__text">{connection.description}</span>
          <button type="button" className="button button--ghost" onClick={onDisconnect}>
            断开
          </button>
        </div>
      )}

      {connection.status === 'lost' && (
        <div className="connection-bar connection-bar--lost">
          <span className="connection-bar__text">
            模块不在线。确认它仍插在电脑上（重启约需 30 秒），然后重新连接。
          </span>
          <button type="button" className="button" onClick={onReconnect}>
            重新连接模块
          </button>
        </div>
      )}

      {connection.error && (
        <p className="notice notice--error" role="alert">
          {connection.error}
        </p>
      )}
    </section>
  )
}
