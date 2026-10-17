import Device from '@system.device';
import store from '../../common/store';
import poly from '../../common/poly';
import plot from '../../common/plot';
import keypad from '../../common/keypad';

const BG = '#0B0F14';
const FG = '#E8EEF6';
const DIM = '#8FA3B8';
const ERR = '#F07272';
const BLUE = '#1F6FEB';
const BTN = '#1A2330';
const MAXLEN = 30;
const HINT = '点 + 添加函数';
const CALLS = ['sin', 'cos', 'tan', 'ln', 'lg', 'log2',
    'asin', 'acos', 'atan', 'sqrt', 'abs', 'exp'];

// 状态放模块级变量：既避开「this 只能写 data 已声明字段」的限制，
// 也避免 data 变化触发序列化。
const PLOT_MODE = 0;
const EDIT_MODE = 1;
let mode = PLOT_MODE;
let hotZones = [];
let editText = '';
let editMsg = '';
let editIdx = -1;
let fnPage = false;
let startX = 0;
let startY = 0;
// 防抖：同一次点击会先派发 touchend、再派发 click，
// 用「键名 + 时间窗」去重，避免一次点击输入两个字符。
let lastKey = '';
let lastAt = 0;

function nowMs() {
    return (typeof Date.now === 'function') ? Date.now() : new Date().getTime();
}

// 命中查找（模块级，操作模块级 hotZones）
function findHot(gx, gy) {
    for (let i = 0; i + 4 < hotZones.length; i += 5) {
        if (gx >= hotZones[i] && gx <= hotZones[i] + hotZones[i + 2] &&
            gy >= hotZones[i + 1] && gy <= hotZones[i + 1] + hotZones[i + 3]) {
            return String(hotZones[i + 4]);
        }
    }
    return null;
}

function clip(s, n) {
    if (!s) { return ''; }
    return s.length > n ? (s.substring(0, n - 1) + '\u2026') : s;
}

export default {
    data: {
        cw: 454,
        ch: 454,
        dbgText: ''
    },

    /**
     * 只用 onShow 驱动：先渲染，再异步补数据。
     * 早期版本在 onInit 里发起 Device.getInfo / store.load，回调时机不稳定，
     * 曾导致整页不渲染；改成 onShow 后与已验证可用的探针结构一致。
     */
    onShow() {
        mode = PLOT_MODE;
        editMsg = '';
        this.repaint();
        this.boot();
    },

    boot() {
        const self = this;
        try {
            Device.getInfo({
                success: function (info) {
                    if (info && info.windowWidth) {
                        self.cw = info.windowWidth;
                        self.ch = info.windowHeight || info.windowWidth;
                    }
                    self.repaint();
                },
                fail: function () {
                    self.repaint();
                }
            });
        } catch (e) {
            // 拿不到设备信息就按默认尺寸画
        }
        try {
            store.load(function () {
                self.repaint();
            });
        } catch (e) {
            // storage 不可用时用空列表
        }
    },

    // 绘图区边长：留出顶部标题与底部按钮，并保证正方形四角落在 r=233 圆内。
    // 四角到圆心距离 = sqrt((s/2)^2 + (233 - oy)^2)，466 屏上 s=292、oy=58 时约 227.9。
    side() {
        let s = this.cw - 60;
        const lim = this.ch - 174;
        if (s > lim) { s = lim; }
        if (s > 300) { s = 300; }
        if (s < 120) { s = 120; }
        return Math.floor(s);
    },

    repaint() {
        if (!this.$refs) { return; }
        /** @type {any} */
        const el = this.$refs.cv;
        if (!el || !el.getContext) {
            this.dbgText = 'no canvas';
            return;
        }
        const ctx = el.getContext('2d');
        if (!ctx) {
            this.dbgText = 'no ctx';
            return;
        }
        const W = this.cw;
        const H = this.ch;
        if (!(W > 0) || !(H > 0)) { return; }

        ctx.fillStyle = BG;
        ctx.fillRect(0, 0, W, H);

        try {
            if (mode === PLOT_MODE) {
                this.drawPlot(ctx, W);
            } else {
                this.drawEdit(ctx, W);
            }
        } catch (e) {
            this.dbgText = 'err ' + e;
        }
    },

    drawPlot(ctx, W) {
        const s = this.side();
        const ox = Math.floor((W - s) / 2);
        const oy = 58;
        const it = store.curItem();

        // 顶部标题带上「序号/总数」：切换曲线时数字变化，是 prev / next 生效的直接反馈
        const total = store.count();
        const ci = store.getCur();
        let head = HINT;
        if (it) {
            head = clip(it.text, 13) + '  ' + (ci + 1) + '/' + total;
        }
        // 基线 44（不是 30）：圆屏顶部收窄，20px 字形的上部若从 y=14 起会越出圆边，
        // 放到 y=28..49 这一段可用宽度才够放 18~20 个字符。
        ctx.font = '20px sans-serif';
        ctx.fillStyle = it ? FG : DIM;
        ctx.textAlign = 'center';
        ctx.fillText(head, W / 2, 44);

        // 二次函数特殊点：惰性计算（store 不依赖 poly）
        if (it && !it.quad) {
            try {
                const q = poly.quadInfo(poly.polyOf(it.ast));
                if (q) {
                    it.quad = q;
                    it.pts = plot.describeQuad(q);
                }
            } catch (e2) {
                it.quad = null;
            }
        }

        plot.draw(ctx, s, s, store.getList(), store.getCur(), ox, oy);

        if (it && it.pts) {
            ctx.font = '16px sans-serif';
            ctx.fillStyle = DIM;
            ctx.textAlign = 'center';
            ctx.fillText(clip(it.pts, 24), W / 2, oy + s + 21);
        }

        // 底部按钮 + 热区。尺寸按圆屏安全区反推：
        // 按钮行最外下角必须落在 r=233 圆内，否则两侧会被圆边裁掉、点不到。
        // 3x72 + 2x10 = 236 宽，by=oy+s+30 时最远角约 222.8，余量 10px。
        hotZones = [];
        const bw = 72;
        const bh = 42;
        const gap = 10;
        const bx = (W - (bw * 3 + gap * 2)) / 2;
        const by = oy + s + 30;
        const labels = ['<', '+', '>'];
        const acts = ['prev', 'add', 'next'];
        for (let i = 0; i < 3; i++) {
            const x = bx + i * (bw + gap);
            ctx.fillStyle = (acts[i] === 'add') ? BLUE : BTN;
            ctx.fillRect(x, by, bw, bh);
            ctx.fillStyle = FG;
            ctx.font = '24px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(labels[i], x + bw / 2, by + bh / 2 - 24 * 0.35);
            hotZones.push(x, by, bw, bh, acts[i]);
        }
    },

    drawEdit(ctx, W) {
        let txt = editText;
        let color = DIM;
        if (txt) {
            color = store.check(txt).ok ? FG : ERR;
        } else {
            txt = '输入 y= 右侧表达式';
        }
        if (editMsg) {
            txt = editMsg;
            color = ERR;
        }
        ctx.font = '24px sans-serif';
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.fillText(clip(txt, 20), W / 2, 30);

        const rows = fnPage ? keypad.FN_KEYS : keypad.MAIN_KEYS;
        hotZones = keypad.layout(rows, W, 60);
        if (editIdx >= 0) {
            for (let i = 4; i < hotZones.length; i += 5) {
                if (String(hotZones[i]) === '取消') { hotZones[i] = '删除'; }
            }
        }
        keypad.draw(ctx, W, this.ch, hotZones);
    },

    onTS(e) {
        if (e && typeof e.globalX === 'number') {
            startX = e.globalX;
            startY = e.globalY;
        }
    },

    onTE(e) {
        let gx = startX;
        let gy = startY;
        if (e && typeof e.globalX === 'number' && (e.globalX !== 0 || e.globalY !== 0)) {
            gx = e.globalX;
            gy = e.globalY;
        }
        // 以按下点判定更稳（抬起点可能被拖动带偏）
        this.dispatch(startX, startY);
    },

    onClick(e) {
        let gx = -1;
        let gy = -1;
        if (e) {
            if (typeof e.globalX === 'number') { gx = e.globalX; gy = e.globalY; }
            else if (typeof e.clientX === 'number') { gx = e.clientX; gy = e.clientY; }
            else if (typeof e.x === 'number') { gx = e.x; gy = e.y; }
            else if (typeof e.pageX === 'number') { gx = e.pageX; gy = e.pageY; }
        }
        if (gx >= 0) { this.dispatch(gx, gy); }
    },

    // 统一命中入口：touchend 与 click 都会走到这里，靠防抖去重
    dispatch(gx, gy) {
        const lbl = findHot(gx, gy);
        if (!lbl) { return; }
        const t = nowMs();
        if (lbl === lastKey && (t - lastAt) < 150) { return; }
        lastKey = lbl;
        lastAt = t;
        this.act(lbl);
    },

    act(a) {
        if (a === 'prev') { store.prev(); this.repaint(); return; }
        if (a === 'next') { store.next(); this.repaint(); return; }
        if (a === 'add') {
            mode = EDIT_MODE;
            editText = '';
            editMsg = '';
            editIdx = -1;
            fnPage = false;
            this.repaint();
            return;
        }
        if (a === '确定') { this.save(); return; }
        if (a === '取消') { mode = PLOT_MODE; editMsg = ''; this.repaint(); return; }
        if (a === '删除') {
            store.removeAt(editIdx);
            mode = PLOT_MODE;
            editMsg = '';
            editIdx = -1;
            this.repaint();
            return;
        }
        if (a === '退') {
            if (editText.length > 0) { editText = editText.substring(0, editText.length - 1); }
            editMsg = '';
            this.repaint();
            return;
        }
        if (a === '清') { editText = ''; editMsg = ''; this.repaint(); return; }
        if (a === '函数') { fnPage = true; this.repaint(); return; }
        if (a === '返回') { fnPage = false; this.repaint(); return; }

        const add = (CALLS.indexOf(a) >= 0) ? (a + '(') : a;
        if (editText.length + add.length > MAXLEN) { return; }
        editText = editText + add;
        editMsg = '';
        this.repaint();
    },

    save() {
        const r = store.check(editText);
        if (!r.ok) { editMsg = r.msg; this.repaint(); return; }
        const res = (editIdx >= 0) ? store.update(editIdx, editText) : store.add(editText);
        if (!res.ok) { editMsg = res.msg; this.repaint(); return; }
        mode = PLOT_MODE;
        editMsg = '';
        editIdx = -1;
        this.repaint();
    }
};