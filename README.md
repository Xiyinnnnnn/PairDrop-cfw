# PairDrop-cfw

示例站：<https://pairdrop-cfw.xiyin-chen2003.workers.dev>

## 快速部署

Node ≥20 + Cloudflare 账号，免费档够用。

```bash
npm install
npx wrangler login      # 或用下面两个环境变量
npx wrangler deploy
```

```bash
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...
npx wrangler deploy
```

TURN 可选，跨网直连失败时走中继：

```bash
# secret 只返回这一次
curl -s -X POST -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" -d '{"name":"pairdrop-cfw"}' \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/calls/turn_keys"

npx wrangler secret put CF_TURN_KEY_ID
npx wrangler secret put CF_TURN_KEY_API_TOKEN
```

Termux：`pkg install -y nodejs libicu`，`bash scripts/patch-workerd.sh`（Android 无 workerd 二进制，deploy 用不到），`bash scripts/deploy.sh`。

## 依赖

| 仓库 | 用途 |
|---|---|
| [schlagmichdoch/PairDrop](https://github.com/schlagmichdoch/PairDrop) | 前端与信令协议，GPL-3.0 |
| [tylermercer/quickshare-durable-objects](https://github.com/tylermercer/quickshare-durable-objects) | DO 跑 WS 信令的思路 |
| [darklinden/snapdrop-cf-worker](https://github.com/darklinden/snapdrop-cf-worker) | Snapdrop on Workers |
| [iamkunal9/p2p-file-share](https://github.com/iamkunal9/p2p-file-share) | Workers 上的 P2P 信令 |

## 协议

| 项 | 值 |
|---|---|
| client→server 分支 | 24/24 |
| server→client 下发类型 | 16/16 |
| 入房方式 | 同 IP 自动、5 位房间号、配对码、房间密钥 |
| 心跳 | DO `alarm` 60s 巡检，3min 无响应断开（上游 `setInterval` 1s） |
| 休眠 | 状态存 websocket attachment，唤醒重建房间表（上游进程内存） |
| 哈希 | HMAC-SHA256 加盐（上游 SHA3-512，Workers 无 SHA3） |
| `display-name-changed` | 移出 `wsFallback` 闸门，改名实时同步；其余分支与闸门位置照抄 |

GPL-3.0，见 [LICENSE](LICENSE)。
