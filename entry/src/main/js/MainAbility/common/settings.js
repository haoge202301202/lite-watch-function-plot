/**
 * 绘图外观设置。
 *
 * 四项都用「下标」存，读出来再查 values：避免浮点数和 0/1 在 storage 里
 * 反复做字符串转换，也让「点一下换下一个值」退化成简单的取模。
 *
 * 下标越界、storage 不可用、存的值是脏数据，一律回落到默认值 —— 轻手表上
 * 这种降级比抛错更重要（预览器里 @system.storage 干脆就没有）。
 */
import storage from '@system.storage';

const KEY = 'hanshu_set_v1';

// label 左侧显示名；values 可选值；texts 对应显示文本；unit 数值后缀
const ITEMS = [
    { id: 'width', label: '曲线粗细', values: [2, 3, 4], def: 1, texts: ['细', '中', '粗'], unit: 'px' },
    { id: 'showRoots', label: '显示交点', values: [1, 0], def: 0, texts: ['显示', '隐藏'], unit: '' },
    { id: 'dotSize', label: '点标记大小', values: [2, 3, 5], def: 1, texts: ['小', '中', '大'], unit: '' },
    // 对称轴默认**关闭**：它是用虚线拼出来的，一条轴要发 88 次 canvas 调用
    //（304px 竖线按 6px 段 + 5px 间隔拆成 28 段），是绘图页最贵的一项。
    // 真机上"画好曲线再平移/缩放/返回"全程崩溃，主要就是它把每次重绘推过了阈值。
    { id: 'showAxis', label: '对称轴', values: [0, 1], def: 0, texts: ['隐藏', '显示'], unit: '' },
    // 每次进入绘图是否清空上次的函数。默认 0（每次重来），与 v1.9.0 的行为一致。
    { id: 'keepLast', label: '保留上次函数', values: [0, 1], def: 0, texts: ['每次重来', '接着上次'], unit: '' },
    // 动画级别：0 关闭（省电、最跟手）/ 1 简洁（按键反馈）/ 2 完整（再加曲线绘制动画）

    // 画面等级：影响网格密度、刻度数量、曲线采样密度
    // 默认「流畅」：轻手表的 JS 堆只有 64 KB 量级，先把默认值放在最省的一档，
    // 想要更细的网格再自己往上调。
    { id: 'quality', label: '画面等级', values: [0, 1, 2], def: 0, texts: ['流畅', '标准', '精细'], unit: '' }
];

const idxs = [];
// id -> 下标。snapshot() 每帧都会调用（动画期间 25 帧/秒），
// 不能每次都按 id 线性查找，所以在模块初始化时建一次映射。
const POS = {};
for (let i = 0; i < ITEMS.length; i++) {
    idxs.push(ITEMS[i].def);
    POS[ITEMS[i].id] = i;
}

function valOf(id) {
    const i = POS[id];
    return (i === undefined) ? 0 : ITEMS[i].values[idxs[i]];
}

// snapshot() 每次重绘都会调用一次，返回的对象是只读的。
// 缓存起来复用同一个对象，避免每帧都分配一个 6 字段的对象（64KB 堆上很宝贵）。
let snapCache = null;

function clampIdx(i, v) {
    const n = ITEMS[i].values.length;
    if (typeof v !== 'number' || !isFinite(v)) { return ITEMS[i].def; }
    let k = Math.floor(v);
    if (k < 0) { k = 0; }
    if (k >= n) { k = n - 1; }
    return k;
}

function persist() {
    try {
        const parts = [];
        for (let i = 0; i < idxs.length; i++) { parts.push(String(idxs[i])); }
        storage.set({
            key: KEY,
            value: parts.join(','),
            success: function () {},
            fail: function () {}
        });
    } catch (e) {
        // 无持久化能力时仅本次运行生效
    }
}

export default {
    ITEMS: ITEMS,

    count: function () { return ITEMS.length; },

    // 按 id 取下标。菜单原先用 count()-1 取「保留上次函数」，
    // 后来加了两项设置，它悄悄指到了「画面等级」上 —— 直接按 id 查更稳。
    indexOf: function (id) {
        const i = POS[id];
        return (i === undefined) ? -1 : i;
    },

    // 第 i 项当前的显示文本（数值项带单位后缀）
    textOf: function (i) {
        if (i < 0 || i >= ITEMS.length) { return ''; }
        const it = ITEMS[i];
        const k = idxs[i];
        return it.unit ? (it.texts[k] + ' ' + it.values[k] + it.unit) : it.texts[k];
    },

    // 点一下换个值（循环）
    next: function (i) {
        if (i < 0 || i >= ITEMS.length) { return; }
        const n = ITEMS[i].values.length;
        idxs[i] = (idxs[i] + 1) % n;
        snapCache = null;
        persist();
    },

    // 交给 plot.draw 的取值快照
    snapshot: function () {
        // 按 id 取值而不是写死下标：之前菜单用 count()-1 定位「保留上次函数」，
        // 后来加了两项设置，它就悄悄指到了「画面等级」上。
        if (snapCache !== null) { return snapCache; }
        snapCache = {
            width: valOf('width'),
            showRoots: valOf('showRoots'),
            dotSize: valOf('dotSize'),
            showAxis: valOf('showAxis'),
            keepLast: valOf('keepLast'),
            quality: valOf('quality')
        };
        return snapCache;
    },

    load: function (cb) {
        try {
            storage.get({
                key: KEY,
                default: '',
                success: function (data) {
                    if (data) {
                        const arr = String(data).split(',');
                        for (let i = 0; i < ITEMS.length && i < arr.length; i++) {
                            idxs[i] = clampIdx(i, parseInt(arr[i], 10));
                        }
                        snapCache = null;
                    }
                    if (cb) { cb(); }
                },
                fail: function () { if (cb) { cb(); } }
            });
        } catch (e) {
            if (cb) { cb(); }
        }
    },

    // --- 以下两个只给自测用 ---
    reset: function () {
        for (let i = 0; i < ITEMS.length; i++) { idxs[i] = ITEMS[i].def; }
        snapCache = null;
    },
    setIdx: function (i, k) {
        if (i < 0 || i >= ITEMS.length) { return; }
        idxs[i] = clampIdx(i, k);
        snapCache = null;
    }
};
