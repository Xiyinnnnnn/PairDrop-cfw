// 替代上游的 ua-parser-js（无法在不引入 npm 打包的前提下使用）
// 只产出 PairDrop 用到的四个字段：os.name / browser.name / device.model / device.type
// 覆盖常见桌面与移动端；未知一律返回空串，行为等价于上游 ua-parser 的空结果分支。

const BROWSERS = [
    [/Edg\/([\d.]+)/, "Edge"],
    [/OPR\/([\d.]+)/, "Opera"],
    [/SamsungBrowser\/([\d.]+)/, "Samsung Internet"],
    [/Firefox\/([\d.]+)/, "Firefox"],
    [/CriOS\/([\d.]+)/, "Chrome"],
    [/FxiOS\/([\d.]+)/, "Firefox"],
    [/Chrome\/([\d.]+)/, "Chrome"],
    [/Version\/([\d.]+).*Safari/, "Safari"],
];

const OSES = [
    [/Windows NT 10\.0/, "Windows"],
    [/Windows NT 6\.3/, "Windows"],
    [/Windows/, "Windows"],
    [/Android[ /]([\d.]+)/, "Android"],
    [/iPhone|iPad|iPod/, "iOS"],
    [/Mac OS X/, "Mac OS"],
    [/CrOS/, "Chrome OS"],
    [/Linux/, "Linux"],
];

// [UA 关键字, 型号, 类型]
const DEVICES = [
    [/iPhone/, "iPhone", "mobile"],
    [/iPad/, "iPad", "tablet"],
    [/SM-([A-Z0-9]+)/, "SM-", "mobile"],
    [/Pixel ([\w ]+)/, "Pixel", "mobile"],
    [/Redmi ([A-Za-z0-9 ]+)/, "Redmi", "mobile"],
    [/Mi 9|MI 9/, "Mi 9", "mobile"],
    [/HUAWEI ([A-Za-z0-9-]+)/, "HUAWEI", "mobile"],
    [/Android/, "", "mobile"],
];

export function parseUserAgent(ua = "") {
    let browserName = "";
    for (const [re, name] of BROWSERS) {
        if (re.test(ua)) { browserName = name; break; }
    }

    let osName = "";
    for (const [re, name] of OSES) {
        if (re.test(ua)) { osName = name; break; }
    }

    let deviceModel = "";
    let deviceType = osName === "Android" || osName === "iOS" ? "mobile" : undefined;
    for (const [re, prefix, type] of DEVICES) {
        const m = re.exec(ua);
        if (m) {
            deviceModel = (m[1] ? prefix + (prefix.endsWith("-") || prefix === "" ? m[1] : " " + m[1]) : prefix).trim();
            deviceType = type;
            break;
        }
    }
    if (osName === "iPad") { deviceType = "tablet"; }

    return {
        os: {name: osName},
        browser: {name: browserName},
        device: {model: deviceModel, type: deviceType},
    };
}
