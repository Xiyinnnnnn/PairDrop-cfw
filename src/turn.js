// Cloudflare Realtime TURN 动态凭据（DO 内缓存，避免每次连接都打 CF API）
// 与 cf-turn 分支的 server/turn.js 同一思路，只是换成 fetch + ctx.storage。
// 凭据 TTL 实测上限 172800s(48h)；这里请求 12h，缓存 6h 后重取。

// 缓存键带链路开关指纹：改 TURN_FORCE_TCP / RELAY_ONLY 后旧缓存立即失效，不用等 6h
// （旧键 "rtcConfigCache" / "rtcConfigCache:tcp:all" 均已作废：后者存过 STUN 被误删的错误快照）
const cacheKeyFor = (env) =>
    `rtcConfigCache:v2:${env.TURN_FORCE_TCP === "true" ? "tcp" : "any"}:${env.RELAY_ONLY === "true" ? "relay" : "all"}`;

export const DEFAULT_RTC_CONFIG = {
    sdpSemantics: "unified-plan",
    iceServers: [{urls: "stun:stun.cloudflare.com:3478"}],
};

// 运营商对 UDP 限速/丢包时，可强制走 TCP 的 TURN（TURN_FORCE_TCP=true），
// 或用 RELAY_ONLY=true 去掉 STUN、让 ICE 只能选 TURN 中继。
export function shapeIceServers(iceServers, env) {
    if (env.TURN_FORCE_TCP !== "true" && env.RELAY_ONLY !== "true") return iceServers;
    return iceServers
        .map(s => {
            const urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).map(String);
            const isTurn = urls.some(u => u.startsWith("turn:") || u.startsWith("turns:"));
            if (!isTurn) return env.RELAY_ONLY === "true" ? null : s; // STUN 条目：只有 RELAY_ONLY 才剔除
            if (env.TURN_FORCE_TCP !== "true") return s;
            const tcp = urls.filter(u => u.startsWith("turns:") || u.includes("transport=tcp"));
            return tcp.length ? {...s, urls: tcp} : null;
        })
        .filter(Boolean);
}

export async function getRtcConfig(env, storage, log = () => {}) {
    const keyId = env.CF_TURN_KEY_ID;
    const keyToken = env.CF_TURN_KEY_API_TOKEN;

    if (keyId && keyToken) {
        const cached = await storage.get(cacheKeyFor(env));
        if (cached && cached.expires > Date.now()) {
            return cached.value;
        }
        try {
            const res = await fetch(
                `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
                {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${keyToken}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ttl: 43200}),
                }
            );
            if (res.ok) {
                const {iceServers} = await res.json();
                if (Array.isArray(iceServers) && iceServers.length) {
                    const value = {sdpSemantics: "unified-plan", iceServers: shapeIceServers(iceServers, env)};
                    await storage.put(cacheKeyFor(env), {value, expires: Date.now() + 6 * 3600 * 1000});
                    log("CF TURN 凭据已刷新");
                    return value;
                }
            } else {
                log(`CF TURN 取凭据失败 HTTP ${res.status}`);
            }
        } catch (e) {
            log("CF TURN 请求异常：" + e.message);
        }
        if (cached) return cached.value; // 过期但可用，先顶着
    }

    if (env.RTC_CONFIG_JSON) {
        try {
            return JSON.parse(env.RTC_CONFIG_JSON);
        } catch (e) {
            log("RTC_CONFIG_JSON 解析失败，用默认 STUN");
        }
    }
    return DEFAULT_RTC_CONFIG;
}
