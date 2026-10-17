/**
 * canvas 绘图引擎（Lite Wearable）
 *
 * Lite 版 CanvasRenderingContext2D 只提供：
 *   fillRect / fillStyle / strokeRect / fillText / lineWidth / strokeStyle /
 *   stroke / beginPath / moveTo / lineTo / closePath / font / textAlign / arc / rect
 * 因此实现上：
 *   - 没有 clearRect：用整块 fillRect 覆盖来清屏；
 *   - 没有 measureText：文字宽度按字号估算；
 *   - 没有 fill()：点标记用 fillRect 画实心小方块。
 */
import expr from './expr';
import num from './num';

const BG = '#0B0F14';
const GRID = '#1B2430';
const AXIS = '#54657C';
const TICK_C = '#77879B';
const VERTEX_C = '#FFD166';
const ROOT_C = '#3DDC97';
const YINT_C = '#F072C0';

// 绘图区域的左上角偏移：让坐标系可以画在页面中的任意矩形里，
// 而不用 translate（Lite canvas 没有 translate）。
let OX = 0;
let OY = 0;

function sxOf(x, W, v) {
    return OX + (x - v.xmin) * W / (v.xmax - v.xmin);
}

function syOf(y, H, v) {
    return OY + H - (y - v.ymin) * H / (v.ymax - v.ymin);
}

// 世界坐标窗口：以原点为中心，按画布长宽比扩展，保证图像不被拉伸
function makeView(W, H) {
    const half = 8;
    const v = { xmin: -half, xmax: half, ymin: -half, ymax: half };
    if (W > H) {
        const k = W / H;
        v.xmin = -half * k;
        v.xmax = half * k;
    } else if (H > W) {
        const k = H / W;
        v.ymin = -half * k;
        v.ymax = half * k;
    }
    return v;
}

// 1/2/5 x 10^n 形式的“好看”步长
function niceStep(range, target) {
    const raw = range / target;
    if (!(raw > 0)) { return 1; }
    const p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10 + 1e-9));
    const nor = raw / p;
    let m = 1;
    if (nor > 5) { m = 10; } else if (nor > 2) { m = 5; } else if (nor > 1) { m = 2; }
    return m * p;
}

function textWidth(s, fs) {
    return s.length * fs * 0.56;
}

function clear(ctx, W, H) {
    ctx.fillStyle = BG;
    ctx.fillRect(OX, OY, W, H);
}

function drawGrid(ctx, W, H, v) {
    const step = niceStep(v.xmax - v.xmin, 8);
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    let guard = 0;
    let x = Math.ceil(v.xmin / step) * step;
    while (x <= v.xmax + 1e-9 && guard < 60) {
        guard++;
        const px = sxOf(x, W, v);
        ctx.moveTo(px, OY);
        ctx.lineTo(px, OY + H);
        x += step;
    }
    guard = 0;
    let y = Math.ceil(v.ymin / step) * step;
    while (y <= v.ymax + 1e-9 && guard < 60) {
        guard++;
        const py = syOf(y, H, v);
        ctx.moveTo(OX, py);
        ctx.lineTo(OX + W, py);
        y += step;
    }
    ctx.stroke();
}

function drawAxes(ctx, W, H, v) {
    ctx.strokeStyle = AXIS;
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (v.ymin <= 0 && v.ymax >= 0) {
        const py = syOf(0, H, v);
        ctx.moveTo(OX, py);
        ctx.lineTo(OX + W, py);
    }
    if (v.xmin <= 0 && v.xmax >= 0) {
        const px = sxOf(0, W, v);
        ctx.moveTo(px, OY);
        ctx.lineTo(px, OY + H);
    }
    ctx.stroke();
}

function drawTicks(ctx, W, H, v) {
    const step = niceStep(v.xmax - v.xmin, 4);
    const px0 = sxOf(0, W, v);
    const py0 = syOf(0, H, v);
    ctx.fillStyle = TICK_C;
    ctx.font = '15px sans-serif';

    ctx.textAlign = 'center';
    let guard = 0;
    let x = Math.ceil(v.xmin / step) * step;
    while (x <= v.xmax + 1e-9 && guard < 40) {
        guard++;
        if (Math.abs(x) > 1e-9) {
            const px = sxOf(x, W, v);
            if (px > 12 && px < W - 12) {
                const ty = (py0 + 17 > H) ? (py0 - 6) : (py0 + 17);
                ctx.fillText(num.fmt(x, 2), px, ty);
            }
        }
        x += step;
    }

    ctx.textAlign = 'left';
    guard = 0;
    let y = Math.ceil(v.ymin / step) * step;
    while (y <= v.ymax + 1e-9 && guard < 40) {
        guard++;
        if (Math.abs(y) > 1e-9) {
            const py = syOf(y, H, v);
            if (py > 12 && py < H - 4) {
                ctx.fillText(num.fmt(y, 2), px0 + 5, py + 5);
            }
        }
        y += step;
    }
}

/**
 * 绘制一条函数曲线。
 * 遇到 NaN/Infinity（定义域外）或相邻点竖直跳变（1/x、tan 的渐近线）时断开路径，
 * 避免出现横贯画布的假竖线。
 */
function drawCurve(ctx, ast, color, W, H, v) {
    const kx = W / (v.xmax - v.xmin);
    const steps = W > 360 ? 360 : W;
    const dx = (v.xmax - v.xmin) / steps;
    const hiLimit = -H;
    const loLimit = H * 2;

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();

    let pen = false;
    let lastPy = 0;

    for (let i = 0; i <= steps; i++) {
        const x = v.xmin + i * dx;
        const y = expr.calc(ast, x);
        if (typeof y !== 'number' || !isFinite(y)) { pen = false; continue; }
        const py = syOf(y, H, v);
        if (py < hiLimit || py > loLimit) { pen = false; continue; }
        if (pen && Math.abs(py - lastPy) > H) { pen = false; }
        const px = (x - v.xmin) * kx;
        if (pen) {
            ctx.lineTo(px, py);
        } else {
            ctx.moveTo(px, py);
            pen = true;
        }
        lastPy = py;
    }
    ctx.stroke();
}

function markPoint(ctx, px, py, color, r) {
    ctx.fillStyle = color;
    ctx.fillRect(px - r, py - r, r * 2 + 1, r * 2 + 1);
}

// place: 'right' | 'left' | 'above' | 'below'
function drawLabel(ctx, text, px, py, color, place, W, H) {
    const fs = 15;
    ctx.font = fs + 'px sans-serif';
    ctx.fillStyle = color;
    const w = textWidth(text, fs);
    let ax = px;
    let ay = py;
    if (place === 'right') {
        ctx.textAlign = 'left';
        ax = px + 7;
        ay = py + 5;
        if (ax + w > W - 2) { ctx.textAlign = 'right'; ax = px - 7; }
    } else if (place === 'left') {
        ctx.textAlign = 'right';
        ax = px - 7;
        ay = py + 5;
        if (ax - w < 2) { ctx.textAlign = 'left'; ax = px + 7; }
    } else if (place === 'below') {
        ctx.textAlign = 'center';
        ay = py + fs + 8;
        if (ay > H - 2) { ay = py - 7; }
        if (ax - w / 2 < 2) { ax = w / 2 + 2; }
        if (ax + w / 2 > W - 2) { ax = W - 2 - w / 2; }
    } else {
        ctx.textAlign = 'center';
        ay = py - 8;
        if (ay < fs) { ay = py + fs + 8; }
        if (ax - w / 2 < 2) { ax = w / 2 + 2; }
        if (ax + w / 2 > W - 2) { ax = W - 2 - w / 2; }
    }
    ctx.fillText(text, ax, ay);
}

/**
 * 二次函数的特殊点：顶点（最大值/最小值）与坐标轴交点。
 * 其他函数按需求不画特殊点。
 */
function drawQuadPoints(ctx, quad, W, H, v) {
    function inView(x, y) {
        return x >= v.xmin && x <= v.xmax && y >= v.ymin && y <= v.ymax;
    }

    // 顶点：写清是最大值还是最小值
    const vx = quad.vertex.x;
    const vy = quad.vertex.y;
    if (inView(vx, vy)) {
        const px = sxOf(vx, W, v);
        const py = syOf(vy, H, v);
        markPoint(ctx, px, py, VERTEX_C, 4);
        const tag = (quad.isMin ? '最小' : '最大') +
            '(' + num.fmt2(vx) + ',' + num.fmt2(vy) + ')';
        drawLabel(ctx, tag, px, py, VERTEX_C, quad.isMin ? 'below' : 'above', W, H);
    }

    // 与 x 轴的交点；两点很近时错开上下，避免文字重叠
    const py0 = syOf(0, H, v);
    const rn = quad.roots.length;
    let prevPx = -9999;
    for (let i = 0; i < rn; i++) {
        const rx = quad.roots[i];
        if (!inView(rx, 0)) { continue; }
        const px = sxOf(rx, W, v);
        markPoint(ctx, px, py0, ROOT_C, 3);
        let place = 'below';
        if (i > 0 && Math.abs(px - prevPx) < 96) { place = 'above'; }
        drawLabel(ctx, '(' + num.fmt2(rx) + ',0)', px, py0, ROOT_C, place, W, H);
        prevPx = px;
    }

    // 与 y 轴的交点
    const cy = quad.yIntercept;
    if (inView(0, cy) && Math.abs(cy) > 1e-9) {
        const px = sxOf(0, W, v);
        const py = syOf(cy, H, v);
        markPoint(ctx, px, py, YINT_C, 3);
        drawLabel(ctx, '(0,' + num.fmt2(cy) + ')', px, py, YINT_C, 'left', W, H);
    }
}

/**
 * 二次函数特殊点摘要文本（主页底部一行展示）。
 * 放在这里而不是 store：store 保持不依赖 poly，编辑页才不用多加载一份。
 */
function describeQuad(q) {
    let s = (q.isMin ? '最小' : '最大') +
        '(' + num.fmt2(q.vertex.x) + ',' + num.fmt2(q.vertex.y) + ')';
    if (q.roots.length === 2) {
        s += ' 交点(' + num.fmt2(q.roots[0]) + ',0)(' + num.fmt2(q.roots[1]) + ',0)';
    } else if (q.roots.length === 1) {
        s += ' 切点(' + num.fmt2(q.roots[0]) + ',0)';
    } else {
        s += ' 无实根';
    }
    return s;
}

export default {
    makeView: makeView,
    describeQuad: describeQuad,

    /**
     * 全量重绘。funcs 为曲线记录数组，curIdx 指定要高亮特殊点的那一条。
     */
    draw: function (ctx, W, H, funcs, curIdx, ox, oy) {
        // 尺寸必须是有限正数，否则后续所有坐标都会是 NaN，
        // canvas 会抛 TypeError: wrong type of argument
        if (typeof W !== 'number' || typeof H !== 'number' || !isFinite(W) || !isFinite(H) || W <= 0 || H <= 0) {
            return;
        }
        OX = (typeof ox === 'number' && isFinite(ox)) ? ox : 0;
        OY = (typeof oy === 'number' && isFinite(oy)) ? oy : 0;
        const v = makeView(W, H);
        clear(ctx, W, H);
        drawGrid(ctx, W, H, v);
        drawAxes(ctx, W, H, v);
        drawTicks(ctx, W, H, v);
        for (let i = 0; i < funcs.length; i++) {
            const f = funcs[i];
            if (f && f.ast) {
                drawCurve(ctx, f.ast, f.color, W, H, v);
            }
        }
        if (curIdx >= 0 && curIdx < funcs.length) {
            const cf = funcs[curIdx];
            if (cf && cf.quad) {
                drawQuadPoints(ctx, cf.quad, W, H, v);
            }
        }
    }
};
