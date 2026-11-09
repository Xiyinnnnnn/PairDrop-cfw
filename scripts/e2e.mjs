const BASE = process.env.BASE || "wss://pairdrop-cfw.xiyin-chen2003.workers.dev/server";
// 用法: BASE=wss://<你的域名>/server EXPECT_FALLBACK=false node scripts/e2e.mjs
const EXPECT_FALLBACK = process.env.EXPECT_FALLBACK === "true"; // 与 Worker 的 WS_FALLBACK 保持一致
const SECRET = "e2e".repeat(43); // 129 chars ASCII，满足 ^[\x00-\x7F]{64,256}$
const log = (...a) => console.log(...a);
const wait = ms => new Promise(r => setTimeout(r, ms));

function conn(tag) {
  const ws = new WebSocket(`${BASE}?webrtc_supported=true`);
  const msgs = [];
  ws.addEventListener("message", e => {
    let m; try { m = JSON.parse(e.data); } catch { m = { type: "?" }; }
    msgs.push(m);
    log(`  [${tag}] <-`, m.type, m.type === "peers" ? `peers=${m.peers.length}` : "");
  });
  return { ws, msgs, tag, open: new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); setTimeout(() => rej(new Error(tag + " open timeout")), 12000); }) };
}
const send = (c, o) => c.ws.send(JSON.stringify(o));
const has = (c, t) => c.msgs.some(m => m.type === t);
async function until(fn, ms = 8000, label = "") {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await wait(120); }
  throw new Error("timeout: " + label);
}

const results = [];
const check = (name, ok) => { results.push([name, ok]); log(`${ok ? "✅" : "❌"} ${name}`); };

try {
  const A = conn("A");
  await A.open; log("A connected");
  await until(() => A.msgs.length >= 1, 8000, "A 首帧");
  check("连接即收到 ws-config/display-name", has(A, "ws-config") || has(A, "display-name"));

  send(A, { type: "room-secrets", roomSecrets: [SECRET] });
  await until(() => has(A, "peers"), 8000, "A peers");
  const aPeers = A.msgs.find(m => m.type === "peers");
  check("A 开房：peers 为空", aPeers.peers.length === 0);

  const B = conn("B");
  await B.open; log("B connected");
  await until(() => B.msgs.length >= 1, 8000, "B 首帧");
  send(B, { type: "room-secrets", roomSecrets: [SECRET] });
  await until(() => has(B, "peers") && has(A, "peer-joined"), 8000, "配对");
  const bPeers = B.msgs.find(m => m.type === "peers");
  check("B 入房：peers 含 1 人", bPeers.peers.length === 1);
  check("A 收到 peer-joined", has(A, "peer-joined"));
  const peerB = A.msgs.find(m => m.type === "peer-joined").peer; // B 自己的 info 只能从 A 的 peer-joined 拿到
  check("peer 信息含 id/name/rtcSupported", !!peerB.id && "name" in peerB);

  // 信令中继
  const rid = A.msgs.find(m => m.type === "ws-config") ? "e2e-req-1" : "e2e-req-1";
  send(A, { type: "signal", to: peerB.id, roomType: "secret", roomId: SECRET, signal: "eyJ0eXBlIjoib2ZmZXIifQ==" });
  await until(() => B.msgs.some(m => m.type === "signal"), 8000, "signal 中继");
  check("signal 端到端中继", true);

  // 文本消息中继
  send(A, { type: "text", to: peerB.id, roomType: "secret", roomId: SECRET, text: "hello-cfw" });
  if (EXPECT_FALLBACK) {
    await until(() => B.msgs.some(m => m.type === "text"), 8000, "text 中继");
    check("WS_FALLBACK=true：text 经服务器中继", true);
  } else {
    await wait(1500);
    check("WS_FALLBACK=false：text 不被中继（与上游默认一致）", !B.msgs.some(m => m.type === "text"));
  }

  // 断线广播
  A.ws.close();
  await until(() => has(B, "peer-left"), 8000, "peer-left");
  check("A 断开后 B 收到 peer-left", true);

  // 非法报文不崩
  const C = conn("C");
  await C.open;
  C.ws.send("not-json");
  await wait(800);
  C.ws.send(JSON.stringify({ type: "room-secrets", roomSecrets: ["short"] }));
  await wait(500);
  check("非法/超短 roomSecret 不崩", C.ws.readyState === 1);
  C.ws.close();
  B.ws.close();
} catch (e) {
  log("❌ 异常:", e.message);
  results.push(["异常:" + e.message, false]);
}
const bad = results.filter(r => !r[1]);
log(`\n=== 结果 ${results.length - bad.length}/${results.length} 通过 ===`);
process.exit(bad.length ? 1 : 0);
