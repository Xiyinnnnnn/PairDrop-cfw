// 全功能 E2E：近场(IP房) / 房间号(secret房) / 公网房间(public-id) / 配对码(pair-device) / 换房密钥 / 删房
// 用法: BASE=wss://<域名>/server node scripts/e2e-full.mjs
const BASE = process.env.BASE || "wss://pairdrop-cfw.xiyin-chen2003.workers.dev/server";
const wait = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (n, ok, extra = "") => { results.push([n, ok]); console.log(`${ok ? "✅" : "❌"} ${n}${extra ? "  " + extra : ""}`); };

function conn(tag) {
  const ws = new WebSocket(`${BASE}?webrtc_supported=true`);
  const msgs = [];
  ws.addEventListener("message", e => { try { msgs.push(JSON.parse(e.data)); } catch {} });
  return { tag, ws, msgs, open: new Promise((res, rej) => {
    ws.addEventListener("open", res);
    ws.addEventListener("error", () => rej(new Error(tag + " error")));
    setTimeout(() => rej(new Error(tag + " open timeout")), 12000);
  }) };
}
const send = (c, o) => c.ws.send(JSON.stringify(o));
const got = (c, t) => c.msgs.find(m => m.type === t);
const last = (c, t) => [...c.msgs].reverse().find(m => m.type === t); // 同一连接可能收到多条 peers（ip 房 + 公网房）
async function until(fn, ms = 8000, label = "") {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(100); }
  throw new Error("timeout: " + label);
}
const SECRET = "s".repeat(128);

try {
  // ---------- A 近场：IP 房 ----------
  const A = conn("A"), B = conn("B");
  await A.open; await B.open;
  await until(() => got(A, "ws-config") && got(B, "ws-config"), 8000, "首帧");
  send(A, { type: "join-ip-room" }); await until(() => got(A, "peers"), 8000, "A ip peers");
  send(B, { type: "join-ip-room" });
  await until(() => { const p = last(B, "peers"); return p && p.peers.length >= 1; }, 8000, "B ip peers");
  await until(() => last(A, "peer-joined"), 8000, "A peer-joined");   // 两端消息独立到达，需各自等待
  const bIp = last(B, "peers"), aJoined = last(A, "peer-joined");
  check("近场 IP 房：同公网 IP 自动互见", bIp.roomType === "ip" && aJoined?.roomType === "ip",
        `B 看到 ${bIp.peers.length} 人，roomType=${bIp.roomType}`);
  const peerB = aJoined.peer; // B 的 id

  // ---------- B 公网房间（远程，房间号） ----------
  send(A, { type: "create-public-room" });
  const created = await until(() => got(A, "public-room-created"), 8000, "public-room-created");
  check("公网房间：创建并拿到 5 位房间号", /^[a-z0-9]{5}$/.test(created.roomId), created.roomId);
  // A 已自动进房；B 加入
  send(B, { type: "join-public-room", publicRoomId: created.roomId });
  await until(() => { const p = last(B, "peers"); return p && p.roomType === "public-id" && p.roomId === created.roomId; }, 8000, "B 入公网房");
  check("公网房间：另一端凭房间号加入", !!last(B, "peers"), `roomType=public-id roomId=${created.roomId}`);
  // 错误房间号
  const C = conn("C"); await C.open; await until(() => got(C, "ws-config"), 8000, "C 首帧");
  send(C, { type: "join-public-room", publicRoomId: "zzzzz" });
  await until(() => got(C, "public-room-id-invalid"), 8000, "非法房间号");
  check("公网房间：不存在的房间号被拒", true);
  send(B, { type: "leave-public-room" });
  await until(() => got(B, "public-room-left"), 8000, "leave");
  check("公网房间：可退出房间", true);

  // ---------- C 配对码（远程，二维码/6 位码） ----------
  send(A, { type: "pair-device-initiate" });
  const init = await until(() => got(A, "pair-device-initiated"), 8000, "pair-initiate");
  check("配对码：发起方拿到 roomSecret + 配对码", init.roomSecret.length === 256 && /^\d+$/.test(init.pairKey),
        `pairKey=${init.pairKey}`);
  send(C, { type: "pair-device-join", pairKey: "000000" });
  await wait(600);
  check("配对码：错误码被拒（无 pair-device-joined）", !got(C, "pair-device-joined"));
  send(C, { type: "pair-device-join", pairKey: init.pairKey });
  await until(() => got(A, "pair-device-joined") && got(C, "pair-device-joined"), 8000, "pair-joined");
  const bj = got(C, "pair-device-joined");
  check("配对码：双方进入同一房间", bj.roomSecret === init.roomSecret && !!bj.peerId);
  await until(() => { const p = got(C, "peers"); return p && p.roomType === "secret"; }, 8000, "配对后 peers");
  check("配对码：配对后互相可见", true);

  // ---------- C2 改名同步（有意偏离上游：不受 wsFallback 闸门） ----------
  const peerCid = last(A, "peer-joined").peer.id;
  send(A, { type: "display-name-changed", to: peerCid, roomType: "secret", roomId: init.roomSecret, displayName: "改名测试设备" });
  const dn = await until(() => C.msgs.find(m => m.type === "display-name-changed"), 8000, "改名同步");
  const aId = got(A, "display-name").peerId;   // 发送方身份应等于 A 自己
  check("改名同步：WS_FALLBACK=false 下仍转发到对端", dn.displayName === "改名测试设备" && dn.sender?.id === aId,
        `sender=${dn.sender?.id?.slice(0,8)} 期望=${aId.slice(0,8)}`);

  // ---------- D 换房间密钥 ----------
  send(A, { type: "regenerate-room-secret", roomSecret: init.roomSecret });
  const regen = await until(() => got(A, "room-secret-regenerated"), 8000, "regenerate");
  check("换房密钥：下发旧/新密钥", regen.oldRoomSecret === init.roomSecret && regen.newRoomSecret.length === 256);

  // ---------- E 删除房间 ----------
  send(C, { type: "room-secrets", roomSecrets: [SECRET] });
  await until(() => { const p = last(C, "peers"); return p && p.roomId === SECRET; }, 8000, "C 进 secret 房");
  const D = conn("D"); await D.open; await until(() => got(D, "ws-config"), 8000, "D 首帧");
  send(D, { type: "room-secrets", roomSecrets: [SECRET] });
  await until(() => { const p = last(D, "peers"); return p && p.roomId === SECRET && p.peers.length >= 1; }, 8000, "D 进同房");
  send(D, { type: "room-secrets-deleted", roomSecrets: [SECRET] });
  await until(() => got(C, "secret-room-deleted") && got(D, "secret-room-deleted"), 8000, "删房广播");
  check("删房：同房成员收到 secret-room-deleted", true);

  // ---------- F 心跳 ----------
  send(A, { type: "pong" });
  await wait(1500);
  check("心跳：pong 后连接保持 OPEN", A.ws.readyState === 1);

  // ---------- G 断开清理 ----------
  A.ws.close();
  await until(() => B.msgs.some(m => m.type === "peer-left"), 8000, "peer-left");
  check("断开：对端收到 peer-left", true);

  [B, C, D].forEach(c => c.ws.close());
} catch (e) {
  console.log("❌ 异常:", e.message);
  results.push(["异常:" + e.message, false]);
}
const bad = results.filter(r => !r[1]);
console.log(`\n=== ${results.length - bad.length}/${results.length} 通过 ===`);
process.exit(bad.length ? 1 : 0);
