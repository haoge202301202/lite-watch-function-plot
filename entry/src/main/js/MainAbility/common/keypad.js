/**
 * 自绘键盘：键位、绘制、命中测试。
 *
 * 内存约束（轻手表 JS 堆可能只有 64KB）：
 *  - 键位用扁平数组 [x,y,w,h,label,...] 表示，不用对象数组（省属性表）；
 *  - 不缓存键位，绘制和命中时各自即时计算，避免常驻；
 *  - 颜色只用 4 个常量，去掉分类数组。
 * 触摸坐标来自事件对象的 globalX / globalY。
 */

// 配色与主页保持一致（BTN #1C2634 / 主色 #2E7DF6）。
// 键盘不加卡片的高光描边：27 个键密集排列，多两圈线反而显乱。
const BG = '#0B0F14';
const C_NUM = '#1C2634';
const C_OP = '#2A3646';
const C_OK = '#2E7DF6';
const C_DEL = '#B3362B';
// 按下瞬间的高亮色：比普通键亮一档，松手后恢复
const C_HL = '#3E5068';
const F_NUM = '#EDF2F8';
const F_OP = '#9FC8F0';

const ROW_TOP = 110;
const ROW_H = 62;

// 每行：[键宽, 键高, 间隙]，与 MAIN_KEYS / FN_KEYS 的行一一对应。
// 前四行统一 6 键（58px），最后一行三个功能键（86px）—— 比原来四个小键更好按，
// 也把「确定」放在最右（拇指最容易够到），不再是「√ 紧挨 确定」这种容易误触的排法。
const SPEC = [
    58, 48, 6,
    58, 48, 6,
    58, 48, 6,
    58, 48, 6,
    86, 48, 6
];

// 键位按「计算器直觉」排：第 4 列从上到下正好是 ÷ × - +，
// 输入 2x+1 这种表达式时四个运算符手指不用满屏找。
// 括号 ( ) 在第 5 列上下相邻，^ 与 x 同在第三行且紧挨——y=x^2 是最常见的开头。
const MAIN_KEYS = [
    ['7', '8', '9', '\u00F7', '(', '\u9000'],
    ['4', '5', '6', '\u00D7', ')', '\u6E05'],
    ['1', '2', '3', '-', '^', 'x'],
    ['0', '.', '|', '+', '\u221A', '\u03C0'],
    ['\u51FD\u6570', '\u53D6\u6D88', '\u786E\u5B9A']
];

// 函数页保持同一套行结构：前四行 6 键、末行 3 个功能键
const FN_KEYS = [
    ['sin', 'cos', 'tan', 'ln', 'lg', 'log2'],
    ['asin', 'acos', 'atan', 'sqrt', 'abs', 'exp'],
    ['(', ')', '^', 'x', '|', '\u9000'],
    ['0', '1', '2', '3', '\u03C0', '\u6E05'],
    ['\u8FD4\u56DE', '\u53D6\u6D88', '\u786E\u5B9A']
];

function isDigitLabel(s) {
    return s.length === 1 && s >= '0' && s <= '9';
}

function keyBg(label) {
    if (label === '\u786E\u5B9A') { return C_OK; }
    if (label === '\u5220\u9664') { return C_DEL; }
    if (isDigitLabel(label)) { return C_NUM; }
    return C_OP;
}

function keyFg(label) {
    if (label === '\u786E\u5B9A' || label === '\u5220\u9664') { return '#FFFFFF'; }
    if (isDigitLabel(label)) { return F_NUM; }
    return F_OP;
}

function keyFont(s) {
    if (s.length >= 4) { return 15; }
    if (s.length >= 2) { return 21; }
    return 26;
}

/**
 * 生成扁平键位数组：[x, y, w, h, label, x, y, w, h, label, ...]
 */
function layout(rows, W, topY) {
    const base = (typeof topY === 'number' && isFinite(topY)) ? topY : ROW_TOP;
    const out = [];
    for (let r = 0; r < rows.length; r++) {
        const labels = rows[r];
        const kw = SPEC[r * 3];
        const kh = SPEC[r * 3 + 1];
        const gap = SPEC[r * 3 + 2];
        const n = labels.length;
        const x0 = (W - (n * kw + (n - 1) * gap)) / 2;
        const y = base + r * ROW_H + (ROW_H - kh) / 2;
        for (let i = 0; i < n; i++) {
            out.push(x0 + i * (kw + gap), y, kw, kh, labels[i]);
        }
    }
    return out;
}

/**
 * 绘制整块键盘（含顶部表达式区）。flat 为 layout 的结果。
 */
function draw(ctx, W, H, flat, highlight) {
    for (let i = 0; i + 4 < flat.length; i += 5) {
        const x = flat[i];
        const y = flat[i + 1];
        const w = flat[i + 2];
        const h = flat[i + 3];
        const label = flat[i + 4];
        ctx.fillStyle = (highlight && label === highlight) ? C_HL : keyBg(label);
        ctx.fillRect(x, y, w, h);
        const fs = keyFont(label);
        ctx.font = fs + 'px sans-serif';
        ctx.fillStyle = keyFg(label);
        ctx.textAlign = 'center';
        ctx.fillText(label, x + w / 2, y + h / 2 - fs * 0.35);
    }
}

/**
 * 命中测试：返回被点中的键标签，未命中返回 null。
 */
function hit(flat, gx, gy) {
    for (let i = 0; i + 4 < flat.length; i += 5) {
        if (gx >= flat[i] && gx <= flat[i] + flat[i + 2] &&
            gy >= flat[i + 1] && gy <= flat[i + 1] + flat[i + 3]) {
            return flat[i + 4];
        }
    }
    return null;
}

export default {
    MAIN_KEYS: MAIN_KEYS,
    FN_KEYS: FN_KEYS,
    layout: layout,
    draw: draw,
    hit: hit
};
