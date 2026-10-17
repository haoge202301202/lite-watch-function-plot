import Device from '@system.device';
import store from '../../common/store';
import poly from '../../common/poly';
import plot from '../../common/plot';
import keypad from '../../common/keypad';
import settings from '../../common/settings';

const BG = '#0B0F14';
const FG = '#EDF2F8';
const DIM = '#94A5BB';
// 弱化文字：原来用的 #4A5A6E 在深底上几乎看不见（右下角「±8」就是这个问题），提亮两档
const MUTED = '#7A8CA6';
const ERR = '#F07272';
const BLUE = '#2E7DF6';
const BTN = '#1C2634';
// Lite canvas 没有圆角 / 阴影 / 渐变，一整片纯色矩形在深色底上会显得很平；
// 用顶部 1px 高光 + 底部 1px 暗边这两条像素线把层次做出来。
const BTN_HL = '#2B3A4D';
const BTN_SH = '#111925';
const BLUE_HL = '#5AA0FF';
const BLUE_SH = '#1B5FCB';
// 绘图区描边色：比网格亮一点，用来把坐标系和页面背景分开
const PANEL = '#223143';
const CARD = { bg: BTN, hl: BTN_HL, sh: BTN_SH };
const CARD_BLUE = { bg: BLUE, hl: BLUE_HL, sh: BLUE_SH };
// 到档位尽头时的压暗底色
const CARD_DEAD = '#151D28';
// 已平移时视野提示的高亮色
const PANNED_ON = '#6BA6E8';
// 字体串全部提成常量：它们每次重绘都要赋给 ctx.font，
// 若每次都写字面量，引擎每帧都会新建一批字符串 —— 反复缩放/平移时这就是垃圾大户。
const FONT_14 = '14px HarmonyOS Sans';
const FONT_20 = '20px HarmonyOS Sans';
const FONT_22 = '22px HarmonyOS Sans';
const FONT_26 = '26px HarmonyOS Sans';
const FONT_28 = '28px HarmonyOS Sans';

// 统一卡片：主体 + 底部 1px 暗边。
// 原本还有一条顶部高光线，为了压绘制量去掉了 —— 每张卡片少一次 fillRect，
// 保留暗边已经够做出"浮起"的层次。
function card(ctx, x, y, w, h, style) {
    const st = style || CARD;
    ctx.fillStyle = st.bg;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = st.sh;
    ctx.fillRect(x, y + h - 1, w, 1);
}

// 表达式显示美化：x^2 -> x²。只在显示层转换，解析与存储仍然是原来的 ASCII 写法。
const SUP = ['\u2070', '\u00B9', '\u00B2', '\u00B3', '\u2074',
    '\u2075', '\u2076', '\u2077', '\u2078', '\u2079'];
function prettyExpr(s) {
    if (!s) { return s; }
    let out = '';
    for (let i = 0; i < s.length; i++) {
        const c = s.charAt(i);
        if (c === '^' && i + 1 < s.length) {
            const d = s.charAt(i + 1);
            if (d >= '0' && d <= '9') {
                out += SUP[parseInt(d, 10)];
                i++;
                continue;
            }
        }
        out += c;
    }
    return out;
}
const MAXLEN = 30;
const HINT = '点 + 添加函数';
// 可视半宽档位（世界单位）：数值越大视野越广。默认 ±8（ZOOM_BASE）。
// 单次步进保持原来的 1.33~1.5 倍节奏（不改手感），只把两端各扩几档：
// 下调到 ±0.5 以便放大看顶点/交点附近的局部曲率；上调到 ±48 以便看整体走势。
// 不再放到 ±64 以上：那时每个采样点跨度超过 0.5 个世界单位，sin/tan 会明显欠采样成锯齿。
// 收紧过的档位：两端极端值已去掉 ——
//   ±0.5 放大过度，网格/刻度会挤成一团；
//   ±32 / ±48 缩得太远，采样点间距超过 1 个世界单位，sin/tan 直接成锯齿。
// 现在 ±1 … ±24，默认 ±8（index 6）。
const ZOOMS = [1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24];
const ZOOM_BASE = 6;
// 缩放键的动作名与符号（顺序：先「-」后「+」）
const Z_ACT = ['zoomout', 'zoomin'];
const Z_LBL = ['-', '+'];
// 右下角的视野提示文字预先拼好，重绘时直接取用，不再拼字符串
const ZOOM_TXT = [];
const ZOOM_TXT_PAN = [];
for (let zi = 0; zi < ZOOMS.length; zi++) {
    ZOOM_TXT.push('±' + ZOOMS[zi]);
    ZOOM_TXT_PAN.push('±' + ZOOMS[zi] + ' 已移');
}
// 24px 字形在按钮内垂直居中的基线偏移量。
// 底部主按钮与缩放键必须共用这一个常量：两处曾各写各的（一处 -24*0.35、一处 +9），
// 导致缩放键的 +/- 整体下坠约 17px，看起来像"符号掉到了按钮边缘外"。
const FONT_MID = -24 * 0.35;
// 滑动平移相关：DRAG_MIN 是判定"拖动"而非"点击"的累计位移阈值（像素），
// 低于它的抖动一律当点击处理，否则按按钮时手指微动就会把视图带跑。
const DRAG_MIN = 8;
// 编辑页顶部「表达式回显」那一条横带的上下界（canvas 没有 clearRect，只能整条重铺底色）。
// 基线在 y=72、22px 字形约 54..79，所以 52 起、38 高足以盖干净；
// 键盘首行从 y=107 起，横带不会碰到键。
const INPUT_TOP = 52;
const INPUT_H = 38;
// 平移上限（世界单位）：防止滑太远之后彻底迷路。
const PAN_LIMIT = 160;
const CALLS = ['sin', 'cos', 'tan', 'ln', 'lg', 'log2',
    'asin', 'acos', 'atan', 'sqrt', 'abs', 'exp'];

// 状态放模块级变量：既避开「this 只能写 data 已声明字段」的限制，
// 也避免 data 变化触发序列化。
const PLOT_MODE = 0;
const EDIT_MODE = 1;
const HOME_MODE = 2;
const SETTINGS_MODE = 3;
// 绘图区在**任何时刻只画一条曲线**（「全部同屏」已按要求整体移除）。
// 这两个数组就是传给 plot.draw 的曲线列表本身，复用它们，
// 避免每次重绘都新建数组 —— 重绘很频繁，垃圾少一点，64KB 堆就多一分余量。
const ONE = [null];
const NONE = [];
// 启动先进开始界面，由用户选择「进入绘图」或「设置」
let mode = HOME_MODE;
let hotZones = [];
let editText = '';
let editMsg = '';
let editIdx = -1;
let fnPage = false;
// 缩放状态与其它界面状态一样放模块级变量，不写 this（受限 ViewModel）
let zoomIdx = ZOOM_BASE;
// 左右键切换「显示哪一条曲线」的状态就是 store 里的 cur，
// 不再单独维护一份焦点下标 —— 两份状态曾经不一致，是真机上一个隐蔽的坑。
// 视图中心的世界坐标：滑动平移改这两个值；点绘图区空白处归位
let viewCx = 0;
let viewCy = 0;
// 拖动识别
let dragValid = false;
let dragLastX = 0;
let dragLastY = 0;
let dragging = false;
let suppressClick = false;
let startX = 0;
let startY = 0;
// 防抖：同一次点击会先派发 touchend、再派发 click，
// 用「键名 + 时间窗」去重，避免一次点击输入两个字符。
let lastKey = '';
let lastAt = 0;
// 编辑页每帧都要判断表达式是否合法，但只有文本变了才需要重新解析。
// 缓存上一次的文本与结论，避免每次按键都跑一遍词法 + 语法分析。
let okText = '';
let okFlag = true;

// 本应用**没有任何动画与定时器**。
// 轻手表的 JS 引擎在 64KB 堆上跑 setInterval 驱动的整屏重绘很容易被压垮：
// 每次重绘都要重新求值全部曲线，几帧之内就可能触发 OOM 或看门狗。
// 现在所有交互都是"操作一次、重绘一次"，没有常驻定时器，onHide/onDestroy 也无定时器可清。

// 绘图页的重绘推迟到事件回调返回之后执行。
// 真机实测规律：键盘页（27 个矩形 + 27 个文字）在点击回调里直接重绘从不崩；
// 绘图页（路径绘制 + 曲线 + 标注）在触摸/点击回调里直接重绘就会崩。
// 差异不在调用次数，而在"复杂绘制发生在事件回调里"这件事本身。
// 这里用 0 毫秒的一次性定时器把绘制挪出回调，不是轮询、也不会常驻。
let deferTimer = null;

function cancelDefer() {
    if (deferTimer !== null) {
        clearTimeout(deferTimer);
        deferTimer = null;
    }
}

// 字号 -> 文字在矩形内垂直居中所需的基线偏移。
// 早先各处手写偏移（一处 -24*0.35、一处 +9，方向相反）曾让符号整体下坠约 17px，
// 新增文字统一走这个函数，避免同类问题再出现。
function vMid(fs) {
    return -fs * 0.35;
}

// 画布边长必须落在合理区间：
//   低于 200 排不下现有布局；
//   高于 480 说明拿到的多半不是逻辑像素（某些固件返回物理像素），
//   那样画布会远大于屏幕，绘制坐标与绘制量都会按面积放大 —— 直接夹住。
function clampSize(v) {
    const n = Math.floor(v);
    if (!(n > 0)) { return 0; }
    if (n < 200) { return 200; }
    if (n > 480) { return 480; }
    return n;
}

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

// 平移量夹紧：NaN（比如没拿到画布边长）一律归零，避免污染坐标系
function clampPan(v) {
    if (typeof v !== 'number' || !isFinite(v)) { return 0; }
    if (v > PAN_LIMIT) { return PAN_LIMIT; }
    if (v < -PAN_LIMIT) { return -PAN_LIMIT; }
    return v;
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
    onHide() {
        cancelDefer();
    },

    onDestroy() {
        cancelDefer();
    },

    onShow() {
        mode = HOME_MODE;
        editMsg = '';
        this.repaint();
        this.boot();
    },

    boot() {
        const self = this;
        try {
            Device.getInfo({
                success: function (info) {
                    if (info && info.windowWidth > 0) {
                        const w = clampSize(info.windowWidth);
                        const h = clampSize(info.windowHeight || info.windowWidth);
                        if (w > 0 && h > 0) {
                            self.cw = w;
                            self.ch = h;
                        }
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
        try {
            settings.load(function () {
                self.repaint();
            });
        } catch (e) {
            // 设置读不出来就沿用默认外观
        }
    },

    // 绘图区边长：留出顶部标题与底部按钮，并保证正方形四角落在 r=233 圆内。
    // 四角到圆心距离 = sqrt((s/2)^2 + (233 - oy)^2)，466 屏上 s=292、oy=58 时约 227.9。
    side() {
        let s = this.cw - 60;
        const lim = this.ch - 162;
        if (s > lim) { s = lim; }
        if (s > 304) { s = 304; }
        if (s < 120) { s = 120; }
        return Math.floor(s);
    },

    // 绘图页的重绘推迟到当前事件回调返回之后执行。
    // 实测规律：键盘页在点击回调里直接重绘从不崩，绘图页（路径 + 曲线 + 标注）
    // 在触摸/点击回调里直接重绘就会崩 —— 差异不在调用次数，而在"复杂绘制发生在回调里"。
    // 0ms 一次性定时器，不轮询、不常驻；onHide/onDestroy 会清掉。
    repaintDeferred() {
        // 已经有一次重绘在排队：不再重排，让它照常执行。
        // 重绘时读的全是模块级最新状态（mode / zoomIdx / viewCx…），
        // 所以一次重绘就等价于「把此前所有请求合并」。连续点缩放时这一条直接把
        // 重绘次数从「一次点击一次」压到「一帧一次」。
        if (deferTimer !== null) { return; }
        const self = this;
        deferTimer = setTimeout(function () {
            deferTimer = null;
            self.repaint();
            // 阶段标记只在「重绘顺利返回」之后才清掉，而且写在定时器回调里、
            // 不在画布的绘制路径上 —— 在 Lite 上传写 ViewModel 会触发 text 组件重新布局，
            // 夹在 canvas 绘制中间是自找麻烦。
            // 真机上若崩在某一步，这个清空语句根本执行不到，标记就留在屏幕上。
            const d = self.dbgText;
            if (d && d.indexOf('保存') === 0) { self.dbgText = ''; }
        }, 0);
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
            } else if (mode === EDIT_MODE) {
                this.drawEdit(ctx, W);
            } else if (mode === SETTINGS_MODE) {
                this.drawSettings(ctx, W);
            } else {
                this.drawHome(ctx, W);
            }
        } catch (e) {
            this.dbgText = 'err ' + e;
        }
    },

    drawPlot(ctx, W) {
        const s = this.side();
        const ox = Math.floor((W - s) / 2);
        const oy = 66;

        // 画面里始终只有一条曲线。(store 的 cur) 决定画哪一条，
        // 左右键改的就是 cur，于是按键 = 换一条曲线看它的图像和顶点/交点。
        const total = store.count();
        const ci = store.getCur();
        const list = store.getList();
        const it = (ci >= 0 && ci < list.length) ? list[ci] : null;

        // 顶部标题就是左右键是否生效的直接反馈：「表达式 + 序号/总数」。
        // 结果缓存在曲线记录上（headKey 变了才重算）：
        // 反复缩放/平移时标题一个字都不会变，没必要每帧都做 prettyExpr + 字符串拼接。
        let head = HINT;
        if (it) {
            const sk = (ci + 1) * 100 + total;
            if (it.headKey !== sk) {
                it.headKey = sk;
                if (!it.short) { it.short = clip(prettyExpr(it.text), 13); }
                it.headTxt = it.short + '  ' + (ci + 1) + '/' + total;
            }
            head = it.headTxt;
        }
        // 基线 44（不是 30）：圆屏顶部收窄，20px 字形的上部若从 y=14 起会越出圆边，
        // 放到 y=28..49 这一段可用宽度才够放 18~20 个字符。
        ctx.font = FONT_20;
        ctx.fillStyle = it ? FG : DIM;
        ctx.textAlign = 'center';
        ctx.fillText(head, W / 2, 42);

        // 二次函数特殊点：惰性计算（store 不依赖 poly），每条只算一次（quadDone）。
        for (let qi = 0; qi < list.length; qi++) {
            const qf = list[qi];
            if (qf && qf.ast && !qf.quadDone) {
                qf.quadDone = true;
                try {
                    const q = poly.quadInfo(poly.polyOf(qf.ast));
                    if (q) {
                        qf.quad = q;
                        qf.pts = plot.describeQuad(q);
                    }
                } catch (e2) {
                    qf.quad = null;
                }
                // 多项式分析只做这一次；之后绘图全走编译好的 fn，AST 可以释放掉，
                // 每条曲线省下十几个对象 —— 64KB 堆上这点很值。
                qf.ast = null;
            }
        }

        // 只把「当前这一条」交给绘图模块 —— 画面里只出现一条函数图像。
        // 其余曲线仍然保存在 store 里，左右键一按就换过来。
        const opt = settings.snapshot();
        if (it) {
            ONE[0] = it;
            plot.draw(ctx, s, s, ONE, 0, ox, oy, ZOOMS[zoomIdx], viewCx, viewCy, opt);
        } else {
            plot.draw(ctx, s, s, NONE, -1, ox, oy, ZOOMS[zoomIdx], viewCx, viewCy, opt);
        }

        // 绘图区描边：把坐标系和页面背景分开。
        // 必须画在 plot.draw 之后 —— 它内部的 clear() 按 OX/OY 铺了整块底色，会盖掉先画的东西。
        ctx.fillStyle = PANEL;
        ctx.fillRect(ox, oy, s, 1);
        ctx.fillRect(ox, oy + s - 1, s, 1);
        ctx.fillRect(ox, oy, 1, s);
        ctx.fillRect(ox + s - 1, oy, 1, s);

        // 底部摘要：当前这条曲线（若为二次函数）的完整特殊点（最值 / 交点 / 截距）。
        // 基线 oy+s+14、字号 14px：
        //   与绘图区底边(oy+s)留 2~3px，与按钮行顶边(oy+s+22)留 5px。
        // 之前是 16px / oy+s+18，字的下沿正好压在按钮上被盖住。
        if (it && it.pts) {
            ctx.font = FONT_14;
            ctx.fillStyle = DIM;
            ctx.textAlign = 'center';
            ctx.fillText(clip(it.pts, 24), W / 2, oy + s + 14);
        }

        hotZones.length = 0;

        // 绘图区上角：左上角「返」回开始界面，右上角两个缩放。
        // 尺寸从 42x34 放大到 58x44 / 46x38 —— 原来的「返」在 466 圆屏上只有 9mm 宽，
        // 手指根本点不准。放大后四角仍在 r=233 的圆内（最远角 220.2 / 217.5，余量 12.8 / 15.5px）。
        const zby = oy + 4;
        const retW = 58;
        const retH = 44;
        card(ctx, ox + 4, zby, retW, retH, CARD);
        ctx.fillStyle = FG;
        ctx.font = FONT_26;
        ctx.textAlign = 'center';
        ctx.fillText('返', ox + 4 + retW / 2, zby + retH / 2 + vMid(26));
        hotZones.push(ox + 4, zby, retW, retH, 'home');

        const zbw = 46;
        const zbh = 40;
        for (let z = 0; z < 2; z++) {
            const zx = ox + s - 8 - zbw - z * (zbw + 6);
            const dead = (z === 0) ? (zoomIdx >= ZOOMS.length - 1) : (zoomIdx <= 0);
            if (dead) {
                // 到档位尽头的键只画一个压暗的底，视觉上就是"按不动"
                ctx.fillStyle = CARD_DEAD;
                ctx.fillRect(zx, zby, zbw, zbh);
            } else {
                card(ctx, zx, zby, zbw, zbh, CARD);
            }
            ctx.fillStyle = dead ? MUTED : FG;
            ctx.font = FONT_28;
            ctx.textAlign = 'center';
            ctx.fillText(Z_LBL[z], zx + zbw / 2, zby + zbh / 2 + vMid(28));
            hotZones.push(zx, zby, zbw, zbh, Z_ACT[z]);
        }

        // 绘图区右下角标出当前视野半宽；已平移时换高亮色并加"已移"，提示视图偏离了原点。
        // 文字串在模块初始化时就全部拼好（ZOOM_TXT / ZOOM_TXT_PAN），
        // 每次重绘不再产生任何新字符串 —— 反复缩放最忌讳这种每帧垃圾。
        const panned = (viewCx !== 0 || viewCy !== 0);
        ctx.font = FONT_14;
        ctx.fillStyle = panned ? PANNED_ON : MUTED;
        ctx.textAlign = 'right';
        ctx.fillText(panned ? ZOOM_TXT_PAN[zoomIdx] : ZOOM_TXT[zoomIdx],
            ox + s - 6, oy + s - 6);

        // 底部按钮 + 热区。尺寸按圆屏安全区反推：
        // 按钮行最外下角必须落在 r=233 圆内，否则两侧会被圆边裁掉、点不到。
        // 绘图区放大到 304 后底部空间变窄：3x66 + 2x10 = 218 宽，by=oy+s+22 时最远角约 228.7，余量 4.3px。
        const bw = 66;
        const bh = 42;
        const gap = 10;
        const bx = (W - (bw * 3 + gap * 2)) / 2;
        const by = oy + s + 22;
        const labels = ['<', '+', '>'];
        const acts = ['prev', 'add', 'next'];
        for (let i = 0; i < 3; i++) {
            const x = bx + i * (bw + gap);
            card(ctx, x, by, bw, bh, (acts[i] === 'add') ? CARD_BLUE : CARD);
            ctx.fillStyle = FG;
            ctx.font = '24px HarmonyOS Sans';
            ctx.textAlign = 'center';
            ctx.fillText(labels[i], x + bw / 2, by + bh / 2 + FONT_MID);
            hotZones.push(x, by, bw, bh, acts[i]);
        }

        // 绘图区本身作为「归位」热区，放在最后：findHot 按顺序匹配，
        // 上面的缩放键与底部按钮会先命中，落到这里的才是真正的空白处点击。
        hotZones.push(ox, oy, s, s, 'recenter');
    },

    // 开始界面：两个大按钮（进入绘图 / 设置）
    drawHome(ctx, W) {
        hotZones.length = 0;

        // 装饰抛物线已移除：画它要 140 次 lineTo + 一次 stroke，
        // 只为一个纯装饰效果不值得，真机上每次重绘都在为它买单。
        ctx.textAlign = 'center';
        ctx.fillStyle = FG;
        ctx.font = '32px HarmonyOS Sans';
        ctx.fillText('函数绘图', W / 2, 84);
        // 副标题：一句话说清这是什么，顺便把标题区和按钮区隔开
        ctx.fillStyle = MUTED;
        ctx.font = '15px HarmonyOS Sans';
        ctx.fillText('高中数学函数图像', W / 2, 112);

        // 变量名带 h 前缀，与 drawPlot 的 bw/bh 区分开（自测按名字正则提取几何参数）
        const hbw = 280;
        const hbh = 88;
        const hbx = (W - hbw) / 2;
        const hys = [146, 254];
        const labels = ['进入绘图', '设置'];
        const acts = ['gotoPlot', 'gotoSettings'];
        for (let i = 0; i < 2; i++) {
            card(ctx, hbx, hys[i], hbw, hbh, (i === 0) ? CARD_BLUE : CARD);
            ctx.fillStyle = FG;
            ctx.font = '28px HarmonyOS Sans';
            ctx.textAlign = 'center';
            ctx.fillText(labels[i], W / 2, hys[i] + hbh / 2 + vMid(28));
            hotZones.push(hbx, hys[i], hbw, hbh, acts[i]);
        }

        // 「进入绘图时」开关：左标签 + 右取值，整行可点，点一下换下一个值。
        // 它和设置页里的「保留上次函数」是同一项（都读 settings），两边改哪边都一样。
        const kbh = 44;
        const kby = 356;
        card(ctx, hbx, kby, hbw, kbh, CARD);
        const keepIdx = settings.indexOf('keepLast');
        ctx.fillStyle = DIM;
        ctx.font = '19px HarmonyOS Sans';
        ctx.textAlign = 'left';
        ctx.fillText('进入绘图时', hbx + 16, kby + kbh / 2 + vMid(19));
        ctx.fillStyle = FG;
        ctx.textAlign = 'right';
        ctx.fillText(settings.textOf(keepIdx), hbx + hbw - 40, kby + kbh / 2 + vMid(19));
        ctx.fillStyle = MUTED;
        ctx.fillText('>', hbx + hbw - 18, kby + kbh / 2 + vMid(19));
        hotZones.push(hbx, kby, hbw, kbh, 'set' + keepIdx);

        // 诊断：显示实际拿到的画布尺寸。用来确认 Device.getInfo 的 windowWidth
        // 到底是逻辑像素还是物理像素 —— 明显偏大就说明画布画到了屏幕之外。
        ctx.fillStyle = MUTED;
        ctx.font = '14px HarmonyOS Sans';
        ctx.textAlign = 'center';
        ctx.fillText('画布 ' + W + ' × ' + this.ch, W / 2, 434);
    },

    // 设置界面：逐行列出，点一行就切到下一个取值
    drawSettings(ctx, W) {
        hotZones.length = 0;

        ctx.textAlign = 'center';
        ctx.fillStyle = FG;
        ctx.font = '28px HarmonyOS Sans';
        ctx.fillText('设置', W / 2, 70);

        // 去掉「动画级别」后回到 6 项，行高从 43 放宽到 48（末行底边 380，返回键 388..428）
        const srw = 300;
        const srh = 48;
        const srx = (W - srw) / 2;
        const sry0 = 92;
        const n = settings.count();
        for (let i = 0; i < n; i++) {
            const y = sry0 + i * srh;
            card(ctx, srx, y + 3, srw, srh - 6, CARD);

            ctx.fillStyle = FG;
            ctx.font = '18px HarmonyOS Sans';
            ctx.textAlign = 'left';
            ctx.fillText(settings.ITEMS[i].label, srx + 16, y + srh / 2 + vMid(18));

            ctx.fillStyle = DIM;
            ctx.textAlign = 'right';
            // 值右边缘留到 -38，给箭头留 16px 空隙；之前只留 14px，两者几乎贴在一起
            ctx.fillText(settings.textOf(i), srx + srw - 38, y + srh / 2 + vMid(18));
            // 右侧的小箭头：提示「这一行可以点」，否则纯文字行看不出是可交互的
            ctx.fillStyle = MUTED;
            ctx.textAlign = 'right';
            ctx.fillText('>', srx + srw - 16, y + srh / 2 + vMid(18));

            hotZones.push(srx, y, srw, srh, 'set' + i);
        }

        const obw = 120;
        const obh = 40;
        const obx = (W - obw) / 2;
        const oby = sry0 + n * srh + 8;
        card(ctx, obx, oby, obw, obh, CARD);
        ctx.fillStyle = FG;
        ctx.font = '22px HarmonyOS Sans';
        ctx.textAlign = 'center';
        ctx.font = '20px HarmonyOS Sans';
        ctx.textAlign = 'center';
        ctx.fillText('返回', W / 2, oby + obh / 2 + vMid(20));
        hotZones.push(obx, oby, obw, obh, 'home');
    },

    // 顶部表达式回显。单独抽出来有两个理由：
    //  ① 整页重绘（drawEdit）和「只改一行字」的单键重绘（repaintInput）都要用它；
    //  ② 敲一个键时只有这一行文字变了，键盘本身没变 —— 只重画这一条横带
    //     是 fillRect + fillText 共 3 次 canvas 调用，而整页重绘要 56 次。
    //     「在点击回调里做整屏 canvas 绘制」正是真机上崩溃的来源，能少一次就少一次。
    drawInput(ctx, W) {
        // 先用页面底色铺一条横带盖掉上一行（canvas 没有 clearRect）。
        // 上下界都要包住 22px 字形：基线 72、字形约 54..79；键盘首行从 107 起，不会误伤。
        ctx.fillStyle = BG;
        ctx.fillRect(0, INPUT_TOP, W, INPUT_H);

        let txt = '';
        let color = DIM;
        if (editMsg) {
            txt = editMsg;
            color = ERR;
        } else if (!editText) {
            txt = '输入 y = 右侧表达式';
        } else {
            // 带上 y= 前缀，和最终存下来的形式一致；非法时整串变红
            txt = 'y = ' + editText;
            if (editText !== okText) {
                okText = editText;
                okFlag = store.check(editText).ok;
            }
            color = okFlag ? FG : ERR;
        }
        // 超长时保留尾部而不是头部：用户刚敲的字符在后半段，截掉开头才看得见自己在打什么
        if (txt.length > 20) { txt = '\u2026' + txt.substring(txt.length - 19); }
        ctx.font = FONT_22;
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.fillText(txt, W / 2, 72);
    },

    // 只重画顶部表达式区。敲键时走这条路径，绝不整页重绘。
    repaintInput() {
        if (!this.$refs) { return; }
        const el = this.$refs.cv;
        if (!el || !el.getContext) { return; }
        const ctx = el.getContext('2d');
        if (!ctx) { return; }
        const W = this.cw;
        if (!(W > 0) || !(this.ch > 0)) { return; }
        try {
            this.drawInput(ctx, W);
        } catch (e) {
            this.dbgText = 'err ' + e;
        }
    },

    drawEdit(ctx, W) {
        this.drawInput(ctx, W);

        const rows = fnPage ? keypad.FN_KEYS : keypad.MAIN_KEYS;
        // topY=100：键盘若从 y=60 起，第一行四角距圆心约 251px，超出 r=233 的圆屏会被裁掉
        hotZones = keypad.layout(rows, W, 100);
        if (editIdx >= 0) {
            for (let i = 4; i < hotZones.length; i += 5) {
                if (String(hotZones[i]) === '取消') { hotZones[i] = '删除'; }
            }
        }
        keypad.draw(ctx, W, this.ch, hotZones);
    },

    // 左右键：在当前曲线列表里循环切换「标特殊点的那一条」。
    //
    // 只有 1 条（或 0 条）时直接返回、不重绘 —— 切不出别的东西，
    // 白白触发一次全量重绘反而是真机上最容易压垮绘制管线的多余动作。
    shiftFocus(dir) {
        if (store.count() < 2) { return; }
        if (dir > 0) { store.next(); } else { store.prev(); }
        this.repaintDeferred();
    },

    onTS(e) {
        dragValid = false;
        dragging = false;
        if (e && typeof e.globalX === 'number') {
            startX = e.globalX;
            startY = e.globalY;
            dragLastX = e.globalX;
            dragLastY = e.globalY;
            dragValid = true;
        }
    },

    // 滑动平移：只在绘图模式生效。累计位移超过 DRAG_MIN 才认为在拖动，
    // 否则按按钮时手指的细微抖动会把视图带跑。
    onTM(e) {
        if (mode !== PLOT_MODE || !dragValid) { return; }
        if (!e || typeof e.globalX !== 'number') { return; }
        const dx = e.globalX - dragLastX;
        const dy = e.globalY - dragLastY;
        dragLastX = e.globalX;
        dragLastY = e.globalY;
        // 判定用「相对按下点的位移」，而不是累加路径长度：
        // 手指在按钮上抖动几下再回到原处，累加值会超标从而把点击误判成拖动，按钮就静默失效了。
        const moved = Math.abs(e.globalX - startX) + Math.abs(e.globalY - startY);
        if (moved < DRAG_MIN) { return; }
        if (!dragging) {
            dragging = true;
            // 视觉反馈走 HML 的 text 组件，不碰 canvas。
            // 实测 touchmove 回调里只要发生 canvas 绘制，画好曲线后平移必崩 —— 一次也不行。
            this.dbgText = '平移中… 松开手指生效';
        }
        const s = this.side();
        if (!(s > 0)) { return; }
        // 手指右移 => 图像右移 => 视图中心左移；屏幕 y 向下而世界 y 向上，故 y 取反
        const k = 2 * ZOOMS[zoomIdx] / s;
        viewCx = clampPan(viewCx - dx * k);
        viewCy = clampPan(viewCy + dy * k);
        // touchmove 期间这里**一次 canvas 绘制都没有**，只做纯算术累加。
        // 真机实测：只要在 touchmove 回调里画 canvas，画好曲线后平移必崩；
        // 提示文字改走 HML 的 text 组件（上面的 dbgText），完全不碰 canvas。
        // 视图真正的重绘只在 onTE（松手）发生一次。
    },

    onTE(e) {
        if (dragging) {
            dragging = false;
            suppressClick = true;   // 拖动过就不再当点击处理，避免误触按钮
            this.dbgText = '';      // 清掉「平移中…」提示
            this.repaintDeferred(); // 整个手势里唯一的一次 canvas 绘制
            return;
        }
        // 以按下点判定更稳（抬起点可能被拖动带偏）
        this.dispatch(startX, startY);
    },

    onClick(e) {
        if (suppressClick) { suppressClick = false; return; }
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
        if (a === 'gotoPlot') {
            // 开关决定「每次重来」还是「接着上次」：
            //   每次重来 —— 清空函数并把缩放/平移/焦点一起复位；
            //   接着上次 —— 原样恢复（函数列表本来就写在 storage 里，跨会话也在）。
            if (settings.snapshot().keepLast !== 1) {
                store.clearAll();
                viewCx = 0;
                viewCy = 0;
                zoomIdx = ZOOM_BASE;
            }
            mode = PLOT_MODE;
            this.repaintDeferred();
            return;
        }
        if (a === 'gotoSettings') {
            mode = SETTINGS_MODE;
            this.repaintDeferred();
            return;
        }
        if (a === 'home') {
            mode = HOME_MODE;
            this.repaintDeferred();
            return;
        }
        // 设置项：动作名形如 set0 / set1 / set2 / set3
        if (a.length === 4 && a.substring(0, 3) === 'set') {
            const k = parseInt(a.substring(3), 10);
            if (!isNaN(k)) {
                settings.next(k);
                this.repaintDeferred();
            }
            return;
        }
        if (a === 'recenter') {
            if (viewCx !== 0 || viewCy !== 0) {
                viewCx = 0;
                viewCy = 0;
                this.repaintDeferred();
            }
            return;
        }
        if (a === 'zoomin') {
            if (zoomIdx > 0) { zoomIdx = zoomIdx - 1; this.repaintDeferred(); }
            return;
        }
        if (a === 'zoomout') {
            if (zoomIdx < ZOOMS.length - 1) { zoomIdx = zoomIdx + 1; this.repaintDeferred(); }
            return;
        }
        if (a === 'prev') { this.shiftFocus(-1); return; }
        if (a === 'next') { this.shiftFocus(1); return; }
        if (a === 'add') {
            mode = EDIT_MODE;
            editText = '';
            editMsg = '';
            editIdx = -1;
            fnPage = false;
            this.repaintDeferred();
            return;
        }
        if (a === '确定') { this.save(); return; }
        // 取消 / 删除要换回绘图页，整页重绘走延迟（不在点击回调里直接画）
        if (a === '取消') { mode = PLOT_MODE; editMsg = ''; this.repaintDeferred(); return; }
        if (a === '删除') {
            store.removeAt(editIdx);
            mode = PLOT_MODE;
            editMsg = '';
            editIdx = -1;
            this.repaintDeferred();
            return;
        }
        // ↓ 以下都只改「顶部那一行表达式」，键盘本身不变：
        //   只重画那一条横带（3 次 canvas 调用），绝不整页重绘（56 次）。
        //   退格/清空曾经走整页重绘，在点击回调里这一下就把真机打黑了。
        if (a === '退') {
            if (editText.length > 0) {
                editText = editText.substring(0, editText.length - 1);
                okText = null;      // 强制下一帧重新校验（text 变短也要重算是否合法）
            }
            editMsg = '';
            this.repaintInput();
            return;
        }
        if (a === '清') {
            editText = '';
            okText = null;
            editMsg = '';
            this.repaintInput();
            return;
        }
        // 函数页 / 主键盘页切换：键位整块变了，必须整页重绘，但同样走延迟
        if (a === '函数') { fnPage = true; this.repaintDeferred(); return; }
        if (a === '返回') { fnPage = false; this.repaintDeferred(); return; }

        const add = (CALLS.indexOf(a) >= 0) ? (a + '(') : a;
        if (editText.length + add.length > MAXLEN) { return; }
        editText = editText + add;
        editMsg = '';
        this.repaintInput();
    },

    save() {
        // 分阶段打标记：如果崩溃，屏幕顶部会留着最后一条，用来定位崩在哪一步
        this.dbgText = '保存 1/5 校验';
        const r = store.check(editText);
        if (!r.ok) { editMsg = r.msg; this.dbgText = ''; this.repaintInput(); return; }

        this.dbgText = '保存 2/5 写入';
        const res = (editIdx >= 0) ? store.update(editIdx, editText) : store.add(editText);
        if (!res.ok) { editMsg = res.msg; this.dbgText = ''; this.repaintInput(); return; }

        this.dbgText = '保存 3/5 算特殊点';
        // 把二次函数分析提前到保存时做完：绘图那一帧就不再需要跑多项式提取，
        // 绘制路径上少一件事。
        const item = store.curItem();
        if (item && item.ast && !item.quadDone) {
            item.quadDone = true;
            try {
                const q = poly.quadInfo(poly.polyOf(item.ast));
                if (q) {
                    item.quad = q;
                    item.pts = plot.describeQuad(q);
                }
            } catch (e) {
                item.quad = null;
            }
            item.ast = null;
        }

        this.dbgText = '保存 4/5 切换界面';
        mode = PLOT_MODE;
        editMsg = '';
        editIdx = -1;

        this.dbgText = '保存 5/5 重绘';
        this.repaintDeferred();
    }
};