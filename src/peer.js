// 从上游 server/peer.js 移植
// 差异：① 构造改为异步工厂（WebCrypto 哈希是异步的）
//       ② socket 由 Workers 的 WebSocket 替代 ws 的 Socket
//       ③ 新增 toJSON/restore，用于 DO 休眠后从 serializeAttachment 恢复 Peer 状态

import {cyrb53, hashCodeSalted} from "./helper.js";
import {parseUserAgent} from "./ua.js";
import {generateDisplayName} from "./names.js";

export default class Peer {

    constructor(ws, conf) {
        this.ws = ws;
        this.conf = conf;

        this.ip = "";
        this.id = "";
        this.rtcSupported = false;
        this.name = {model: "", os: "", browser: "", type: undefined, deviceName: "Unknown Device", displayName: ""};

        this.requestRate = 0;

        this.roomSecrets = [];
        this.pairKey = null;

        this.publicRoomId = null;
    }

    static async create(ws, request, conf, pepper) {
        const peer = new Peer(ws, conf);
        peer._setIP(request);
        await peer._setPeerId(request, pepper);
        peer._setRtcSupported(request);
        peer._setName(request);
        return peer;
    }

    // ---- 休眠恢复 ----
    toJSON() {
        return {
            ip: this.ip,
            id: this.id,
            rtcSupported: this.rtcSupported,
            name: this.name,
            roomSecrets: this.roomSecrets,
            pairKey: this.pairKey,
            publicRoomId: this.publicRoomId,
        };
    }

    static restore(ws, conf, data) {
        const peer = new Peer(ws, conf);
        Object.assign(peer, {
            ip: data.ip,
            id: data.id,
            rtcSupported: data.rtcSupported,
            name: data.name,
            roomSecrets: data.roomSecrets || [],
            pairKey: data.pairKey || null,
            publicRoomId: data.publicRoomId || null,
        });
        return peer;
    }

    rateLimitReached() {
        // 上游：10 次请求 / 10s
        if (this.requestRate >= 10) return true;
        this.requestRate += 1;
        setTimeout(() => this.requestRate -= 1, 10000);
        return false;
    }

    _setIP(request) {
        const cfIp = request.headers.get("cf-connecting-ip");
        const xff = request.headers.get("x-forwarded-for");
        if (cfIp) {
            this.ip = cfIp.split(/\s*,\s*/)[0];
        } else if (xff) {
            this.ip = xff.split(/\s*,\s*/)[0];
        } else {
            this.ip = "";
        }

        if (this.ip.substring(0, 7) === "::ffff:") {
            this.ip = this.ip.substring(7);
        }

        if (this.conf.ipv6Localize && this.ip.includes(":")) {
            this.ip = this.ip.split(":", this.conf.ipv6Localize).join(":");
        }

        // 与服务端同网段/本地地址统一归到 127.0.0.1 房间（与上游一致）
        if (this.ip === "::1" || this.ipIsPrivate(this.ip)) {
            this.ip = "127.0.0.1";
        }
    }

    ipIsPrivate(ip) {
        if (!ip) return false;
        if (!ip.includes(":")) {
            return /^(10)\.(.*)\.(.*)\.(.*)$/.test(ip)
                || /^(172)\.(1[6-9]|2[0-9]|3[0-1])\.(.*)\.(.*)$/.test(ip)
                || /^(192)\.(168)\.(.*)\.(.*)$/.test(ip)
                || /^(127)\.(.*)\.(.*)\.(.*)$/.test(ip);
        }
        const firstWord = ip.split(":").find(el => !!el);
        if (!firstWord) return false;
        if (/^fe[c-f][0-f]$/.test(firstWord)) return true;
        if (/^fc[0-f]{2}$/.test(firstWord)) return true;
        if (/^fd[0-f]{2}$/.test(firstWord)) return true;
        if (firstWord === "fe80") return true;
        if (firstWord === "100") return true;
        return false;
    }

    async _setPeerId(request, pepper) {
        const searchParams = new URL(request.url, "http://server").searchParams;
        const peerId = searchParams.get("peer_id");
        const peerIdHash = searchParams.get("peer_id_hash");
        if (peerId && Peer.isValidUuid(peerId) && await this.isPeerIdHashValid(peerId, peerIdHash, pepper)) {
            this.id = peerId;
        } else {
            this.id = crypto.randomUUID();
        }
    }

    _setRtcSupported(request) {
        const searchParams = new URL(request.url, "http://server").searchParams;
        this.rtcSupported = searchParams.get("webrtc_supported") === "true";
    }

    _setName(request) {
        const ua = parseUserAgent(request.headers.get("user-agent") || "");

        let deviceName = "";
        if (ua.os && ua.os.name) {
            deviceName = ua.os.name.replace("Mac OS", "Mac") + " ";
        }
        if (ua.device.model) {
            deviceName += ua.device.model;
        } else {
            deviceName += ua.browser.name;
        }
        if (!deviceName.trim()) {
            deviceName = "Unknown Device";
        }

        this.name = {
            model: ua.device.model,
            os: ua.os.name,
            browser: ua.browser.name,
            type: ua.device.type,
            deviceName: deviceName.trim(),
            displayName: generateDisplayName(cyrb53(this.id)),
        };
    }

    getInfo() {
        return {
            id: this.id,
            name: this.name,
            rtcSupported: this.rtcSupported,
        };
    }

    static isValidUuid(uuid) {
        return /^([0-9]|[a-f]){8}-(([0-9]|[a-f]){4}-){3}([0-9]|[a-f]){12}$/.test(uuid);
    }

    async isPeerIdHashValid(peerId, peerIdHash, pepper) {
        return peerIdHash === await hashCodeSalted(peerId, pepper);
    }

    addRoomSecret(roomSecret) {
        if (!(roomSecret in this.roomSecrets)) {
            this.roomSecrets.push(roomSecret);
        }
    }

    removeRoomSecret(roomSecret) {
        // 上游此处用 `in` 判断后 delete，对数组无效（历史 bug），此处保持等价：仅当存在时删除
        const i = this.roomSecrets.indexOf(roomSecret);
        if (i !== -1) {
            this.roomSecrets.splice(i, 1);
        }
    }
}
