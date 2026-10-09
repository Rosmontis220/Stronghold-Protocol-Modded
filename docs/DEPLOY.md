# 部署指南

目标：在一台家用 Windows 小主机上长期开服，让朋友通过局域网或公网来玩。macOS / Linux / Docker 放在后面。
所有命令都在项目根目录执行。遇到问题先运行 `node tools/doctor.mjs`（只读诊断）。

## 0. 资源需求

| 项目 | 说明 |
|---|---|
| 服务器 CPU | 战斗在各玩家浏览器里模拟（DESIGN §14），服务器只负责回合、经济和校验：**每个房间每个作战回合约 1 ms CPU**。AI 队友 / 掉线玩家的战场由服务器模拟：作战开始时 3 个 AI 战场在开发机上约 0.2–0.5 s CPU，小主机上可能要几秒（分成 8 ms 小片执行，不会卡住其他房间）。`SP_VERIFY=all` 会复算每个真人战场，CPU 明显增加，小主机建议保持 `off` 或 `sample`。 |
| 服务器内存 | 空闲约 100 MB，每个进行中的对局再增加几 MB。 |
| 网络 | 4 人对局中服务器每回合下行约 0.25 MB（DESIGN §14 实测）。首次进入游戏时浏览器要从主机下载所需的图片 / Spine 模型 / 音频（按需加载，之后走浏览器缓存），公网隧道带宽小时第一次会慢一些。 |
| 磁盘 | 素材约 550 MB（`public/assets`，含中文约 65 MB、日文约 85 MB 两套干员语音）+ 依赖约 125 MB（`node_modules`；整合包只带运行依赖，约 65 MB）；可选的本地提取约 40 MB（`.venv-extract`）+ 70 MB 贴图（见第 6 节）。完整包解压后约 710 MB。 |
| 玩家设备 | 支持 WebGL 的现代浏览器（Chrome / Edge / Firefox / Safari 最新版），电脑或手机平板（横屏）。老旧设备可在设置里调低画质或访问 `/?board=2d`。 |

服务器**无状态**：房间和对局只存在内存里，没有数据库和存档，**不需要备份**。重启服务器会结束正在进行的对局（包括断线后本可在 24 小时内回来继续的独立模拟）。

## 1. Windows 小主机：一步步

### 1.1 安装与首次启动

1. 安装 Node.js 22 LTS 和 Git（在 PowerShell 或「终端」里；用下面的完整包时不需要 Git）：
   ```powershell
   winget install OpenJS.NodeJS.LTS
   winget install Git.Git
   ```
   装完**关闭并重新打开**终端，`node -v` 应显示 v22 或更高（winget 的 LTS 目前是 v24.x，同样可用）。没有 winget 时从 <https://nodejs.org/zh-cn/download> 和 <https://git-scm.com/download/win> 下载安装。
2. 下载，三选一。建议放在一个固定、短、**不在 OneDrive 同步范围内**的目录，例如 `C:\Stronghold-Protocol`：
   - **完整包（推荐）**：在仓库的 [Releases](https://github.com/sganggs/Stronghold-Protocol/releases) 页面下载最新版本的 `Stronghold-Protocol-v<版本>.zip`（约 505 MB，解压后约 710 MB；已含运行依赖、前端库和全部素材，包括中文、日文两套干员语音和官方 3D 棋盘等本地客户端素材），解压后把里面的 `Stronghold-Protocol` 文件夹放到上述位置。不需要 Git，首次启动也不用再下载素材。素材版权归上海鹰角网络 / Yostar，仅限非商业使用，见 [NOTICE.md](../NOTICE.md)。
   - **精简包**：同一页面的 `Stronghold-Protocol-v<版本>-lite.zip`（约 22 MB）。代码、运行依赖和前端库与完整包相同，但不带素材：美术、Spine 模型、音频（含两套干员语音）、字体、表情和「玩法说明」教程图在首次启动时由 setup 从公开镜像下载（约 550 MB，显示进度，可中断续传；镜像设置见下面的「国内镜像下载」）。官方 3D 棋盘等本地客户端素材需要用本机客户端提取，或从同一版本的完整包复制（第 6 节）。适合下载大文件不方便、或想先下一个小包的情况；放置方式同完整包。
   - **源码**：
     ```powershell
     git clone https://github.com/sganggs/Stronghold-Protocol.git C:\Stronghold-Protocol
     ```
3. 双击 `C:\Stronghold-Protocol\scripts\start-windows.bat`。首次会：安装依赖（`npm ci`；整合包已含，跳过）→ 复制前端库（整合包已含，跳过）→ 下载约 550 MB 素材（完整包已含，跳过；精简包和源码在这一步下载，显示进度，中断后再次启动会续传）→ 若检测到本机的明日方舟客户端，询问是否提取官方贴图（可跳过）→ 启动服务器并打开浏览器。
4. 窗口里会打印朋友可用的地址，例如 `http://192.168.1.23:3000`。用另一台设备打开它确认能进入。关闭窗口即停止服务器。

等价的手动命令：`npm ci`、`node tools/setup.mjs`、`npm start`。

### 1.2 防火墙

- 第一次启动时 Windows 会弹出「Windows 安全中心警报」：勾选**专用网络**并点「允许访问」。
- 没弹窗或点错了，用**管理员** PowerShell 添加规则（下面的开机自启脚本也会自动添加）：
  ```powershell
  netsh advfirewall firewall add rule name="Stronghold Protocol" dir=in action=allow protocol=TCP localport=3000 profile=private,domain
  ```
- 家里的网络要是「公用网络」，Windows 会拦截入站连接。改成专用（管理员 PowerShell；网卡名用 `Get-NetConnectionProfile` 查看）：
  ```powershell
  Set-NetConnectionProfile -InterfaceAlias "以太网" -NetworkCategory Private
  ```
- `node tools/doctor.mjs` 会显示规则是否存在、每个网络的类型，以及朋友可用的地址。

### 1.3 固定局域网 IP（推荐）

主机 IP 变了，朋友收藏的地址就失效。推荐在**路由器**后台的「DHCP 静态分配 / 地址保留」里把小主机的 MAC 地址绑定到固定 IP（如 `192.168.1.50`）。也可以在 Windows「设置 → 网络和 Internet → 属性 → IP 分配 → 编辑」里手动设置（IP、子网掩码、网关、DNS 与路由器一致，且不要与别的设备冲突）。

### 1.4 开机自动在后台运行

先关闭 `start-windows.bat` 的窗口（否则端口冲突），然后在项目目录运行（会自动请求管理员权限）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-service-windows.ps1
```

它会：运行一次 `tools/setup.mjs` → 把设置写入 `scripts\service.env.cmd`（node.exe 路径、端口等）→ 注册计划任务 **StrongholdProtocol**（开机 20 秒后以 SYSTEM 身份运行 `scripts\run-server.cmd`，无需登录；服务器退出后 5 秒自动重启）→ 添加防火墙规则 → 立即启动并显示状态。日志在 `logs\server.log`（超过 10 MB 自动轮换）。

| 需求 | 命令（都加在 `powershell -ExecutionPolicy Bypass -File scripts\install-service-windows.ps1` 之后） |
|---|---|
| 换端口 / 其他设置 | `-Port 8080`、`-Verify sample`、`-Combat server`、`-BindHost 127.0.0.1`（只给反向代理用） |
| 公用网络也放行 | `-AllowPublicNetwork`（一般不需要；Tailscale 网卡被识别为公用网络时可能需要） |
| 查看状态和最近日志 | `-Status` |
| 重启（更新代码后） | `-Restart` |
| 停止 | `-Stop`（下次开机仍会自动启动） |
| 卸载 | `-Uninstall`（删除计划任务、防火墙规则和 `service.env.cmd`） |

建议同时关闭睡眠，否则小主机会在无人操作时休眠：`powercfg /change standby-timeout-ac 0`。

<details>
<summary>替代方案：用 NSSM 注册成真正的 Windows 服务</summary>

```powershell
winget install NSSM.NSSM            # 或从 https://nssm.cc 下载
nssm install StrongholdProtocol "C:\Program Files\nodejs\node.exe" server\index.js
nssm set StrongholdProtocol AppDirectory C:\Stronghold-Protocol
nssm set StrongholdProtocol AppEnvironmentExtra PORT=3000 HOST=::
nssm set StrongholdProtocol AppStdout C:\Stronghold-Protocol\logs\server.log
nssm set StrongholdProtocol AppStderr C:\Stronghold-Protocol\logs\server.log
nssm start StrongholdProtocol
```

防火墙规则仍需按 1.2 手动添加。两种方式只选一种。
</details>

### 1.5 更新

```powershell
cd C:\Stronghold-Protocol
powershell -ExecutionPolicy Bypass -File scripts\install-service-windows.ps1 -Stop   # 装了开机自启时
git checkout -- data/assets.json    # 素材清单由 setup 重新生成，先还原以免 git pull 冲突
git pull
npm ci
node tools/setup.mjs                # 补下载新增的素材（已有文件会跳过）
powershell -ExecutionPolicy Bypass -File scripts\install-service-windows.ps1 -Restart
```

没装开机自启的话，最后一步改成重新双击 `start-windows.bat`。用 Releases 完整包的：停止服务器，把新版本的完整包解压到新目录后从那里启动即可（素材已包含；装了开机自启的，在新目录重新运行一次 `install-service-windows.ps1`）。用 GitHub「Download ZIP」源码包的：解压新版本后，把旧目录里的 `public\assets`、`public\fonts`、`.cache` 和 `data\local-assets.json`（若有）复制过去，可避免重新下载。

## 2. 让不在同一网络的朋友加入

### 2.1 Tailscale / ZeroTier（推荐给家用小主机）

组一个虚拟局域网：不需要公网 IP、不需要改路由器、不暴露到互联网。

- **Tailscale**：主机和朋友都安装 <https://tailscale.com/download>（Windows：`winget install Tailscale.Tailscale`）并登录。朋友用自己的账号时，在 Tailscale 管理后台把这台主机「Share」给他们，或邀请他们加入你的 tailnet。朋友访问 `http://<主机的 100.x.y.z 地址>:3000`（`tailscale ip -4` 查看；开了 MagicDNS 也可以用 `http://<主机名>:3000`）。
- **ZeroTier**：在 <https://my.zerotier.com> 创建网络，主机和朋友安装客户端并加入同一个 Network ID，在后台勾选授权成员；访问 `http://<主机的 ZeroTier IP>:3000`。
- 连不上时运行 `node tools/doctor.mjs`：看 VPN 网卡是否被 Windows 识别为「公用网络」，是的话按 1.2 改为专用，或安装自启时加 `-AllowPublicNetwork`。

### 2.2 cloudflared 临时隧道（朋友什么都不用装）

```powershell
winget install --id Cloudflare.cloudflared      # macOS: brew install cloudflared
cloudflared tunnel --url http://localhost:3000
```

把输出的 `https://xxxx.trycloudflare.com` 发给朋友。页面是 https 时客户端自动改用 `wss://`，不需要任何配置；服务器会通过隧道转发的 `CF-Connecting-IP` 识别真实来源（`TRUST_PROXY=auto`）。临时隧道每次启动地址都不同，且没有可用性保证；需要固定地址请使用 Cloudflare 账号 + 自己域名的「命名隧道」。

### 2.3 路由器端口转发

仅当你有**公网 IPv4**（很多宽带是运营商级 NAT，没有公网 IP，此时请用 2.1 / 2.2）：

1. 先按 1.3 固定主机的局域网 IP。
2. 路由器「虚拟服务器 / 端口转发」：外部端口 3000（或任意端口）→ 内部 `主机IP:3000`，TCP。
3. 朋友访问 `http://<你的公网 IP>:外部端口`。

注意：游戏没有账号系统，知道地址的人都能进来。服务器对来自互联网的连接有按网络的数量限制（每个网络最多 64 个连接，房间 / 对局数量也有上限），但仍建议不玩时关掉转发，或优先用 Tailscale。

### 2.4 反向代理与 HTTPS（有域名时）

必须部署在**域名根路径**（客户端使用 `/data/`、`/vendor/`、`/ws` 等绝对路径，不支持挂在子路径下）。代理需要转发 WebSocket 升级（路径 `/ws`）。建议让服务器只监听本机：`HOST=127.0.0.1`（Windows 自启：`-BindHost 127.0.0.1`）。

**Caddy**（自动申请 HTTPS 证书，WebSocket 无需额外配置）：

```caddy
game.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

**Nginx**：

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
server {
    listen 443 ssl;
    server_name game.example.com;
    ssl_certificate     /etc/letsencrypt/live/game.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/game.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 1h;      # WebSocket 长连接
    }
}
```

https / wss 说明：页面通过 https 打开时客户端自动连接 `wss://同一域名/ws`；http 时用 `ws://`。服务器本身只提供 http，证书由代理 / 隧道负责。代理与服务器在同一台机器或内网时，`TRUST_PROXY=auto` 会信任它的 `X-Forwarded-For` / `X-Real-IP`；代理在公网另一台机器上时设 `TRUST_PROXY=1`（同时确保游戏端口只对代理开放）。

## 3. Docker

```bash
# A) 构建时下载素材（需要联网，约 550 MB）
docker build -t stronghold-protocol --build-arg FETCH_ASSETS=1 .
docker run -d --name stronghold -p 3000:3000 --restart unless-stopped stronghold-protocol

# B) 不把素材打进镜像：先在宿主机运行 node tools/setup.mjs，然后挂载
docker build -t stronghold-protocol .
docker run -d --name stronghold -p 3000:3000 --restart unless-stopped \
  -v "$PWD/public/assets:/app/public/assets:ro" stronghold-protocol
```

镜像基于 `node:22-alpine`，多阶段构建，只含生产依赖；`public/vendor` 在构建时生成。`.dockerignore` 排除了 `public/assets`（不会把宿主机素材打进构建上下文）；`public/fonts`、`data/assets.json` 和 `data/local-assets.json` 若存在会被复制进去。环境变量同 README（`-e SP_VERIFY=sample` 等）。健康检查：`GET /healthz`。

docker compose 示例：

```yaml
services:
  stronghold:
    build:
      context: .
      args: { FETCH_ASSETS: "1" }
    ports: ["3000:3000"]
    restart: unless-stopped
    environment:
      SP_VERIFY: "off"
```

## 4. macOS / Linux 常驻

- 临时开服：`scripts/start.sh`（或 `npm start`），保持终端窗口打开。macOS 首次会询问是否允许 node 接受传入连接，选「允许」。
- Linux systemd（`/etc/systemd/system/stronghold.service`，路径与用户按实际修改）：

  ```ini
  [Unit]
  Description=Stronghold Protocol game server
  After=network-online.target
  Wants=network-online.target

  [Service]
  WorkingDirectory=/opt/Stronghold-Protocol
  ExecStart=/usr/bin/node server/index.js
  Environment=PORT=3000 HOST=::
  Restart=always
  RestartSec=5
  User=stronghold

  [Install]
  WantedBy=multi-user.target
  ```

  `sudo systemctl daemon-reload && sudo systemctl enable --now stronghold`；日志 `journalctl -u stronghold -f`；防火墙 `sudo ufw allow 3000/tcp`。

## 5. 排错

| 现象 | 处理 |
|---|---|
| 任何问题 | `node tools/doctor.mjs`：Node 版本、依赖、素材完整性、端口、局域网地址、防火墙、网络类型 |
| `端口已被占用 / EADDRINUSE` | 已经有一个服务器在运行（自启任务？）或其他程序占用 3000：换端口 `scripts\start-windows.bat --port 3001` |
| 朋友打不开页面 | 防火墙规则 / 网络类型（1.2）；确认用的是 `LAN` 地址而不是 `localhost`；访客 Wi-Fi 常开启「AP 隔离」；不在同一网络请看第 2 节 |
| 画面是占位图、没有声音 | 素材没下完：重新运行 `node tools/setup.mjs`（会续传）；缺失明细在 `.cache/assets-report.json`。GitHub 原始地址访问失败时会自动改用 jsDelivr 镜像 |
| 素材下载很慢 / 失败 | 网络问题可随时中断，重新运行会跳过已完成的文件；`node tools/fetch-assets.mjs --concurrency=4` 降低并发。有文件没下载成功时，素材清单 `data/assets.json` 保持不变（脚本列出缺少的条目并以非零状态结束；游戏里缺的图片用占位图，缺的声音不播放），重新运行即可补齐 |
| 表情显示成默认图标、「玩法说明」只有文字要点 | 素材没下载完整：重新运行 `node tools/setup.mjs`（表情和教程图随其他素材一起从公开镜像下载，不需要客户端）；缺失明细在 `.cache/assets-report.json` |
| 本地提取失败 | 游戏照常运行，只是第 6 节表格里的几样换成替代样式。确认客户端已下载全部资源；Python 版本太新导致依赖安装失败时，安装 Python 3.12 后删除 `.venv-extract` 再运行 `node tools/setup.mjs --local` |
| 3D 棋盘没出现 | 需要本地提取的棋盘贴图（`node tools/doctor.mjs` 会显示「3D 棋盘可用」），以及支持 WebGL2 的浏览器。没有客户端的服务器可以从同一版本的整合包复制本地素材（第 6 节） |
| 断线 | 同盟模拟 10 分钟内、独立模拟 24 小时内（`config.constants.singleReconnectTime`）用同一浏览器重新打开页面，自动回到原座位。同盟掉线期间按原阵容自动作战、到时自动准备（不会代为购买；想让 AI 代打请用「离开模拟 → 暂离（AI 托管）」）；独立模拟不计时，等你回来 |
| 公告没出现 | 见第 7 节：`node scripts/notice.mjs --show` 看文件是否有效，`journalctl -u stronghold \| grep '\[notice\]'` 看服务器有没有读到；**已装的 exe/apk 要重新打包**才能显示 |

## 6. 本地客户端素材（可选）

`public/assets/local/` 和 `data/local-assets.json` 是从本机安装的《明日方舟》客户端里提取的官方素材（`tools/local-extract`，DESIGN §13）：`node tools/setup.mjs` 检测到客户端时会询问是否提取，之后可以用 `node tools/setup.mjs --local` 重新提取，或用 `--game "<…/StreamingAssets/AB/Windows>"` 指定客户端目录。setup 从公开镜像下载的素材不包含这部分，所以在没有客户端的电脑上（例如 Linux 服务器）从源码部署时不会有它；Releases 的完整包里已经带上了。

没有本地素材时游戏照常运行，只是下面几样换成替代样式：

| 内容 | 没有本地素材时 |
|---|---|
| 官方 3D 棋盘（贴图、模型、地图特效） | 2D 棋盘，地块由程序绘制 |
| 部分官方界面图标与底板：交流按钮和表情面板的边框、暂停面板、装备替换窗口、干员调配界面、队友状态与漏怪标记、模组类型图标等 | 样式相近的替代图形、图标或文字 |
| 灼热 / 炽焰源石虫的官方模型 | 染成橙色 / 红橙色的普通源石虫 |

表情（6 套 × 6 个）和「玩法说明」的 19 页教程图公开镜像也有：`node tools/setup.mjs` 会和其他素材一起下载（约 21 MB），不需要客户端；有本地素材时优先显示本地的。

**没有客户端的服务器**想要上表中的官方素材：从**同一版本**的完整包（[Releases](https://github.com/sganggs/Stronghold-Protocol/releases)）里，把 `public/assets/local/` 文件夹和 `data/local-assets.json` 复制到服务器项目目录下的相同位置。服务器每次请求都会重新读取这两处，不必重启，玩家刷新页面即可。一定要用与服务器代码相同版本的完整包：各版本提取的内容和清单可能不同（例如灼热 / 炽焰源石虫的模型是 0.1.0 之后才加入的），混用其他版本的文件会缺图或用错图。复制后 `node tools/doctor.mjs` 会显示本地素材的条目数和「3D 棋盘可用」。

## 7. 服务器公告（游戏内）

服务端有一个**公告板**（`server/notice.js`）：每 10 秒检查一个文件，文件一变就把公告广播给所有在线 socket。客户端（`public/js/ui/noticeBanner.js`）在**任何界面**顶部显示一条胶囊，**标题页也显示**——玩家还没进大厅就能看到"服务器要维护了"。撤回时广播 `text: null`，横幅消失。玩家可以点掉（只对他这个浏览器隐藏，记的是**文本**：改动文本 = 新公告，会重新显示）。

**发公告不需要重启**，这正是它存在的意义（要重启就得先能通知玩家）。重启会结束正在进行的对局（第 0 节），所以维护前请这样用：

```bash
cd ~/webUI/Stronghold-Protocol

node scripts/notice.mjs "服务器将于 23:30 维护重启，预计 5 分钟"          # info（青绿色）
node scripts/notice.mjs --kind maintenance "23:30 维护重启，约 5 分钟"    # 维护（琥珀色 + ⏳）
node scripts/notice.mjs --kind update "已更新到 v0.1.1"                  # 更新
node scripts/notice.mjs --kind emergency "服务器异常，正在抢修"           # 紧急（红色）
node scripts/notice.mjs --for 30m "30 分钟后维护重启"                     # 到点自动撤回
node scripts/notice.mjs --show                                          # 现在播的是什么
node scripts/notice.mjs --clear                                         # 手动撤回
```

默认写 `<仓库>/.deploy/notice.json`（`SP_NOTICE_FILE` 可改；该文件在仓库外，`git pull` 不会和它冲突）：

```json
{ "text": "服务器将于 23:30 维护重启，预计 5 分钟", "kind": "maintenance", "until": "2026-10-03T15:40:00Z" }
```

直接写纯文本也行（当成 `info`），`echo 维护 > .deploy/notice.json` 就可以。文本会压成一行、超过 200 字截断。

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `SP_NOTICE_FILE` | `<仓库>/.deploy/notice.json` | 公告文件路径 |
| `SP_NOTICE_POLL_SEC` | `10` | 轮询间隔（秒） |
| `SP_NOTICE` | 未设 | `off` 完全关闭公告（不读文件、不发送） |

注意：**已装的 exe / apk 需要重新打包**才会显示公告（客户端把 `public/**` 打进安装包；未知的 S2C 类型会被安静忽略）。网页端由服务器直接提供，改完刷新即生效。平台（www.starst.site）另有一套房间聊天公告（`POST /api/admin/system-messages`），与游戏内公告互不影响。

维护前建议这样用（这条公告会一直留着，直到 `--clear` 或 `--for` 到期）：挑空窗、发公告、等一下、再重启。重启会结束正在进行的对局（第 0 节）：客户端会自动重连，但那是**新会话**，正在打的那一局就没了。

自动发版（自己服务器上装 git 钩子或 systemd 定时器）可以用同一套：重启前自动发一条 `maintenance` 公告并等一会儿，重启校验通过后再自动撤下——那些脚本属于部署环境，不放在本仓库里。

## 8. 操作台（网页）

不想 SSH 的时候用网页操作台：**`https://<域名>/admin.html`**（`public/admin.html` + `public/js/admin.js` + `public/css/admin.css`，与游戏客户端彼此独立，不加载游戏外壳）。入口口令用 **SHA-256 摘要**校验：页面用 WebCrypto 把输入算成摘要再发出去，**明文既不离开浏览器也不在仓库里**；摘要写在 `server/admin.js` 的 `PASSWORD_SHA256`，换口令就换这一行的值（`node -e "console.log(require('crypto').createHash('sha256').update('新口令').digest('hex'))"`）。登录成功后拿一个内存里的 bearer token（`x-admin-token` 头，12 小时有效，**重启服务器即全部失效**）；同一 IP 十分钟内错 8 次会被拒（`429`）。

界面提供：

| 功能 | 接口 | 说明 |
|---|---|---|
| 发布 / 撤回公告 | `POST /api/admin/notice` | 写的就是 `.deploy/notice.json`（第 7 节），写完立即让运行中的公告板刷新，玩家 10 秒内看到 |
| 服务器状态 | `GET /api/admin/overview` | 进行中的对局数、房间数、在线人数、当前公告 |
| 旁观对局 | `GET /api/admin/room?code=XXXX` | 每个房间的实时视图：阶段 / 回合 / 每位博士的生命值、资金、就绪与掉线状态；面板每 2 秒刷新（只读，不加入房间） |

安全边界：`/api/admin/*` 全部要求 token（除 `login`），请求体上限 64 KB；`admin.html` 同样带 `noindex`，且 `robots.txt` 全站 `Disallow`（第 4 节）。操作台**只是调用同一套公告文件与只读视图**，不改变游戏协议。

## 9. 预下载：获取方式选择与本地素材导入

浏览器第一次进站会先经 `/data/resource-manifest.json` 校对本地素材（第 6 节）。资源完整时直接进入游戏；确认缺失后启动页显示**获取方式选择页**（`public/js/boot.js` + `public/index.html` 的 `#boot-choice`）：「预下载全部资源（推荐）」按完整清单一次下载并校验（进度、失败重试同原下载流程），「跳过，边玩边下载」不下载、立刻进入游戏。选择存 `localStorage`（`sp.pref.download`，`public/js/preload.js` 的 `DOWNLOAD_PREF_KEY`：`'predownload'` 或 `'stream'`），下次启动不再询问——选了预下载的照旧完整下载，选了边玩边下载的直接启动。边玩边下载的实现：页面给 Service Worker 发 `ACTIVATE_INDEX`（`public/sw.js`），Worker 把同一份完整索引写进活动记录（`ACTIVE_KEY` / 客户端键）并清理旧快照对象，**不下载**；之后游戏请求的每个资源（`/data`、`/assets`、`/fonts`、`/media`）都被 fetch 处理器拦下，按需下载、按 SHA-256 校验后写进同一份 `sp-resource-objects-v2` 缓存——玩过的文件下次进站校验时直接命中，完整快照攒齐后选择页也不再出现。选了边玩边下载的玩家随时可在「设置 → 资源预下载」（`public/js/ui/settings.js` 的 `PredownloadSection`，方案B）就地补下完整资源（带进度行），成功后把选择改回预下载。已预下载的文件被检测到时跳过选择页直接校验；清掉 `sp.pref.download`（或边玩边下载启动失败时的重试按钮）会重新询问。

**本地素材导入**（`public/js/local-import.js`）：没有网络或想省流量时，可用「选择本地素材文件夹」指向自己那份发布目录（项目根，含 `public/` 与 `data/`；指向 `public/`、`public/assets` 或资源树的任意一层也能识别）。页面逐个文件按**大小 + SHA-256** 校验后写进 Worker 用的同一份 `sp-resource-objects-v2` 缓存，因此运行时读取路径不变，剩下的缺失项才走网络。Chromium 会把目录句柄记在 IndexedDB：下次进站权限仍在就自动导入（缓存为空时尤其有用），权限失效时给一键「继续使用上次的文件夹」（浏览器要求一次点击授权）；Firefox/Safari 无 File System Access，退化为 `<input type="file" webkitdirectory>`（同样校验入缓存，但不能记忆目录）。关掉音频时启动音乐不再尝试播放，启动页显示「音乐未选择下载」；关掉教程页时「玩法说明」走文字要点回退。

## 10. 打包发布（维护者）

Releases 的 zip（完整包、精简包，0.2.1 起还有更新包）由 `tools/package.mjs` 生成，在**源码仓库**里运行（整合包里没有这个工具）：

```bash
npm run package -- --dry-run --list   # 只检查：列出每个文件和大小，不写任何文件（精简包加 --lite）
npm run package -- --out <目录>        # 完整包 Stronghold-Protocol-v<版本>.zip
npm run package:lite -- --out <目录>   # 精简包 Stronghold-Protocol-v<版本>-lite.zip
npm run package -- --update --from <旧版本的完整包>[,<…>] --out <目录>   # 更新包 Stronghold-Protocol-v<版本>-update.zip
```

- **打进去的**：`git ls-files` 里的 `server/`、`shared/`、`data/`、`public/`（不含 `public/dev/`）、`packs/`（随仓库提交的内容包；只在本机安装、没提交的不打进去）、启动脚本、玩家会运行的工具（setup、vendor、fetch-assets 与 `tools/assets/`、doctor，以及 setup 调用的 `tools/local-extract/` 和 `crop-board-atlas.mjs`）、服务器和 fetch-assets 读取的 4 张研究数据表（`docs/research/` 的 `03-operators`、`05-enemies`、`05-maps`、`07-assets` 四个 JSON）、`package.json` / `package-lock.json`、许可证与说明（`LICENSE`、`NOTICE.md`、`THIRD-PARTY-NOTICES.md`、`README.md`、`CHANGELOG.md`）、`docs/PLAYING.md` 和本文；然后在临时目录里生成 `packs/index.json`（打进去的语言包和内容包的列表，供纯静态托管使用；服务器自己会实时列出，见 [PACKS.md](PACKS.md)），再 `npm ci --omit=dev` 装上运行依赖和 `public/vendor`。完整包再加上 `data/assets.json` 列出的素材、`public/fonts`，以及本地提取的 `public/assets/local/` 和 `data/local-assets.json`。磁盘上有、清单却没列出的文件不打进去（例如 0.2.0 移出自选的焰狐龙梓兰的旧素材）。日文干员语音（`audio.voiceJp`，`public/assets/audio/voice/jp/` 的 2674 个文件，约 85 MB，zip 后约 76 MB）默认也打进完整包；`tools/package.mjs` 里的开关 `FULL_ZIP_JP_VOICE` 改成 `false` 时，完整包（以及由它比较出的更新包）不带这些文件：玩家首次启动时 setup 会像精简包那样下载它们，下载完成前选「日本語」会播中文语音，更新包也不会删除玩家已有的日文语音。
- **不打进去的**：`test/`、维护用的工具（数据构建、golden、botbench、i18n、导入检查、本工具等）、`scripts/make-windows-bundle.mjs`（Windows 便携包，见 [WINDOWS.md](WINDOWS.md)）、其他文档、研究笔记和 `docs/img/`、`handoff/`、`.github/`、`types/`、lint / 编辑器 / Docker 配置。和 0.1.x 的整树打包（全部跟踪文件加上 `public/assets` 的全部内容）相比，0.2.0 的完整包少了约 640 个文件、解压后小约 26 MB，zip 小约 8 MB。
- **打包前的检查**（`--dry-run` 也全部做一遍）：拒绝名单（`pv`、`review`、`.cache`、`.claude`、`.git`、`logs`、`.env`、`scripts/service.env.cmd`、`handoff`、`test` 等）；每个打进去的模块的相对导入、玩家用的 npm 脚本（start / setup / doctor / launch / postinstall / vendor / assets）都指向包里的文件；完整包里 `data/assets.json` 和 `data/local-assets.json` 列出的文件都在（缺了先运行 `node tools/fetch-assets.mjs`）；没有只差大小写的两个路径；包里的文件（二进制素材也查）不含个人目录路径（`/Users/…`、`C:\Users\…`、`/home/…`）或本机的账户名（运行时从系统读取；`SP_PACKAGE_SCAN_NAMES=a,b` 可以再加名字）；打进去的已跟踪文件没有未提交的改动（重新生成的 `data/assets.json` 要先提交）。有任何问题都会列出原因、以非零状态结束，不写 zip；正式打包时还会核对临时目录里的文件和计划完全一致。
- **MANIFEST.json**：三种包的根目录都有（`npm ci` 之后写入）：除素材（`public/assets/`、`public/fonts/`、`data/assets.json`、`data/local-assets.json`，归 setup 管）以外每个文件的大小和 sha256，同一版本的三种包内容相同。`npm run doctor` 和更新包的启动检查（`server/update.js`）用它核对安装。
- **更新包**（0.2.1 起，每个版本都发）：`--from` 后面列出**之前每个 0.2.x 版本的完整包**（Releases 上的 zip，或它解压出来、没动过的文件夹；逗号分隔或写多个 `--from`），例如发布 0.2.2 时 `--from Stronghold-Protocol-v0.2.0.zip,Stronghold-Protocol-v0.2.1.zip`。工具照常构建完整包的临时目录（`npm ci` 等），逐个文件（大小 + sha256）和每个旧版本比较：和任何一个旧版本不同、或旧版本没有的文件都打进去，所以一个更新包能覆盖在列出的每个版本上；旧版本有、新版本没有的文件记进 `UPDATE.json` 的 `removed`（连同各旧版本里的 sha256，玩家那边只删内容一致的文件；只差大小写的同名文件和 `.env` 之类的本机文件名不删，摘要里会列出）。旧版本必须比当前版本旧、带素材（不能是精简包或更新包）、每个版本只给一次，`--dry-run` 只读取并检查旧版本。更新包里还有新版本的 `MANIFEST.json` 和 `UPDATE.json`（适用的旧版本、文件数、字节数、文件列表和 `removed`），同样经过拒绝名单和个人信息检查；摘要列出和每个旧版本相比改动 / 新增 / 删除的文件数和更新包里各类文件的数量。发布时在 Releases 说明里写明更新包适用的版本（即 `--from` 列出的版本）。`--keep-stage` 保留更新包目录和完整包的临时目录（`<目录>/Stronghold-Protocol-v<版本>-update/` 里的 `Stronghold-Protocol/` 和 `.full/`）。
- **需要**：已下载素材的仓库（完整包）——打包前先联网运行一次 `node tools/fetch-assets.mjs`，补齐清单计划但本机还没有的素材（清单只列出磁盘上有的文件，打包工具看不出缺了哪些；`data/assets.json` 有变化就先提交）；能访问 npm 的网络（`npm ci`）；`zip`（或 bsdtar 的 `tar`，Windows 10 起自带）；更新包还要之前各版本的完整包（工具自己读 zip，不需要 `unzip`；Releases 上可以重新下载）。`--out` 默认是系统临时目录下的 `stronghold-protocol-release`，不能在仓库里面；`--force` 覆盖已有的 zip，`--keep-stage` 保留打包用的目录供检查。
