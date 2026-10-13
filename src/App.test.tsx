import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from './App'
import type { SessionOptions } from './hooks/useModemSession'
import type { BrowserSupport } from './lib/environment'
import { createBackupStore } from './modem/backup'

const MAC: BrowserSupport = { platform: 'macos', webUsb: true, webSerial: true, secureContext: true }

function renderApp(options: Partial<SessionOptions> = {}, support: BrowserSupport = MAC) {
  return render(
    <App
      support={support}
      sessionOptions={{
        backupStore: createBackupStore(null),
        demoModuleOptions: { rebootDelayMs: 60 },
        reconnectIntervalMs: 15,
        reconnectTimeoutMs: 3000,
        ...options,
      }}
    />,
  )
}

async function connectDemo() {
  fireEvent.click(screen.getByRole('button', { name: /演示模式/ }))
  await waitFor(() => expect(screen.getByTestId('tile-usbnet')).toHaveTextContent('0 · QMI'))
}

describe('<App />', () => {
  it('recommends WebUSB on macOS and tells iPad users nothing needs installing', () => {
    const { unmount } = renderApp()
    expect(screen.getByRole('button', { name: /USB 直连/ })).toHaveTextContent('推荐')
    expect(screen.queryByTestId('env-notice')).not.toBeInTheDocument()
    unmount()

    renderApp({}, { platform: 'ipados', webUsb: false, webSerial: false, secureContext: true })
    expect(screen.getByTestId('env-notice')).toHaveTextContent('不需要安装任何程序')
    expect(screen.getByRole('button', { name: /USB 直连/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /演示模式/ })).toBeEnabled()
  })

  it('switches a factory module to iPad mode and restores it again', async () => {
    renderApp()
    await connectDemo()

    expect(screen.getByTestId('tile-sim')).toHaveTextContent('已就绪 · 中国电信')
    expect(screen.getByText(/推荐：设为「ctnet」/)).toBeInTheDocument()
    expect(screen.getByText(/原始配置已自动备份/)).toHaveTextContent('usbnet=0')
    expect(screen.getByText('AT+QCFG="usbnet",1')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /开始配置/ }))
    await waitFor(() => expect(screen.getByTestId('setup-success')).toBeInTheDocument(), {
      timeout: 4000,
    })
    expect(screen.getByTestId('tile-usbnet')).toHaveTextContent('1 · ECM')
    expect(screen.getByTestId('tile-apn')).toHaveTextContent('ctnet')
    expect(screen.getByTestId('connection-status')).toHaveTextContent('已连接')
    const setup = screen.getByRole('region', { name: /一键切换为 iPad 网卡模式/ })
    expect(setup).toHaveTextContent('模块当前已是 1 · ECM 模式')
    expect(within(setup).queryByRole('radio')).not.toBeInTheDocument()

    const restore = screen.getByRole('region', { name: /恢复原始配置/ })
    expect(within(restore).getByTestId('backup-summary')).toHaveTextContent('0 · QMI')
    fireEvent.click(within(restore).getByRole('button', { name: '恢复到备份配置' }))
    await waitFor(() => expect(within(restore).getByText(/已恢复/)).toBeInTheDocument(), {
      timeout: 4000,
    })
    expect(screen.getByTestId('tile-usbnet')).toHaveTextContent('0 · QMI')
    expect(screen.getByTestId('tile-apn')).toHaveTextContent('（空，由网络分配）')
  })

  it('asks for a manual reconnect when the module comes back too late', async () => {
    renderApp({
      demoModuleOptions: { rebootDelayMs: 300 },
      reconnectIntervalMs: 20,
      reconnectTimeoutMs: 80,
    })
    await connectDemo()

    fireEvent.click(screen.getByRole('button', { name: /开始配置/ }))
    const progress = await screen.findByTestId('operation-progress')
    const reconnect = await within(progress).findByRole('button', { name: '重新连接模块' }, { timeout: 2000 })
    expect(screen.getByTestId('connection-status')).toHaveTextContent('连接已断开')

    await new Promise((resolve) => setTimeout(resolve, 350))
    fireEvent.click(reconnect)
    await waitFor(() => expect(screen.getByTestId('setup-success')).toBeInTheDocument(), {
      timeout: 3000,
    })
  })

  it('reports that a configured module needs no further changes', async () => {
    renderApp({
      demoModuleOptions: { usbnet: 1, pdpContexts: [{ cid: 1, pdpType: 'IPV4V6', apn: 'ctnet' }] },
    })
    fireEvent.click(screen.getByRole('button', { name: /演示模式/ }))
    expect(await screen.findByTestId('already-ready')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /开始配置/ })).not.toBeInTheDocument()
  })

  it('turns IPv6 off on a configured module from the setup wizard', async () => {
    renderApp({
      demoModuleOptions: {
        usbnet: 1,
        pdpContexts: [{ cid: 1, pdpType: 'IPV4V6', apn: 'ctnet' }],
        rebootDelayMs: 60,
      },
    })
    fireEvent.click(screen.getByRole('button', { name: /演示模式/ }))
    expect(await screen.findByTestId('already-ready')).toBeInTheDocument()
    expect(screen.getByTestId('tile-apn')).toHaveTextContent('IPv4 + IPv6')

    const ipv4Only = screen.getByRole('checkbox', { name: /关闭 IPv6（仅 IPv4）/ })
    expect(ipv4Only).not.toBeChecked()
    fireEvent.click(ipv4Only)
    expect(screen.queryByTestId('already-ready')).not.toBeInTheDocument()
    expect(screen.getByText('AT+CGDCONT=1,"IP","ctnet"')).toBeInTheDocument()
    expect(screen.queryByText('AT+QCFG="usbnet",1')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /开始配置/ }))
    await waitFor(() => expect(screen.getByTestId('setup-success')).toBeInTheDocument(), {
      timeout: 4000,
    })
    expect(screen.getByTestId('setup-success')).toHaveTextContent('IPv6 已关闭')
    expect(screen.getByTestId('tile-apn')).toHaveTextContent('ctnet')
    expect(screen.getByTestId('tile-apn')).toHaveTextContent('仅 IPv4')
  })

  it('shows the IPv6 option as already off for an IPv4-only module', async () => {
    renderApp({
      demoModuleOptions: { usbnet: 1, pdpContexts: [{ cid: 1, pdpType: 'IP', apn: 'ctnet' }] },
    })
    fireEvent.click(screen.getByRole('button', { name: /演示模式/ }))
    expect(await screen.findByTestId('already-ready')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /关闭 IPv6/ })).toBeChecked()
  })

  it('shows the package version in the footer', () => {
    renderApp()
    expect(__APP_VERSION__).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/)
    expect(screen.getByTestId('app-version')).toHaveTextContent(`版本 v${__APP_VERSION__}`)
  })

  it('documents the sleep disconnect in the iPad guide', () => {
    renderApp()
    const faq = screen.getByTestId('faq-sleep')
    expect(faq).toHaveTextContent('休眠后断网')
    expect(faq).toHaveTextContent('锁定/解锁')
    expect(faq).toHaveTextContent('拔下 USB 线再插上')
  })

  it('guards dangerous commands in the AT console', async () => {
    renderApp()
    await connectDemo()
    const console = screen.getByRole('region', { name: 'AT 指令调试台' })
    const input = within(console).getByLabelText('AT 指令')

    fireEvent.change(input, { target: { value: 'AT+EGMR=1,7,"860000000000000"' } })
    fireEvent.click(within(console).getByRole('button', { name: '发送' }))
    expect(within(console).getByRole('alert')).toHaveTextContent('IMEI')

    fireEvent.change(input, { target: { value: 'AT+CFUN=4' } })
    fireEvent.click(within(console).getByRole('button', { name: '发送' }))
    expect(within(console).getByRole('alert')).toHaveTextContent('飞行模式')
    expect(within(console).getByTestId('console-log')).toHaveTextContent('指令与模块的回复会显示在这里')

    fireEvent.click(within(console).getByRole('button', { name: 'AT+CSQ' }))
    await waitFor(() =>
      expect(within(console).getByTestId('console-log')).toHaveTextContent('+CSQ: 24,99'),
    )
  })
})
