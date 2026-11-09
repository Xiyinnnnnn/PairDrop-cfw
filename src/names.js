// 替代上游 unique-names-generator 的 [colors, animals] 二维词表 + cyrb53 种子
// 上游风格：style 'capital'、separator ' '、length 2 —— 即「蓝色 海豚」式两词组合。

const COLORS = [
    "red", "orange", "yellow", "green", "teal", "blue", "indigo", "purple", "pink", "brown",
    "black", "white", "gray", "silver", "gold", "amber", "lime", "cyan", "navy", "olive",
    "maroon", "beige", "coral", "crimson", "ivory", "khaki", "lavender", "magenta", "mint", "salmon",
    "tan", "turquoise", "violet", "wheat", "aqua", "plum", "orchid", "rose", "skyblue", "snow",
];

const ANIMALS = [
    "ant", "bear", "bee", "bird", "cat", "cheetah", "chicken", "cow", "dog", "dolphin",
    "duck", "eagle", "elephant", "falcon", "fish", "fox", "frog", "giraffe", "goat", "gorilla",
    "hamster", "hawk", "horse", "jaguar", "kangaroo", "koala", "leopard", "lion", "llama", "lobster",
    "monkey", "moose", "mouse", "octopus", "otter", "owl", "panda", "parrot", "penguin", "pig",
    "puma", "rabbit", "raccoon", "rhino", "salmon", "seal", "shark", "sheep", "snake", "spider",
    "squid", "swan", "tiger", "toad", "turtle", "whale", "wolf", "wombat", "yak", "zebra",
];

const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);

// 与 cyrb53 组合，等价于种子固定的确定性取名
export function generateDisplayName(seed) {
    const a = COLORS[Math.abs(seed) % COLORS.length];
    const b = ANIMALS[Math.abs(Math.floor(seed / COLORS.length)) % ANIMALS.length];
    return capitalize(a) + " " + capitalize(b);
}
