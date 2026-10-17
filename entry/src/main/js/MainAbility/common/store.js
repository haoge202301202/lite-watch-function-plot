/**
 * 函数列表状态。模块级单例，index 与 edit 两个页面共享同一份数据。
 * 持久化用 @system.storage（SDK 中标注 @reserved ["liteWearable"]）。
 *
 * 内存考虑：本模块**不**做二次函数分析（那需要 poly，只有主页绘图时用得上），
 * 编辑页因此不必连带加载 poly.js，省下一份字节码。
 */
import storage from '@system.storage';
import expr from './expr';

const KEY_LIST = 'hanshu_exprs_v1';
const KEY_CUR = 'hanshu_cur_v1';
const COLORS = ['#4FC3F7', '#FFB74D', '#7BD389', '#F06292', '#BA68C8'];
const MAXF = 5;

let list = [];
let cur = 0;
let loaded = false;

// 由表达式文本构造一条曲线记录；非法返回 null
function makeItem(src, colorIdx) {
    const r = expr.parse(src);
    if (!r.ok) { return null; }
    return {
        src: r.body,
        text: 'y=' + r.body,
        // fn：编译好的求值闭包，绘图时逐点调用（比每次走 AST 递归快得多）
        fn: r.fn,
        ast: r.ast,
        color: COLORS[colorIdx % COLORS.length],
        quad: null,
        // 是否已做过二次函数分析。非二次函数的 quad 恒为 null，
        // 没有这个标记就会在每次重绘时重复做一遍多项式提取。
        quadDone: false,
        pts: ''
    };
}

/**
 * 持久化。@system.storage 在部分预览器 / 低版本运行时上不可用，
 * 调用会抛 TypeError 把页面打崩（表现为「点确定后黑屏」），
 * 因此整体包 try/catch：存不了就降级为纯内存，功能不受影响。
 */
function persist() {
    try {
        const parts = [];
        for (let i = 0; i < list.length; i++) { parts.push(list[i].src); }
        storage.set({ key: KEY_LIST, value: parts.join('\n'), success: function () {}, fail: function () {} });
        storage.set({ key: KEY_CUR, value: String(cur), success: function () {}, fail: function () {} });
    } catch (e) {
        // 忽略：无持久化能力时仍可正常使用
    }
}

export default {
    COLORS: COLORS,
    MAXF: MAXF,

    getList: function () { return list; },
    getCur: function () { return cur; },
    count: function () { return list.length; },
    isFull: function () { return list.length >= MAXF; },
    isEmpty: function () { return list.length === 0; },

    curItem: function () {
        if (cur < 0 || cur >= list.length) { return null; }
        return list[cur];
    },

    setCur: function (i) {
        if (i < 0 || i >= list.length) { return; }
        cur = i;
        persist();
    },

    next: function () {
        if (list.length === 0) { return; }
        cur = (cur + 1) % list.length;
        persist();
    },

    prev: function () {
        if (list.length === 0) { return; }
        cur = (cur + list.length - 1) % list.length;
        persist();
    },

    add: function (src) {
        if (list.length >= MAXF) {
            return { ok: false, msg: '\u6700\u591A\u6DFB\u52A0 ' + MAXF + ' \u6761\u66F2\u7EBF' };
        }
        const item = makeItem(src, list.length);
        if (!item) {
            const r = expr.parse(src);
            return { ok: false, msg: r.ok ? '\u8868\u8FBE\u5F0F\u65E0\u6548' : r.msg };
        }
        list.push(item);
        cur = list.length - 1;
        persist();
        return { ok: true };
    },

    update: function (i, src) {
        if (i < 0 || i >= list.length) {
            return { ok: false, msg: '\u8BB0\u5F55\u4E0D\u5B58\u5728' };
        }
        const item = makeItem(src, i);
        if (!item) {
            const r = expr.parse(src);
            return { ok: false, msg: r.ok ? '\u8868\u8FBE\u5F0F\u65E0\u6548' : r.msg };
        }
        list[i] = item;
        cur = i;
        persist();
        return { ok: true };
    },

    // 只校验不写入（编辑页实时提示用）
    check: function (src) {
        const r = expr.parse(src);
        if (!r.ok) { return { ok: false, msg: r.msg }; }
        return { ok: true, body: r.body };
    },

    removeAt: function (i) {
        if (i < 0 || i >= list.length) { return; }
        list.splice(i, 1);
        if (cur >= list.length) { cur = list.length - 1; }
        if (cur < 0) { cur = 0; }
        persist();
    },

    removeCur: function () {
        this.removeAt(cur);
    },

    // 清空全部函数。原地截断而不是重新赋值，避免别处持有的数组引用变成悬空副本。
    // 用于「返回开始界面后再进入绘图」时重置成空白画布。
    clearAll: function () {
        list.length = 0;
        cur = 0;
        persist();
    },

    // 首次载入持久化数据；完成后回调，用于触发一次重绘
    load: function (cb) {
        if (loaded) {
            if (cb) { cb(); }
            return;
        }
        try {
            loadFromStorage(cb);
        } catch (e) {
            // storage 不可用：直接以空列表启动
            loaded = true;
            if (cb) { cb(); }
        }
    }
};

function loadFromStorage(cb) {
        storage.get({
            key: KEY_LIST,
            default: '',
            success: function (data) {
                if (data) {
                    const arr = String(data).split('\n');
                    const out = [];
                    for (let i = 0; i < arr.length; i++) {
                        if (out.length >= MAXF) { break; }
                        if (!arr[i]) { continue; }
                        const it = makeItem(arr[i], out.length);
                        if (it) { out.push(it); }
                    }
                    list = out;
                }
                loaded = true;
                storage.get({
                    key: KEY_CUR,
                    default: '0',
                    success: function (d) {
                        const n = parseInt(d, 10);
                        if (!isNaN(n) && n >= 0 && n < list.length) { cur = n; }
                        if (cb) { cb(); }
                    },
                    fail: function () { if (cb) { cb(); } }
                });
            },
            fail: function () {
                loaded = true;
                if (cb) { cb(); }
            }
        });
}
