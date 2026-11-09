# PairDrop-cfw

[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue.svg)](LICENSE)
[![Platform: Cloudflare Workers](https://img.shields.io/badge/platform-Cloudflare%20Workers-F38020.svg)](https://workers.cloudflare.com/)
[![Durable Objects](https://img.shields.io/badge/state-Durable%20Objects-F38020.svg)](https://developers.cloudflare.com/durable-objects/)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933.svg)](https://nodejs.org/)

[PairDrop](https://github.com/schlagmichdoch/PairDrop) 信令层的 Cloudflare Workers + Durable Objects 移植：**同一套前端、同一套信令协议**，把 Node.js 长驻进程换成单 Durable Object，零服务器、免费档可长期运行。

## 在线示例

- 演示站点：<https://pairdrop-cfw.xiyin-chen2003.workers.dev>
- 两台设备分别打开该地址 → 同网段自动互见；跨网用「房间号」或「配对码」→ 需中继时自动走 Cloudflare TURN

> 演示站是个人免费档实例，可能随时调整或关闭，请勿用作生产服务。

## 特性

| 项 | 说明 |
|---|---|
| 协议 | client→server 24/24 分支、server→client 16/16 下发类型，与上游逐条对齐，0 缺失 0 多余 |
| 近场 | 同公网 IP 自动进入 IP 房（`roomType=ip`） |
| 远程 | 5 位房间号（`public-id`）、二维码/6 位配对码（`pair-device`）、URL 房间密钥（`secret`） |
| 中继 | 可选 Cloudflare Realtime TURN，动态短时凭据，Durable Object 内缓存 6 小时 |
| 部署 | 单 Worker + 单 DO，无数据库、无容器、无常驻进程 |
| 费用 | Workers Free 档可跑：10 万请求/天、静态资源不计请求、TURN 出向 1000 GB/月 |

## 项目依赖

| 依赖 | 版本/条件 | 必需 | 用途 |
|---|---|---|---|
| Cloudflare 账号 | 免费档即可 | 是 | Workers + Durable Objects（SQLite 后端，免费档唯一可选） |
| Node.js | ≥ 20（本地实测 26.13.0） | 是 | 运行 `wrangler`；Android/Termux 需同版本 `libicu` |
| wrangler | ^4（本地实测 4.158.0） | 是 | 打包、部署、写 secret |
| python3 | ≥ 3.8 | 否 | 仅 `scripts/patch-workerd.sh` 用（Android 打桩） |
| Cloudflare TURN key | 免费 | 否 | 跨网直连失败时的中继；不配置则只下发 STUN |
| 域名 | 任意 | 否 | 默认用 `*.workers.dev`；生产建议绑自有域名 |

运行时不引入任何 npm 依赖：`src/` 只用 Workers 运行时 API，`public/` 为上游静态资源原样托管。

## 快速部署

```bash
# 1. 取代码
git clone https://github.com/Xiyinnnnnn/PairDrop-cfw.git && cd PairDrop-cfw

# 2. 装依赖（一次性）
npm install

# 3. 登录 Cloudflare（或直接用环境变量令牌，见下）
npx wrangler login

# 4. 部署
npx wrangler deploy
#    → https://<worker-name>.<你的子域>.workers.dev

# 5. 冒烟（可选，需要 node ≥ 20）
BASE=wss://<你的worker域名>/server EXPECT_FALLBACK=false node scripts/e2e.mjs
```

### 用 API 令牌部署（无浏览器环境）

```bash
export CLOUDFLARE_API_TOKEN=xxx      # 需 Workers Scripts:Edit、Durable Objects:Edit
export CLOUDFLARE_ACCOUNT_ID=yyy
npx wrangler deploy
```

### 接入 Cloudflare TURN（可选）

```bash
# 建 key：secret 只在创建响应里返回一次，务必留存
curl -s -X POST -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" -d '{"name":"pairdrop-cfw"}' \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/calls/turn_keys"

npx wrangler secret put CF_TURN_KEY_ID          # 上面返回的 uid
npx wrangler secret put CF_TURN_KEY_API_TOKEN   # 上面返回的 secret（不是账号令牌）
```

配置后 Worker 会在每次连接时下发动态 `iceServers`（含 `turn.cloudflare.com`），凭据缓存 6 小时、按 12 小时 TTL 申请，无需 cron。

### Android / Termux 部署

```bash
pkg install -y nodejs libicu     # node 需要与 libicu 大版本匹配，否则 CANNOT LINK
npm install
bash scripts/patch-workerd.sh    # workerd 无 Android 二进制，打桩后 deploy 可用
bash scripts/deploy.sh           # 读 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID
```

`wrangler dev` 在 Android 上不可用（需要真实 workerd 二进制），本地只用 `--dry-run` 校验打包。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `WS_FALLBACK` | `false` | `true` 时服务器中继文本/文件（非 WebRTC 场景）；不影响 `signal` 与 `display-name-changed` |
| `CF_TURN_KEY_ID` | 未设 | TURN key uid；与下一项同时设置才启用 |
| `CF_TURN_KEY_API_TOKEN` | 未设 | TURN key 的 secret |
| `RTC_CONFIG_JSON` | 未设 | 静态 iceServers 兜底，如自建 coturn |

## 与上游的差异

| 项 | 上游 | 本移植 |
|---|---|---|
| 运行时 | Node.js 常驻进程 + `ws` 库 | Worker + 单 Durable Object |
| 心跳 | `setInterval` 每秒巡检 | DO `alarm` 每 60 秒巡检，3 分钟无心跳剔除 |
| 内存态 | 进程内存 | `serializeAttachment` 存每连接状态，休眠唤醒后静默重建房间表 |
| 哈希 | SHA3-512 | HMAC-SHA256 + 持久化 pepper（Workers 无 SHA3） |
| 静态资源 | express 托管 | Workers Assets，`run_worker_first` 只拦 `/server` `/ip` `/config` |
| `display-name-changed` | 在 `wsFallback` 闸门内，默认丢弃 | **无条件转发**，使自定义设备名实时同步（本移植唯一有意差异） |

## 目录结构

| 路径 | 行数 | 职责 |
|---|---|---|
| `src/index.js` | 44 | Worker 入口：`/server`→DO，`/ip`、`/config`，其余走 Assets |
| `src/signaling.js` | 538 | DO 信令状态机：房间、配对密钥、公网房间、心跳、休眠 |
| `src/peer.js` | 187 | Peer：身份校验、IP 判定、设备名、序列化 |
| `src/turn.js` | 58 | TURN 动态凭据 + DO storage 缓存 |
| `src/helper.js` | 50 | 随机串、cyrb53、加盐哈希 |
| `src/ua.js` | 67 | 轻量 UA 解析 |
| `src/names.js` | 27 | 确定性设备名 |
| `public/` | — | 上游前端原样托管（PWA、service worker、语言包） |
| `scripts/` | — | 部署、Android 打桩、端到端测试 |

## 测试

```bash
# 核心信令：开房 → 配对 → signal 中继 → 断线广播 → 非法报文
node scripts/e2e.mjs

# 全功能：近场 IP 房 / 公网房间号 / 配对码 / 改名同步 / 换密钥 / 删房 / 心跳
node scripts/e2e-full.mjs
```

两个脚本都用 Node 内置 `WebSocket`，无需额外依赖；`BASE` 环境变量指向任意部署实例。

## 已知限制

| 项 | 说明 |
|---|---|
| 单 DO 承载全部房间 | 与上游「单进程」等价；房间数受 DO 单实例吞吐约束，个人/小团队规模无影响 |
| `ws-chunk` 二进制分片 | 已实现但未在真机实测，需 `WS_FALLBACK=true` 且双端浏览器 |
| 免费档超额 | 直接返回错误（不扣费），每日 00:00 UTC 重置 |
| `*.workers.dev` | 共享子域，官方定位非生产；长期对外服务建议绑自有域名 |

## 鸣谢

前端、协议与产品设计全部来自 [PairDrop](https://github.com/schlagmichdoch/PairDrop)（作者 schlagmichdoch）。本项目只替换信令层的运行平台。

## 许可证

[GPL-3.0](LICENSE)。本项目是 PairDrop 的衍生作品，而 PairDrop 以 GPL-3.0 发布，因此整体（含 `src/` 与 `public/`）必须沿用 GPL-3.0，不能改为 MIT 等宽松协议。若需宽松协议，只能按上游实现重写信令层或向原作者取得授权。
