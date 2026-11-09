# PairDrop-cfw

把 [PairDrop](https://github.com/schlagmichdoch/PairDrop) 的信令层搬到 Cloudflare Workers + Durable Objects。前端和信令协议不动，用一个 Durable Object 顶替原来的 Node 进程。

线上：<https://pairdrop-cfw.xiyin-chen2003.workers.dev>

## 部署

要 Node ≥20 和一个 Cloudflare 账号，免费档够用。

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

想在中继时走 Cloudflare TURN（跨网直连失败用得上）：

```bash
# secret 只返回这一次
curl -s -X POST -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" -d '{"name":"pairdrop-cfw"}' \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/calls/turn_keys"

npx wrangler secret put CF_TURN_KEY_ID
npx wrangler secret put CF_TURN_KEY_API_TOKEN
```

Termux 上多两步：`pkg install -y nodejs libicu`，`bash scripts/patch-workerd.sh`（Android 没有 workerd 二进制，deploy 用不到它），之后 `bash scripts/deploy.sh`。

## 依赖

| 仓库 | 用途 |
|---|---|
| [schlagmichdoch/PairDrop](https://github.com/schlagmichdoch/PairDrop) | 前端与信令协议，GPL-3.0 |
| [tylermercer/quickshare-durable-objects](https://github.com/tylermercer/quickshare-durable-objects) | DO 跑 WS 信令的思路 |
| [darklinden/snapdrop-cf-worker](https://github.com/darklinden/snapdrop-cf-worker) | Snapdrop on Workers |
| [iamkunal9/p2p-file-share](https://github.com/iamkunal9/p2p-file-share) | Workers 上的 P2P 信令 |

后三个只看了思路，没抄代码。

## 配置

| 变量 | 默认 | 作用 |
|---|---|---|
| `WS_FALLBACK` | `false` | true 时服务器中继文本和文件 |
| `CF_TURN_KEY_ID` / `CF_TURN_KEY_API_TOKEN` | 未设 | 同时设了才启用 TURN，否则只发 STUN |
| `RTC_CONFIG_JSON` | 未设 | 写死 iceServers，比如自建 coturn |

## 跟上游不一样的地方

心跳换成 DO 的 alarm：60 秒巡检一次，3 分钟没动静踢掉。连接状态存在 websocket attachment 里，休眠醒来时重建房间表。哈希用 HMAC-SHA256 加盐，Workers 没有 SHA3。

`display-name-changed` 从 `wsFallback` 闸门里单独拿出来了。上游默认配置下改设备名不会同步给对端，这里让它同步。其余分支和闸门位置照抄。

## 测试

```bash
BASE=wss://你的域名/server node scripts/e2e.mjs       # 开房、配对、中继、断线
BASE=wss://你的域名/server node scripts/e2e-full.mjs  # 再加近场、房间号、配对码、改名
```

## 已知问题

- `ws-chunk` 二进制分片写了但没在真机验过，要 `WS_FALLBACK=true` 和两个真浏览器。
- `wrangler dev` 在 Android 上起不来，本地只能 `--dry-run` 验打包。

## 许可

[GPL-3.0](LICENSE)。PairDrop 是 GPL-3.0，这是它的衍生作品，不能改成 MIT。
