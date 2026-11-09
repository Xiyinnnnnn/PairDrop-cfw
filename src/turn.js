// Cloudflare Realtime TURN 动态凭据（DO 内缓存，避免每次连接都打 CF API）
// 与 cf-turn 分支的 server/turn.js 同一思路，只是换成 fetch + ctx.storage。
// 凭据 TTL 实测上限 172800s(48h)；这里请求 12h，缓存 6h 后重取。

const CACHE_KEY = "rtcConfigCache";

export const DEFAULT_RTC_CONFIG = {
    sdpSemantics: "unified-plan",
    iceServers: [{urls: "stun:stun.cloudflare.com:3478"}],
};

export async function getRtcConfig(env, storage, log = () => {}) {
    const keyId = env.CF_TURN_KEY_ID;
    const keyToken = env.CF_TURN_KEY_API_TOKEN;

    if (keyId && keyToken) {
        const cached = await storage.get(CACHE_KEY);
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
                    const value = {sdpSemantics: "unified-plan", iceServers};
                    await storage.put(CACHE_KEY, {value, expires: Date.now() + 6 * 3600 * 1000});
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
