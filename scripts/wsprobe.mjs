// 探活：连 WS 取首帧 ws-config，打印下发的 iceServers
const url = process.argv[2];
const id = "probe-" + Math.random().toString(36).slice(2, 10);
const ws = new WebSocket(url.replace(/^http/, "ws") + "/server?peer_id=" + id + "&peer_id_hash=x&webrtc_supported=true");
const t = setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 15000);
ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type !== "ws-config") return;
    const is = m.wsConfig.rtcConfig.iceServers || [];
    console.log("wsFallback=" + m.wsConfig.wsFallback + " iceCount=" + is.length);
    for (const s of is) console.log("  " + JSON.stringify(s.urls));
    clearTimeout(t);
    ws.close();
    process.exit(0);
};
ws.onerror = (e) => console.log("ERR " + (e.message || ""));
