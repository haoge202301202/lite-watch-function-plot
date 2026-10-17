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

// 页面是单例、模块只加载一次，状态放模块级变量：
// 既避开「this 只能写 data 已声明字段」的限制，也避免 data 每次变化都做序列化。
const PLOT = 0;
const EDIT = 1;
let mode = PLOT;
let hotZones = [];
let editText = '';
let editMsg = '';
let editIdx = -1;
let fnPage = false;
let startX = 0;
let startY = 0;

function clip(s, n) {
    if (!s) { return ''; }
    return s.length > n ? (s.substring(0, n - 1) + '\u2026') : s;
}

export default {
    data: {
        cw: 454,
        ch: 454,
        dbgText: 'boot'
    },

    onInit() {
        const self = this;
        this.dbgText = 'onInit';
        mode = PLOT;
        hotZones = [];
        editText = '';
        editMsg = '';
        editIdx = -1;
        fnPage = false;
        try {
            Device.getInfo({
                success: function (info) {
                    if (info && info.windowWidth) {
                        self.cw = info.windowWidth;
                        self.ch = info.windowHeight || info.windowWidth;
                    }
                    self.render();
                },
                fail: function () {
                    self.render();
                }
            });
        } catch (e) {
            this.render();
        }
        try {
            store.load(function () {
                self.render();
            });
        } catch (e) {
            // storage 不可用也要能画
        }
    },

    onReady() {
        this.dbgText = 'onReady';
        this.render();
    },

    onShow() {
        this.dbgText = 'onShow';
        this.render();
    },

    // 绘图区边长：留出顶部标题与底部按钮
    side() {
        let s = this.cw - 60;
        const lim = this.ch - 160;
        if (s > lim) { s = lim; }
        if (s > 300) { s = 300; }
        if (s < 120) { s = 120; }
        return Math.floor(s);
    },

    render() {
        // onInit 阶段整个 $refs 还是 undefined，必须先判空
        if (!this.$refs) {
            this.dbgText = 'no refs';
            return;
        }
        /** @type {any} */
        const el = this.$refs.cv;
        if (!el || !el.getContext) { return; }
        const ctx = el.getContext('2d');
        if (!ctx) {
            this.dbgText = 'no ctx';
            return;
        }
        const W = this.cw;
        const H = this.ch;
        if (!(W > 0) || !(H > 0)) {
            this.dbgText = 'bad size ' + W + ',' + H;
            return;
        }
        this.dbgText = 'draw m' + mode + ' ' + W + 'x' + H;

        ctx.fillStyle = BG;
        ctx.fillRect(0, 0, W, H);

        try {
            if (mode === PLOT) {
                this.renderPlot(ctx, W);
            } else {
                this.renderEdit(ctx, W);
            }
        } catch (e) {
            this.dbgText = 'ERR ' + e;
            ctx.fillStyle = ERR;
            ctx.font = '16px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('err: ' + e, W / 2, H / 2);
        }
    },

    renderPlot(ctx, W) {
        const s = this.side();
        const ox = Math.floor((W - s) / 2);
        const oy = 54;
        const it = store.curItem();

        ctx.font = '20px sans-serif';
        ctx.fillStyle = it ? FG : DIM;
        ctx.textAlign = 'center';
        ctx.fillText(it ? clip(it.text, 18) : HINT, W / 2, 30);

        // 惰性计算二次函数特殊点（store 不依赖 poly）
        if (it && !it.quad) {
            const q = poly.quadInfo(poly.polyOf(it.ast));
            if (q) {
                it.quad = q;
                it.pts = plot.describeQuad(q);
            }
        }

        plot.draw(ctx, s, s, store.getList(), store.getCur(), ox, oy);

        if (it) {
            const pts = it.pts ? clip(it.pts, 24) : '非二次函数';
            ctx.font = '16px sans-serif';
            ctx.fillStyle = DIM;
            ctx.textAlign = 'center';
            ctx.fillText(pts, W / 2, oy + s + 26);
        }

        hotZones = [];
        const bw = 76;
        const bh = 44;
        const gap = 12;
        const bx = (W - (bw * 3 + gap * 2)) / 2;
        const by = oy + s + 40;
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

    renderEdit(ctx, W) {
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
        keypad.draw(ctx, W, H, hotZones);
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
        this.hitAt(gx, gy);
    },

    hitAt(gx, gy) {
        for (let i = 0; i + 4 < hotZones.length; i += 5) {
            if (gx >= hotZones[i] && gx <= hotZones[i] + hotZones[i + 2] &&
                gy >= hotZones[i + 1] && gy <= hotZones[i + 1] + hotZones[i + 3]) {
                this.act(String(hotZones[i + 4]));
                return;
            }
        }
    },

    act(a) {
        if (a === 'prev') { store.prev(); this.render(); return; }
        if (a === 'next') { store.next(); this.render(); return; }
        if (a === 'add') {
            mode = EDIT;
            editText = '';
            editMsg = '';
            editIdx = -1;
            fnPage = false;
            this.render();
            return;
        }
        if (a === '确定') { this.save(); return; }
        if (a === '取消') { mode = PLOT; editMsg = ''; this.render(); return; }
        if (a === '删除') {
            store.removeAt(editIdx);
            mode = PLOT;
            editMsg = '';
            editIdx = -1;
            this.render();
            return;
        }
        if (a === '退') {
            if (editText.length > 0) { editText = editText.substring(0, editText.length - 1); }
            editMsg = '';
            this.render();
            return;
        }
        if (a === '清') { editText = ''; editMsg = ''; this.render(); return; }
        if (a === '函数') { fnPage = true; this.render(); return; }
        if (a === '返回') { fnPage = false; this.render(); return; }

        const add = (CALLS.indexOf(a) >= 0) ? (a + '(') : a;
        if (editText.length + add.length > MAXLEN) { return; }
        editText = editText + add;
        editMsg = '';
        this.render();
    },

    save() {
        const r = store.check(editText);
        if (!r.ok) { editMsg = r.msg; this.render(); return; }
        const res = (editIdx >= 0) ? store.update(editIdx, editText) : store.add(editText);
        if (!res.ok) { editMsg = res.msg; this.render(); return; }
        mode = PLOT;
        editMsg = '';
        editIdx = -1;
        this.render();
    }
};