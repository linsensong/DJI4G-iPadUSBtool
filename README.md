# DJI4G-iPadUSBtool · 大疆一代 4G 模块 iPad 上网助手

把大疆一代 4G 模块（DJI Cellular，USB `2ca3:4006`，设备名 Baiwang）切换为标准的 USB ECM 网卡，让 **Wi-Fi 版 iPad**
通过 USB-C 直接用 SIM 卡流量上网。iPad 上不需要安装任何 App；只需在电脑上用浏览器做一次配置。

## 原理

模块内部是移远 Cat.4 4G 模组（QDC507 / EG25-G 平台），出厂时 USB 网卡模式是 iPad 不认的 QMI。执行
`AT+QCFG="usbnet",1` 并重启后，它会以 CDC-ECM 以太网设备出现：模块自己拨号，并像小路由器一样给 iPad
分配 `192.168.225.x` 地址，iPadOS 自带驱动即可识别为「以太网」。

## 快速开始

需要先安装 [Node.js](https://nodejs.org/)（推荐 Node.js 24 LTS，版本至少 24.15.0；也支持 22.22.2 或更高的 22.x，以及 26 或更高版本）。

```bash
git clone https://github.com/linsensong/DJI4G-iPadUSBtool.git
cd DJI4G-iPadUSBtool
npm install
npm run dev
```

用**桌面版 Chrome 或 Edge** 打开 <http://localhost:5173>（必须是 localhost 或 https，否则浏览器会禁用 USB 访问）。

1. **连接模块**：模块插好 SIM 卡，用支持数据的 USB 线接到电脑。
   - macOS / Linux / Android：选「USB 直连」（WebUSB，免驱动）。macOS 请先退出 DJOneHub 等占用模块的程序。
   - Windows：先装移远 Quectel USB 驱动，选「串口」，在弹窗中选择 `Quectel USB AT Port (COMx)`。
   - Linux 使用 WebUSB 需要 udev 权限，规则见页面内说明。
2. **一键切换为 iPad 网卡模式**：工具会先自动备份原始配置，再按 SIM 卡运营商设置 APN（电信为 `ctnet`），
   切换到 ECM 并重启模块，等它重新连上后校验配置是否生效。
3. **插到 iPad**：用 USB-C 对 USB-C 数据线连接，打开「设置 → 以太网」即可看到网卡并上网。

需要把模块装回无人机或给其他程序使用时，用页面上的「恢复原始配置」写回备份。没有硬件也可以先用「演示模式」完整走一遍流程。

本工具只会写入 `usbnet` 和 APN（PDP 上下文 1）这两项，不会改动模块的 USB 身份（USBCFG）。AT 调试台中的危险指令需要二次确认，修改 IMEI 的指令会被直接拒绝。

## 开发

依赖使用最新稳定的兼容版本。TypeScript 暂使用 6.0 系列，因为当前 typescript-eslint 尚不支持 TypeScript 7。

```bash
npm test        # Vitest 单元测试与界面流程测试（使用模拟模块）
npm run lint
npm run build
```

| 目录 | 内容 |
| --- | --- |
| `src/modem/` | AT 指令通道、响应解析、配置计划、备份与重启校验流程 |
| `src/transports/` | WebUSB、Web Serial 连接，以及用于演示和测试的模拟模块 |
| `src/hooks/useModemSession.ts` | 连接、读取状态、执行计划、自动重连的会话状态 |
| `src/components/` | 页面各个面板 |

## 免责声明

- 本项目是个人开发的非官方工具，与大疆（DJI）、移远（Quectel）及任何运营商均无关联，也未获得其授权或认可。
  DJI 是深圳市大疆创新科技有限公司的商标，Quectel 是移远通信的商标，文中提及仅用于说明适用的硬件。
- 本工具会修改 4G 模块的 USB 网卡模式和 APN 配置。修改模块配置可能影响模块在无人机或其他设备上的正常使用，
  也可能影响保修；由此产生的任何风险和后果由使用者自行承担。使用前请确认已备份原始配置。
- 本工具不收集、不上传任何数据。读取到的 IMEI、IMSI、ICCID 等信息只在你的浏览器中显示，原始配置备份仅保存在本机浏览器存储
  和你自行下载的备份文件中。

## 作者与许可证

作者：Johnny Lin（[@linsensong](https://github.com/linsensong)）

本项目以 [MIT License](LICENSE) 开源，Copyright (c) 2026 Johnny Lin。
