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
    { id: 'showAxis', label: '对称轴', values: [1, 0], def: 0, texts: ['显示', '隐藏'], unit: '' }
];

const idxs = [];
for (let i = 0; i < ITEMS.length; i++) { idxs.push(ITEMS[i].def); }

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
        persist();
    },

    // 交给 plot.draw 的取值快照
    snapshot: function () {
        return {
            width: ITEMS[0].values[idxs[0]],
            showRoots: ITEMS[1].values[idxs[1]],
            dotSize: ITEMS[2].values[idxs[2]],
            showAxis: ITEMS[3].values[idxs[3]]
        };
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
    },
    setIdx: function (i, k) {
        if (i < 0 || i >= ITEMS.length) { return; }
        idxs[i] = clampIdx(i, k);
    }
};
