import { useState } from 'react'
import AtConsole from './components/AtConsole'
import ConnectPanel from './components/ConnectPanel'
import IpadGuide from './components/IpadGuide'
import RestorePanel from './components/RestorePanel'
import SetupWizard from './components/SetupWizard'
import StatusPanel from './components/StatusPanel'
import { useModemSession, type SessionOptions } from './hooks/useModemSession'
import { downloadText } from './lib/download'
import { detectSupport, type BrowserSupport } from './lib/environment'
import { backupFileName, serializeBackup } from './modem/backup'
import './App.css'

interface AppProps {
  sessionOptions?: SessionOptions
  support?: BrowserSupport
}

const FLOW = [
  { title: '电脑上连接模块', text: 'Chrome / Edge 通过 USB 读取模块状态' },
  { title: '切换为 ECM 网卡', text: '自动备份 → 设置 APN → 切换模式 → 重启校验' },
  { title: '插到 iPad 上网', text: '「设置 → 以太网」出现网卡即可上网' },
]

function EnvironmentNotice({ support }: { support: BrowserSupport }) {
  if (support.platform === 'ipados' || support.platform === 'ios') {
    return (
      <p className="notice notice--info" data-testid="env-notice">
        你正在 iPad / iPhone 上打开本页面。iPad 端<strong>不需要安装任何程序</strong>
        ：请先在电脑上完成第 1、2 步，然后按第 3 步把模块插到 iPad 上。
      </p>
    )
  }
  if (!support.secureContext) {
    return (
      <p className="notice notice--warn" data-testid="env-notice">
        当前页面不是安全上下文，浏览器会禁用 USB 和串口访问。请通过 <code>http://localhost:5173</code>{' '}
        或 https 地址打开本页面。
      </p>
    )
  }
  if (!support.webUsb && !support.webSerial) {
    return (
      <p className="notice notice--warn" data-testid="env-notice">
        当前浏览器不支持 WebUSB 和 Web Serial（Safari、Firefox 都不支持）。请改用桌面版 Chrome 或 Edge。
      </p>
    )
  }
  return null
}

export default function App({ sessionOptions, support: supportOverride }: AppProps) {
  const [support] = useState(() => supportOverride ?? detectSupport())
  const session = useModemSession(sessionOptions)
  const { connection, snapshot, originalBackup, operation } = session
  const connected = connection.status === 'connected'

  function downloadBackup() {
    if (originalBackup) {
      downloadText(backupFileName(originalBackup), serializeBackup(originalBackup))
    }
  }

  return (
    <div className="app">
      <header className="app__nav">
        <span className="app__brand">
          <span className="app__logo" aria-hidden>
            4G
          </span>
          <span>DJI 4G · iPad 上网助手</span>
        </span>
        <a className="app__link" href="#ipad-guide">
          iPad 使用说明 ↓
        </a>
      </header>

      <main className="app__main">
        <section className="hero">
          <p className="hero__eyebrow">大疆一代 4G 模块（2ca3:4006）→ iPad 以太网</p>
          <h1 className="hero__title">
            让 Wi-Fi 版 iPad 用上 <span className="hero__accent">4G</span>
          </h1>
          <p className="hero__lede">
            模块内部是移远 Cat.4 4G 模组，只是出厂的 USB 网卡模式 iPad 不认。本工具在电脑上把它一键切换为标准的
            ECM 网卡，之后插到 iPad 上就能直接用 SIM 卡流量上网，随时可以恢复原厂配置。
          </p>
          <ol className="flow">
            {FLOW.map((item, index) => (
              <li key={item.title} className="flow__item">
                <span className="flow__index">{index + 1}</span>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.text}</small>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <EnvironmentNotice support={support} />

        <ConnectPanel
          support={support}
          connection={connection}
          onConnect={(kind) => void session.connect(kind)}
          onReconnect={() => void session.reconnect()}
          onDisconnect={() => void session.disconnect()}
        />

        {snapshot && (
          <>
            <StatusPanel
              snapshot={snapshot}
              reading={session.reading}
              onRefresh={() => void session.refresh()}
            />
            <SetupWizard
              snapshot={snapshot}
              operation={operation}
              connected={connected}
              originalBackup={originalBackup}
              onRun={(plan) => void session.runPlan(plan)}
              onReconnect={() => void session.reconnect()}
              onDownloadBackup={downloadBackup}
            />
          </>
        )}

        <IpadGuide />

        {snapshot && (
          <>
            <RestorePanel
              snapshot={snapshot}
              operation={operation}
              connected={connected}
              originalBackup={originalBackup}
              onRun={(plan) => void session.runPlan(plan)}
              onReconnect={() => void session.reconnect()}
            />
            <AtConsole disabled={!connected} onSend={session.sendCommand} />
          </>
        )}
      </main>

      <footer className="app__footer">
        <p>
          非官方工具，与 DJI、Quectel 及运营商无关。修改模块配置前会自动备份，所有数据只保存在本机浏览器。
        </p>
        <p className="app__version" data-testid="app-version">
          版本 v{__APP_VERSION__}
        </p>
      </footer>
    </div>
  )
}
