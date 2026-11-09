// shapeIceServers 四种开关组合断言（这些分支之前没测，导致 STUN 被误删）
import {shapeIceServers} from "../src/turn.js";
const CF = [
  {urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:443"]},
  {urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turn:turn.cloudflare.com:3478?transport=tcp",
          "turns:turn.cloudflare.com:5349?transport=tcp", "turn:turn.cloudflare.com:443?transport=udp",
          "turn:turn.cloudflare.com:80?transport=tcp", "turns:turn.cloudflare.com:443?transport=tcp"]},
];
const kind = out => out.map(e => (e.urls.some(u => u.startsWith("stun")) ? "stun" : "turn") + e.urls.length).join("+");
let bad = 0;
const t = (name, env, expect) => {
  const got = kind(shapeIceServers(CF, env));
  const ok = got === expect;
  console.log(`${ok ? "✅" : "❌"} ${name}: ${got}${ok ? "" : " 期望 " + expect}`);
  if (!ok) bad++;
};
t("开关全关 原样透传", {}, "stun2+turn6");
t("仅 TCP 强制", {TURN_FORCE_TCP: "true"}, "stun2+turn4");   // ← 本次修的 bug
t("仅 强制中继", {RELAY_ONLY: "true"}, "turn6");
t("两者全开", {TURN_FORCE_TCP: "true", RELAY_ONLY: "true"}, "turn4");
process.exit(bad ? 1 : 0);
