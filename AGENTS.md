# AGENTS.md

给在本仓库工作的 AI 编程助手（Cursor、Codex 等）看的说明。用户文档见 `README.md`。

## 项目是什么

浏览器端工具：在电脑上用 Chrome / Edge 通过 WebUSB（macOS / Linux / Android）或 Web Serial（Windows）给大疆一代 4G 模块发 AT 指令，
把它切换成 CDC-ECM 网卡，让 Wi-Fi 版 iPad 通过 USB-C 直接用 SIM 卡流量上网。iPad 上不运行任何程序；没有后端，代码不联网上传任何数据。

- 模块：DJI Cellular 一代，USB `2ca3:4006`，设备名 Baiwang，内部是移远 EG25-G 平台模组。
- 核心操作：`AT+QCFG="usbnet",1`（ECM）、`AT+CGDCONT=1,"<IP|IPV4V6>","<APN>"`、`AT+CFUN=1,1`（重启生效）。
- 首次连接时自动备份原始配置到 localStorage（键 `dji4g.original-backup.<IMEI>`，第一次的备份不会被覆盖），可一键恢复。
  localStorage 按网址隔离，在线版和 localhost 的备份互相看不到。
- 在线版：<https://linsensong.github.io/DJI4G-iPadUSBtool/>。合并到 `main` 后由 `.github/workflows/deploy.yml` 检查、构建并发布到 GitHub Pages；
  `vite.config.ts` 的 `base` 是 `'./'`，这样产物放在子路径下也能加载，不要改成绝对路径。

## 代码结构

| 路径 | 内容 |
| --- | --- |
| `src/modem/at.ts` | `AtChannel`：串行化 AT 指令、去回显、识别最终结果码、转发 URC、超时与断线 |
| `src/modem/parse.ts` | 各类 AT 响应解析器 |
| `src/modem/status.ts` | `readSnapshot` 读取模块状态快照；`primaryContext` 取 PDP 上下文 1 |
| `src/modem/plan.ts` | 生成配置 / 恢复计划（`planIpadSetup`、`planRestore`），危险指令判定 `assessCommand` |
| `src/modem/workflow.ts` | 执行计划、等待模块重启后重连、读回校验（`applyPlan`、`waitForModule`、`verifyPlan`） |
| `src/modem/backup.ts` | 备份格式、校验与本地存储 |
| `src/transports/` | `webusb.ts`、`webserial.ts`，以及演示和测试用的模拟模块 `simulated.ts` |
| `src/hooks/useModemSession.ts` | 连接、状态、执行计划、自动重连的会话状态 |
| `src/components/` | 页面各面板；`IpadGuide.tsx` 是 iPad 使用说明和常见问题 |

## 必须遵守

- 工具只写 `usbnet` 和 PDP 上下文 1（APN、IP 类型）。不要加入改写 `AT+QCFG="usbcfg"`（USB 身份 / 接口组合）的功能，写错会让 AT 口消失、电脑再也连不上模块。
- 修改 IMEI 的指令（`AT+EGMR=1`）必须继续拦截；新增的危险指令要加进 `plan.ts` 的 `DANGEROUS_COMMANDS` 并补测试。
- 任何写入都要先有备份，执行后要读回校验；新增写入项时同步扩展 `SetupPlan.target` 和 `verifyPlan`。
- 界面文字、README 和注释说明用简体中文；README 里的免责声明和「作者与许可证」一节不要删。
- 不要引入后端、统计或任何联网上传；README 声明了「不收集、不上传任何数据」。
- JSX 里的中文长句换行时，断行要放在英文单词、代码或数字旁边，否则换行会在中文之间多出一个空格。

## 真机已确认的事实

- macOS 上的 Chrome 能通过 WebUSB 直连模块并收发 AT 指令。
- 模块切到 ECM 后，iPad 能识别为「以太网」，拿到 `192.168.225.x` 地址并正常上网。
- `AT+QNETDEVSTATUS?` 返回 `+QNETDEVSTATUS: 0,2,4,1` 和 `+QNETDEVSTATUS: 0,2,6,1`：按移远 EC2x/EG2x 手册，格式为
  `<上报开关>,<状态>,<IP 类型>,<实例>`，状态 2 表示数据连接已建立，4 / 6 分别是 IPv4 / IPv6。
- 这版大疆固件不支持 `AT+QNETDEVCTL`（自动拨号控制）和 `AT+QMAP`（路由 / DHCP 配置），都返回 `ERROR`。
- 已知问题：iPad 合盖或锁屏休眠再唤醒后，「以太网」仍在，但 IP 为空或 169.254.x.x，手动固定 IP 也上不了网，只有拔插模块才能恢复。
  推断是 iPad 挂起 USB 后数据通路没能恢复；固件和 iPadOS 都没有可用的修复手段，目前只在文档里给出应对办法。

## 尚未在真机上验证

- 完整的「恢复原始配置 → 一键切换 → 自动重连 → 校验」流程。
- 「关闭 IPv6（仅 IPv4）」选项（`AT+CGDCONT=1,"IP","ctnet"`）在电信卡上的效果。
- 模块重启后浏览器能否不弹窗自动重连（不行时页面会提示手动「重新连接模块」）。
- Windows 上的 Web Serial 连接。

## 开发与测试

```bash
npm ci
npm test        # Vitest，单元测试和基于模拟模块的界面流程测试
npm run lint
npm run build   # tsc -b && vite build
npm run dev     # http://localhost:5173
```

- `package.json` 的 `engines` 要求 Node `^22.22.2 || ^24.15.0 || >=26`；更低的 22.x 也能跑，`npm` 只会给出警告。
- 改动 `src/modem/` 或 `src/transports/` 时补对应的 `*.test.ts`；改动界面流程时补 `src/App.test.tsx`。
- 没有硬件时，用页面上的「演示模式」（`SimulatedModule`）手动验证界面；它模拟移远格式的回复和重启。

## Cursor Cloud specific instructions

- 云端虚拟机没有 USB，碰不到真实模块；只能用测试和演示模式验证，真机验证需要用户在自己的 Mac 上做。
- 本仓库没有提交 `.cursor/environment.json`（`.gitignore` 忽略了 `.cursor/`），新环境里先执行 `npm ci`。
- 浏览器验证可以用 `npm run build && npx vite preview --host --port 4173`，再用 Chrome 打开并进入演示模式。
- 通过分支和 PR 提交改动，不要直接推送或合并到 `main`。
