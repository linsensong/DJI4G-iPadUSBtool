const UDEV_RULE =
  'SUBSYSTEM=="usb", ATTR{idVendor}=="2ca3", ATTR{idProduct}=="4006", TAG+="uaccess"'

export default function IpadGuide() {
  return (
    <section className="card" id="ipad-guide" aria-labelledby="guide-title">
      <div className="card__header">
        <div>
          <p className="card__step">第 3 步</p>
          <h2 id="guide-title">插到 iPad 上网</h2>
        </div>
      </div>

      <ol className="guide-steps">
        <li>
          拔下模块，用 <strong>USB-C 对 USB-C 数据线</strong>接到 iPad Pro。只能充电的线不行。
        </li>
        <li>
          等 20–40 秒让模块开机并注册网络。指示灯绿色常亮或闪烁表示 SIM 已识别；红灯表示没插卡或没识别到卡。
        </li>
        <li>
          打开 iPad 的「设置」，左侧会出现「以太网」，点进去能看到名为「Baiwang」的网卡（名称以实际为准）。
          IPv4 保持「自动」，正常会拿到 <code>192.168.225.x</code> 的地址，路由器为{' '}
          <code>192.168.225.1</code>。
        </li>
        <li>关闭 Wi-Fi，用 Safari 打开任意网站，能打开就说明已经在走电信 4G 了。</li>
      </ol>

      <h3 className="guide-subtitle">常见问题</h3>
      <dl className="faq">
        <div>
          <dt>「设置」里没有「以太网」</dt>
          <dd>
            先换一根确认能传数据的线；再回到电脑上用本工具确认 USB 网卡模式是「1 · ECM」。若仍不出现，可能是供电不足，
            改用带 PD 充电口的 USB-C 扩展坞（模块和充电器都接扩展坞）。
          </dd>
        </div>
        <div>
          <dt>刚插上时有「以太网」但没有 IP，或是 169.254.x.x</dt>
          <dd>
            模块还没注册上网络：等 30 秒再看；确认 SIM 卡没欠费、已开通流量；若 APN 不对，回到电脑把 APN 设为
            <code>ctnet</code>（电信）。
          </dd>
        </div>
        <div data-testid="faq-sleep">
          <dt>已知问题：合盖或锁屏休眠后断网，要拔插才能恢复</dt>
          <dd>
            <p>
              现象：iPad 休眠再唤醒后，「以太网」仍然显示，但拿不到 IP（为空或 169.254.x.x），即使把 IP
              改成手动固定也上不了网，重新插拔模块后立即恢复。
            </p>
            <p>
              原因：iPad 休眠时会挂起 USB
              口，唤醒后它和模块之间的数据通路没能恢复（模块一直有电，没有重启）。模块固件不提供相关设置（
              <code>AT+QNETDEVCTL</code>、<code>AT+QMAP</code> 均不支持），iPadOS 也不允许 App
              重置 USB 设备，所以本工具无法修复。手动固定 IP 没有效果，建议保持「自动」。
            </p>
            <p>应对办法：</p>
            <ul>
              <li>
                使用期间不让 iPad
                休眠：「设置 → 显示与亮度」关闭「锁定/解锁」，合盖就不会锁屏；需要时把「自动锁定」设为「永不」。屏幕会一直亮着，比较耗电；按顶部按钮锁屏同样会触发这个问题。
              </li>
              <li>已经断网时，拔下 USB 线再插上，等模块重新开机（约 20–40 秒）即可恢复。</li>
              <li>
                需要经常合盖、长时间挂机时，改用支持 USB 4G 模块的随身路由器，让 iPad 通过 Wi-Fi 上网。iPad
                休眠唤醒后 Wi-Fi 能正常恢复，但模块可能需要切换为路由器支持的 USB 模式。
              </li>
            </ul>
          </dd>
        </div>
        <div>
          <dt>不想让 iPad 拿到 240e 开头的公网 IPv6 地址</dt>
          <dd>
            回到电脑，在第 2 步勾选「关闭 IPv6（仅 IPv4）」再执行配置。之后网卡里只有 IPv4 地址；fe80::
            开头的是 iPad 与模块之间的本地地址，不会出现在互联网上。可以用 Safari 打开 ipw.cn 确认已经没有 IPv6。
          </dd>
        </div>
        <div>
          <dt>想把模块装回无人机</dt>
          <dd>回到电脑，用上面的「恢复原始配置」写回首次连接时自动备份的设置。</dd>
        </div>
        <div>
          <dt>为什么 iPad 上不用（也不能）装 App？</dt>
          <dd>
            切换到 ECM 后，模块自己完成拨号，并像一台小路由器一样给 iPad 分配地址；iPadOS 自带 USB 以太网驱动，直接就能用。
            iPad 的浏览器不支持 WebUSB / Web Serial，原生 App 访问这类 USB 设备又需要苹果单独授权 DriverKit，
            所以一次性的配置放在电脑上完成。
          </dd>
        </div>
      </dl>

      <h3 className="guide-subtitle">电脑端连接说明</h3>
      <dl className="faq">
        <div>
          <dt>macOS</dt>
          <dd>
            用 Chrome 或 Edge，选「USB 直连」，在弹窗里选择模块（可能显示为 Baiwang 或 2ca3:4006）。如果正在运行 DJOneHub
            等管理工具，请先退出，否则接口会被占用。
          </dd>
        </div>
        <div>
          <dt>Windows</dt>
          <dd>
            先安装移远 Quectel USB 驱动，设备管理器里出现「Quectel USB AT Port (COMx)」后，选「串口」并在弹窗里选择这一项。
          </dd>
        </div>
        <div>
          <dt>Linux</dt>
          <dd>
            WebUSB 需要设备权限：把 <code>{UDEV_RULE}</code> 写入 <code>/etc/udev/rules.d/70-dji4g.rules</code>，执行{' '}
            <code>sudo udevadm control --reload &amp;&amp; sudo udevadm trigger</code> 后重新插拔模块。
          </dd>
        </div>
        <div>
          <dt>Android</dt>
          <dd>用 Chrome 通过 OTG 连接模块，选「USB 直连」即可。</dd>
        </div>
      </dl>
    </section>
  )
}
