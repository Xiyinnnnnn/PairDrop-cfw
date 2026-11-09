// 从上游 server/ws-server.js 逐方法移植（1:1 消息协议）
// 运行环境差异与对应处理：
//   ① ws 库 → Workers WebSocket + Durable Object Hibernation API
//   ② setInterval 心跳 → ctx.storage.setAlarm 定时扫（每分钟一次）
//   ③ 休眠后内存丢失 → 用 ws.serializeAttachment 存 Peer，唤醒时重建三张表
//   ④ 房间/密钥/公网房间的数据结构、消息字段、判定顺序全部保持上游原样

import {DurableObject} from "cloudflare:workers";
import Peer from "./peer.js";
import {getRandomString, randomPairKeyDigits, hashCodeSalted} from "./helper.js";
import {getRtcConfig, DEFAULT_RTC_CONFIG} from "./turn.js";

const OPEN = 1;

export class SignalingServer extends DurableObject {

    constructor(ctx, env) {
        super(ctx, env);
        this.ctx = ctx;
        this.env = env;

        this.conf = {
            wsFallback: env.WS_FALLBACK === "true",
            debugMode: env.DEBUG_MODE === "true",
            ipv6Localize: parseInt(env.IPV6_LOCALIZE) || false,
            rtcConfig: DEFAULT_RTC_CONFIG, // 真实值在 fetch() 里异步取，见 _rtcConfig()
        };

        this._rooms = {};          // { roomId: { peerId: Peer } }
        this._roomSecrets = {};    // { pairKey: { roomSecret, creator } }
        this._peers = new Map();   // peerId -> Peer
        this._byWs = new Map();    // WebSocket -> Peer
        this._hydrated = false;
        this._pepper = null;
    }

    // ---------------- 生命周期 ----------------

    async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname !== "/server") {
            return new Response("Not found", {status: 404});
        }
        const upgrade = request.headers.get("Upgrade");
        if (!upgrade || upgrade.toLowerCase() !== "websocket") {
            return new Response("Expected Upgrade: websocket", {status: 426});
        }

        this._hydrate();

        const rtcConfig = await getRtcConfig(this.env, this.ctx.storage, m => console.log(m));
        this.conf.rtcConfig = rtcConfig;

        const pepper = await this._getPepper();
        const [client, server] = Object.values(new WebSocketPair());
        await this._onConnection(server, request, pepper);

        return new Response(null, {status: 101, webSocket: client});
    }

    // 与上游 _onConnection 对应：建 Peer、接 WS、下发 ws-config 与 display-name
    async _onConnection(server, request, pepper) {
        const peer = await Peer.create(server, request, this.conf, pepper);

        this.ctx.acceptWebSocket(server);
        this._peers.set(peer.id, peer);
        this._byWs.set(server, peer);
        this._persist(peer);

        // 上游行为：先发 ws-config，再发 display-name
        this._send(peer, {
            type: "ws-config",
            wsConfig: {
                rtcConfig: this.conf.rtcConfig,
                wsFallback: this.conf.wsFallback,
            },
        });

        this._send(peer, {
            type: "display-name",
            displayName: peer.name.displayName,
            deviceName: peer.name.deviceName,
            peerId: peer.id,
            peerIdHash: await hashCodeSalted(peer.id, pepper),
        });

        this._scheduleKeepAlive();

    }

    async webSocketMessage(ws, message) {
        this._hydrate();
        const peer = this._byWs.get(ws);
        if (!peer) return;
        peer.lastBeat = Date.now();
        this._onMessage(peer, message);
        this._persist(peer);
    }

    async webSocketClose(ws, code, reason, wasClean) {
        this._hydrate();
        const peer = this._byWs.get(ws);
        if (!peer) return;
        this._teardown(peer);
    }

    async webSocketError(ws, error) {
        this._hydrate();
        const peer = this._byWs.get(ws);
        if (!peer) return;
        this._teardown(peer);
    }

    // ---------------- 心跳（替代 setInterval） ----------------

    _scheduleKeepAlive() {
        this.ctx.storage.setAlarm(Date.now() + 60 * 1000);
    }

    async alarm() {
        this._hydrate();
        const now = Date.now();
        for (const peer of [...this._peers.values()]) {
            if (peer.ws.readyState !== OPEN) {
                this._teardown(peer);
                continue;
            }
            if (now - (peer.lastBeat || now) > 3 * 60 * 1000) {
                // 上游是 5×1s 无响应即断开；Workers 侧放宽到 3min（消息本身会刷新 lastBeat）
                this._teardown(peer);
                continue;
            }
            this._send(peer, {type: "ping"});
        }
        if (this._peers.size) this._scheduleKeepAlive();
    }

    // ---------------- 休眠恢复 ----------------

    _hydrate() {
        if (this._hydrated) return;
        this._hydrated = true;

        for (const ws of this.ctx.getWebSockets()) {
            let data;
            try {
                data = ws.deserializeAttachment();
            } catch (e) {
                continue;
            }
            if (!data || !data.id) continue;
            const peer = Peer.restore(ws, this.conf, data);
            peer.lastBeat = Date.now();
            this._peers.set(peer.id, peer);
            this._byWs.set(ws, peer);
            // 静默重建房间（不触发 peer-joined/peers 通知）
            this._rooms[peer.ip] = this._rooms[peer.ip] || {};
            this._rooms[peer.ip][peer.id] = peer;
            for (const secret of peer.roomSecrets) {
                this._rooms[secret] = this._rooms[secret] || {};
                this._rooms[secret][peer.id] = peer;
            }
            if (peer.publicRoomId) {
                this._rooms[peer.publicRoomId] = this._rooms[peer.publicRoomId] || {};
                this._rooms[peer.publicRoomId][peer.id] = peer;
            }
            if (peer.pairKey) {
                this._roomSecrets[peer.pairKey] = this._roomSecrets[peer.pairKey] || {
                    roomSecret: peer.roomSecrets[peer.roomSecrets.length - 1],
                    creator: peer,
                };
            }
        }
    }

    _persist(peer) {
        try {
            peer.ws.serializeAttachment(peer.toJSON());
        } catch (e) { /* socket 已关闭 */ }
    }

    async _getPepper() {
        if (this._pepper) return this._pepper;
        let pepper = await this.ctx.storage.get("hashPepper");
        if (!pepper) {
            pepper = getRandomString(128);
            await this.ctx.storage.put("hashPepper", pepper);
        }
        this._pepper = pepper;
        return pepper;
    }

    // ---------------- 消息分发（与上游 switch 逐条对应） ----------------

    _onMessage(sender, raw) {
        let message;
        try {
            message = JSON.parse(raw);
        } catch (e) {
            console.warn("WS: Received JSON is malformed");
            return;
        }

        switch (message.type) {
            case "disconnect":
                this._onDisconnect(sender);
                break;
            case "pong":
                this._setKeepAliveTimerToNow(sender);
                break;
            case "join-ip-room":
                this._joinIpRoom(sender);
                break;
            case "room-secrets":
                this._onRoomSecrets(sender, message);
                break;
            case "room-secrets-deleted":
                this._onRoomSecretsDeleted(sender, message);
                break;
            case "pair-device-initiate":
                this._onPairDeviceInitiate(sender);
                break;
            case "pair-device-join":
                this._onPairDeviceJoin(sender, message);
                break;
            case "pair-device-cancel":
                this._onPairDeviceCancel(sender);
                break;
            case "regenerate-room-secret":
                this._onRegenerateRoomSecret(sender, message);
                break;
            case "create-public-room":
                this._onCreatePublicRoom(sender);
                break;
            case "join-public-room":
                this._onJoinPublicRoom(sender, message);
                break;
            case "leave-public-room":
                this._onLeavePublicRoom(sender);
                break;
            case "signal":
                this._signalAndRelay(sender, message);
                break;
            case "display-name-changed":
                // 与上游唯一的有意差异：上游把它放在 wsFallback 闸门内，导致默认配置下自定义设备名
                // 永远同步不到对端（对端只看得到服务器派生的 "Blue Dolphin" 之类名字）。这里无条件转发。
                this._signalAndRelay(sender, message);
                break;
            case "request":
            case "header":
            case "partition":
            case "partition-received":
            case "progress":
            case "files-transfer-response":
            case "file-transfer-complete":
            case "message-transfer-complete":
            case "text":
            case "ws-chunk":
                if (this.conf.wsFallback) {
                    this._signalAndRelay(sender, message);
                } else {
                    console.log("Websocket fallback is not activated on this instance.");
                }
        }
    }

    _signalAndRelay(sender, message) {
        const room = message.roomType === "ip" ? sender.ip : message.roomId;
        if (message.to && Peer.isValidUuid(message.to) && this._rooms[room]) {
            const recipient = this._rooms[room][message.to];
            if (!recipient) return;
            delete message.to;
            message.sender = {id: sender.id, rtcSupported: sender.rtcSupported};
            this._send(recipient, message);
        }
    }

    _onDisconnect(sender) {
        this._disconnect(sender);
    }

    _disconnect(sender) {
        this._removePairKey(sender.pairKey);
        sender.pairKey = null;

        this._leaveIpRoom(sender, true);
        this._leaveAllSecretRooms(sender, true);
        this._leavePublicRoom(sender, true);

        try { sender.ws.close(1000, "disconnect"); } catch (e) { }
        this._teardown(sender);
    }

    _teardown(peer) {
        try { this._removePairKey(peer.pairKey); } catch (e) { }
        try { this._leaveIpRoom(peer, true); } catch (e) { }
        try { this._leaveAllSecretRooms(peer, true); } catch (e) { }
        try { this._leavePublicRoom(peer, true); } catch (e) { }
        this._peers.delete(peer.id);
        this._byWs.delete(peer.ws);
        try { peer.ws.close(1000, "closed"); } catch (e) { }
    }

    _onRoomSecrets(sender, message) {
        if (!message.roomSecrets) return;
        const roomSecrets = message.roomSecrets.filter(roomSecret => /^[\x00-\x7F]{64,256}$/.test(roomSecret));
        if (!roomSecrets.length) return;
        this._joinSecretRooms(sender, roomSecrets);
    }

    _onRoomSecretsDeleted(sender, message) {
        if (!Array.isArray(message.roomSecrets)) return;
        for (let i = 0; i < message.roomSecrets.length; i++) {
            this._deleteSecretRoom(message.roomSecrets[i]);
        }
    }

    _deleteSecretRoom(roomSecret) {
        const room = this._rooms[roomSecret];
        if (!room) return;
        for (const peerId in room) {
            const peer = room[peerId];
            this._leaveSecretRoom(peer, roomSecret, true);
            this._send(peer, {type: "secret-room-deleted", roomSecret: roomSecret});
            this._persist(peer);
        }
    }

    _onPairDeviceInitiate(sender) {
        const roomSecret = getRandomString(256);
        const pairKey = this._createPairKey(sender, roomSecret);
        if (sender.pairKey) this._removePairKey(sender.pairKey);
        sender.pairKey = pairKey;

        this._send(sender, {type: "pair-device-initiated", roomSecret: roomSecret, pairKey: pairKey});
        this._joinSecretRoom(sender, roomSecret);
        this._persist(sender);
    }

    _onPairDeviceJoin(sender, message) {
        if (sender.rateLimitReached()) {
            this._send(sender, {type: "join-key-rate-limit"});
            return;
        }
        if (!this._roomSecrets[message.pairKey] || sender.id === this._roomSecrets[message.pairKey].creator.id) {
            this._send(sender, {type: "pair-device-join-key-invalid"});
            return;
        }
        const roomSecret = this._roomSecrets[message.pairKey].roomSecret;
        const creator = this._roomSecrets[message.pairKey].creator;
        this._removePairKey(message.pairKey);
        this._send(sender, {type: "pair-device-joined", roomSecret: roomSecret, peerId: creator.id});
        this._send(creator, {type: "pair-device-joined", roomSecret: roomSecret, peerId: sender.id});
        this._joinSecretRoom(sender, roomSecret);
        this._removePairKey(sender.pairKey);
        this._persist(sender);
        this._persist(creator);
    }

    _onPairDeviceCancel(sender) {
        const pairKey = sender.pairKey;
        if (!pairKey) return;
        this._removePairKey(pairKey);
        this._send(sender, {type: "pair-device-canceled", pairKey: pairKey});
    }

    _onCreatePublicRoom(sender) {
        const publicRoomId = getRandomString(5, true).toLowerCase();
        this._send(sender, {type: "public-room-created", roomId: publicRoomId});
        this._joinPublicRoom(sender, publicRoomId);
        this._persist(sender);
    }

    _onJoinPublicRoom(sender, message) {
        if (sender.rateLimitReached()) {
            this._send(sender, {type: "join-key-rate-limit"});
            return;
        }
        if (!this._rooms[message.publicRoomId] && !message.createIfInvalid) {
            this._send(sender, {type: "public-room-id-invalid", publicRoomId: message.publicRoomId});
            return;
        }
        this._leavePublicRoom(sender);
        this._joinPublicRoom(sender, message.publicRoomId);
        this._persist(sender);
    }

    _onLeavePublicRoom(sender) {
        this._leavePublicRoom(sender, true);
        this._send(sender, {type: "public-room-left"});
        this._persist(sender);
    }

    _onRegenerateRoomSecret(sender, message) {
        const oldRoomSecret = message.roomSecret;
        const newRoomSecret = getRandomString(256);
        const room = this._rooms[oldRoomSecret];
        if (room) {
            for (const peerId in room) {
                const peer = room[peerId];
                this._send(peer, {
                    type: "room-secret-regenerated",
                    oldRoomSecret: oldRoomSecret,
                    newRoomSecret: newRoomSecret,
                });
                peer.removeRoomSecret(oldRoomSecret);
                this._persist(peer);
            }
        }
        delete this._rooms[oldRoomSecret];
    }

    _createPairKey(creator, roomSecret) {
        let pairKey;
        do {
            pairKey = randomPairKeyDigits();
        } while (pairKey in this._roomSecrets);

        this._roomSecrets[pairKey] = {roomSecret: roomSecret, creator: creator};
        return pairKey;
    }

    _removePairKey(pairKey) {
        if (pairKey && pairKey in this._roomSecrets) {
            this._roomSecrets[pairKey].creator.pairKey = null;
            delete this._roomSecrets[pairKey];
        }
    }

    _joinIpRoom(peer) {
        this._joinRoom(peer, "ip", peer.ip);
    }

    _joinSecretRoom(peer, roomSecret) {
        this._joinRoom(peer, "secret", roomSecret);
        peer.addRoomSecret(roomSecret);
    }

    _joinPublicRoom(peer, publicRoomId) {
        this._leavePublicRoom(peer);
        this._joinRoom(peer, "public-id", publicRoomId);
        peer.publicRoomId = publicRoomId;
    }

    _joinRoom(peer, roomType, roomId) {
        if (this._rooms[roomId] && this._rooms[roomId][peer.id]) {
            this._leaveRoom(peer, roomType, roomId);
        }
        if (!this._rooms[roomId]) this._rooms[roomId] = {};
        this._notifyPeers(peer, roomType, roomId);
        this._rooms[roomId][peer.id] = peer;
    }

    _leaveIpRoom(peer, disconnect = false) {
        this._leaveRoom(peer, "ip", peer.ip, disconnect);
    }

    _leaveSecretRoom(peer, roomSecret, disconnect = false) {
        this._leaveRoom(peer, "secret", roomSecret, disconnect);
        peer.removeRoomSecret(roomSecret);
    }

    _leavePublicRoom(peer, disconnect = false) {
        if (!peer.publicRoomId) return;
        this._leaveRoom(peer, "public-id", peer.publicRoomId, disconnect);
        peer.publicRoomId = null;
    }

    _leaveRoom(peer, roomType, roomId, disconnect = false) {
        if (!this._rooms[roomId] || !this._rooms[roomId][peer.id]) return;

        delete this._rooms[roomId][peer.id];

        if (!Object.keys(this._rooms[roomId]).length) {
            delete this._rooms[roomId];
            return;
        }

        for (const otherPeerId in this._rooms[roomId]) {
            const otherPeer = this._rooms[roomId][otherPeerId];
            this._send(otherPeer, {
                type: "peer-left",
                peerId: peer.id,
                roomType: roomType,
                roomId: roomId,
                disconnect: disconnect,
            });
        }
    }

    _notifyPeers(peer, roomType, roomId) {
        if (!this._rooms[roomId]) return;

        for (const otherPeerId in this._rooms[roomId]) {
            if (otherPeerId === peer.id) continue;
            const otherPeer = this._rooms[roomId][otherPeerId];
            this._send(otherPeer, {
                type: "peer-joined",
                peer: peer.getInfo(),
                roomType: roomType,
                roomId: roomId,
            });
        }

        const otherPeers = [];
        for (const otherPeerId in this._rooms[roomId]) {
            if (otherPeerId === peer.id) continue;
            otherPeers.push(this._rooms[roomId][otherPeerId].getInfo());
        }

        this._send(peer, {type: "peers", peers: otherPeers, roomType: roomType, roomId: roomId});
    }

    _joinSecretRooms(peer, roomSecrets) {
        for (let i = 0; i < roomSecrets.length; i++) {
            this._joinSecretRoom(peer, roomSecrets[i]);
        }
    }

    _leaveAllSecretRooms(peer, disconnect = false) {
        for (const roomSecret of [...peer.roomSecrets]) {
            this._leaveSecretRoom(peer, roomSecret, disconnect);
        }
    }

    _send(peer, message) {
        if (!peer) return;
        if (peer.ws.readyState !== OPEN) return;
        try {
            peer.ws.send(JSON.stringify(message));
        } catch (e) {
            /* 忽略已关闭的连接 */
        }
    }

    _setKeepAliveTimerToNow(peer) {
        peer.lastBeat = Date.now();
    }
}
