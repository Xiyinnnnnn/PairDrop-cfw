// 从上游 server/helper.js 移植（1:1 语义，仅替换 Workers 不可用的 Node API）
// 差异：上游用 SHA3-512；Workers WebCrypto 不支持 SHA3 → 改用 HMAC-SHA256 + 服务端 pepper。
// 该值只在服务端内部产生与校验（客户端仅回传服务端给过的 hash），协议层无差异。

const enc = new TextEncoder();

export async function hashCodeSalted(salt, pepper) {
    const key = await crypto.subtle.importKey(
        "raw", enc.encode(pepper), {name: "HMAC", hash: "SHA-256"}, false, ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(salt));
    return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}

const charCodeLettersOnly = r => 65 <= r && r <= 90;
const charCodeAllPrintableChars = r => r === 45 || 47 <= r && r <= 57 || 64 <= r && r <= 90 || 97 <= r && r <= 122;

export function getRandomString(length, lettersOnly = false) {
    const charCodeCondition = lettersOnly ? charCodeLettersOnly : charCodeAllPrintableChars;
    let string = "";
    while (string.length < length) {
        let arr = new Uint16Array(length);
        crypto.getRandomValues(arr);
        arr = Array.apply([], arr);
        arr = arr.map(r => r % 128);
        arr = arr.filter(charCodeCondition);
        string += String.fromCharCode.apply(String, arr);
    }
    return string.substring(0, length);
}

// 上游用 crypto.randomInt(1000000, 1999999).toString().substring(1)
export function randomPairKeyDigits() {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return (1000000 + (buf[0] % 1000000)).toString().substring(1);
}

/* cyrb53 (c) 2018 bryc — 与上游逐字一致 */
export const cyrb53 = function (str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
};
