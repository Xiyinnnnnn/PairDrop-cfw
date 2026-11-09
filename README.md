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

GPL-3.0，见 [LICENSE](LICENSE)。PairDrop 以 GPL-3.0 发布，本项目是其衍生作品，分发和改动后仍须沿用 GPL-3.0，不能换成 MIT。
