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
const GRID = '#1F2A38';
const AXIS = '#54657C';
const TICK_C = '#77879B';
const VERTEX_C = '#FFD166';
const ROOT_C = '#3DDC97';
const YINT_C = '#F072C0';
// 对称轴：比网格线亮一点、比坐标轴暗一点，做到"看得见但不抢戏"
const SYM_C = '#33465C';

// 绘图区域的左上角偏移：让坐标系可以画在页面中的任意矩形里，
// 而不用 translate（Lite canvas 没有 translate）。
let OX = 0;
let OY = 0;
// draw() 的视图窗口缓冲区，模块级复用
const VIEW_BUF = { xmin: -8, xmax: 8, ymin: -8, ymax: 8 };

function sxOf(x, W, v) {
    return OX + (x - v.xmin) * W / (v.xmax - v.xmin);
}

function syOf(y, H, v) {
    return OY + H - (y - v.ymin) * H / (v.ymax - v.ymin);
}

// 世界坐标窗口：以 (cx, cy) 为中心，按画布长宽比扩展，保证图像不被拉伸。
// half 是可视半宽（世界单位），缩放改它；cx/cy 是视图中心的世界坐标，滑动平移改它们。
// 任一参数非法都回落到默认值（±8、居中），避免 NaN 渗进坐标系导致 canvas 报参数类型错误。
// 原地填充一个 view 对象，不产生新分配。draw() 每帧都要视图窗口，
// 在 64KB 堆上"每帧新建一个小对象"是实打实的回收压力。
function fillView(v, W, H, half, cx, cy) {
    const h = (typeof half === 'number' && isFinite(half) && half > 0) ? half : 8;
    const ccx = (typeof cx === 'number' && isFinite(cx)) ? cx : 0;
    const ccy = (typeof cy === 'number' && isFinite(cy)) ? cy : 0;
    let hw = h;
    let hh = h;
    if (W > H) {
        hw = h * (W / H);
    } else if (H > W) {
        hh = h * (H / W);
    }
    v.xmin = ccx - hw;
    v.xmax = ccx + hw;
    v.ymin = ccy - hh;
    v.ymax = ccy + hh;
    return v;
}

// 对外仍返回新对象（自测会连续取多个快照对比），内部由 draw 走复用版本
function makeView(W, H, half, cx, cy) {
    return fillView({ xmin: 0, xmax: 0, ymin: 0, ymax: 0 }, W, H, half, cx, cy);
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

// 无 measureText：中文/全角按一个字号宽，半角按 0.56 字号估算
function textWidth(s, fs) {
    let w = 0;
    for (let i = 0; i < s.length; i++) {
        w += s.charCodeAt(i) > 127 ? fs : fs * 0.56;
    }
    return w;
}

function clear(ctx, W, H) {
    ctx.fillStyle = BG;
    ctx.fillRect(OX, OY, W, H);
}

function drawGrid(ctx, W, H, v, target) {
    const step = niceStep(v.xmax - v.xmin, target || 8);
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

function drawTicks(ctx, W, H, v, target) {
    const step = niceStep(v.xmax - v.xmin, target || 4);
    const px0 = sxOf(0, W, v);
    const py0 = syOf(0, H, v);
    ctx.fillStyle = TICK_C;
    ctx.font = '15px HarmonyOS Sans';

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
function drawCurve(ctx, evalFn, color, W, H, v, lw, sampleSteps) {
    const kx = W / (v.xmax - v.xmin);
    let steps = (typeof sampleSteps === 'number' && sampleSteps > 8) ? sampleSteps : (W > 360 ? 360 : W);
    const dx = (v.xmax - v.xmin) / steps;
    // 严格裁到绘图区上下边界：Lite canvas 没有 clip()，否则曲线会画到
    // 顶部表达式文字和底部按钮上面（坐标轴/网格本身不会越界，只有曲线会）。
    const hiLimit = OY - 1;
    const loLimit = OY + H + 1;

    ctx.strokeStyle = color;
    // 线宽来自设置（默认 3px）。Lite canvas 基本不做抗锯齿，
    // 2px 的斜线台阶感很明显，3px 能把毛边盖住；坐标轴固定 2px，层级仍分得开。
    ctx.lineWidth = (typeof lw === 'number' && lw > 0) ? lw : 3;
    ctx.beginPath();

    let pen = false;
    let lastPy = 0;

    for (let i = 0; i <= steps; i++) {
        const x = v.xmin + i * dx;
        const y = evalFn(x);
        if (typeof y !== 'number' || !isFinite(y)) { pen = false; continue; }
        const py = syOf(y, H, v);
        if (py < hiLimit || py > loLimit) { pen = false; continue; }
        if (pen && Math.abs(py - lastPy) > H) { pen = false; }
        // 必须加上 OX：sxOf/syOf 都带偏移，这里手算若漏掉会让整条曲线左移一个 OX，
        // 表现为「曲线和坐标系对不上」，很容易被误判成函数画错了。
        const px = OX + (x - v.xmin) * kx;
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

/**
 * 往当前路径追加一条虚线。
 * Lite 版 CanvasRenderingContext2D 没有 setLineDash / lineDashOffset，
 * 只能把线拆成一段段短线段，由调用方统一 beginPath + stroke。
 */
function dashedSegments(ctx, x1, y1, x2, y2, dash, gap) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (!(len > 0) || !isFinite(len)) { return; }
    const ux = dx / len;
    const uy = dy / len;
    const step = dash + gap;
    let t = 0;
    let guard = 0;
    while (t < len && guard < 400) {
        guard++;
        const t2 = (t + dash < len) ? (t + dash) : len;
        ctx.moveTo(x1 + ux * t, y1 + uy * t);
        ctx.lineTo(x1 + ux * t2, y1 + uy * t2);
        t += step;
    }
}

// 只有条目缺少编译闭包时才走这里（自测的手工构造），正常路径不会用到。
// 闭包在首次使用时才编译，且只在没有 fn 的条目上发生一次。
function fallbackEval(ast) {
    if (!ast) { return null; }
    return expr.compile(ast);
}

function markPoint(ctx, px, py, color, r) {
    ctx.fillStyle = color;
    ctx.fillRect(px - r, py - r, r * 2 + 1, r * 2 + 1);
}

// 标签包围盒（绝对坐标，已含 OX/OY 偏移）；超出绘图区则返回 null
function labelBox(place, px, py, w, h, W, H) {
    const left = OX + 2;
    const top = OY + 2;
    const right = OX + W - 2;
    const bottom = OY + H - 2;
    let x0, y0, tx, ty, align;
    if (place === 'right') {
        x0 = px + 7; y0 = py - h / 2; tx = px + 7; ty = py + 5; align = 'left';
    } else if (place === 'left') {
        x0 = px - 7 - w; y0 = py - h / 2; tx = px - 7; ty = py + 5; align = 'right';
    } else if (place === 'below') {
        x0 = px - w / 2; y0 = py + 8; tx = px; ty = py + 22; align = 'center';
    } else {
        x0 = px - w / 2; y0 = py - 8 - h; tx = px; ty = py - 8; align = 'center';
    }
    if (x0 < left || x0 + w > right || y0 < top || y0 + h > bottom) { return null; }
    return { x: x0, y: y0, w: w, h: h, tx: tx, ty: ty, align: align };
}

function overlapsAny(box, placed) {
    for (let i = 0; i < placed.length; i++) {
        const p = placed[i];
        if (box.x < p.x + p.w && box.x + box.w > p.x &&
            box.y < p.y + p.h && box.y + box.h > p.y) {
            return true;
        }
    }
    return false;
}

/**
 * 依次尝试候选方位放置标签，避开已占用区域；都放不下就放弃（只留点不写字）。
 * 这是解决「顶点 / x 交点 / y 截距落在同一点」时文字互相覆盖的关键。
 */
function putLabel(ctx, text, px, py, color, W, H, placed, orders) {
    const fs = 15;
    const w = textWidth(text, fs);
    const h = fs + 4;
    for (let i = 0; i < orders.length; i++) {
        const box = labelBox(orders[i], px, py, w, h, W, H);
        if (!box) { continue; }
        if (overlapsAny(box, placed)) { continue; }
        placed.push(box);
        ctx.font = fs + 'px HarmonyOS Sans';
        ctx.fillStyle = color;
        ctx.textAlign = box.align;
        ctx.fillText(text, box.tx, box.ty);
        return true;
    }
    return false;
}

/**
 * 二次函数的特殊点：顶点（最大值/最小值）与坐标轴交点。
 * 其他函数按需求不画特殊点。
 *
 * 顶点、x 交点、y 截距可能落在同一点（例如 y = -x^2 三者都在原点），
 * 所以：点按优先级绘制，让顶点压在最上层；文字先比间距再比包围盒，
 * 距离过近或位置冲突就不再重复书写，避免出现「最(0(0)0)」这种重叠。
 */
function drawQuadPoints(ctx, quad, W, H, v, placed, pal, vertexOnly, set) {
    // placed 由调用方传入时可在多条函数之间共享，实现跨曲线的标注避让
    if (!placed) { placed = []; }
    const st = set || {};
    const dotR = (typeof st.dotSize === 'number' && st.dotSize > 0) ? st.dotSize : 3;
    // pal 允许换成曲线自身的颜色；不传则用统一的顶点/交点配色
    const cV = (pal && pal.vertex) ? pal.vertex : VERTEX_C;
    const cR = (pal && pal.root) ? pal.root : ROOT_C;
    const cY = (pal && pal.yint) ? pal.yint : YINT_C;
    // 只有点几乎完全重合（< 6px）时才放弃重复标注；稍远一些就交给 putLabel
    // 的方位尝试去避让，避免把「数值不同但位置接近」的坐标误丢。
    const MIN_SEP = 6;

    function inView(x, y) {
        return x >= v.xmin && x <= v.xmax && y >= v.ymin && y <= v.ymax;
    }

    const vx = quad.vertex.x;
    const vy = quad.vertex.y;

    // 对称轴 x = 顶点横坐标，淡色虚线，贯通整个绘图区。
    // 只在「完整标注」时画（单条模式 / 全部模式且 ≤ 2 条）：
    // 多条曲线各画一条对称轴会把画面切成网格，反而看不清曲线本身。
    if (!vertexOnly && st.showAxis === 1 && vx >= v.xmin && vx <= v.xmax) {
        const ax = sxOf(vx, W, v);
        ctx.strokeStyle = SYM_C;
        ctx.lineWidth = 1;
        ctx.beginPath();
        dashedSegments(ctx, ax, OY, ax, OY + H, 6, 5);
        ctx.stroke();
    }

    const showVertex = inView(vx, vy);
    const vpx = showVertex ? sxOf(vx, W, v) : 0;
    const vpy = showVertex ? syOf(vy, H, v) : 0;

    // 点：先画低优先级，顶点最后画，重合时顶点在上面
    const cy = quad.yIntercept;
    let ypx = 0, ypy = 0, showY = false;
    if (!vertexOnly && inView(0, cy) && Math.abs(cy) > 1e-9) {
        ypx = sxOf(0, W, v);
        ypy = syOf(cy, H, v);
        showY = true;
        markPoint(ctx, ypx, ypy, cY, dotR);
    }

    const rn = quad.roots.length;
    const rp = [];
    for (let i = 0; i < rn; i++) {
        if (vertexOnly) { rp.push(null); continue; }
        const rx = quad.roots[i];
        if (!inView(rx, 0)) { rp.push(null); continue; }
        const px = sxOf(rx, W, v);
        const py = syOf(0, H, v);
        rp.push([px, py]);
        markPoint(ctx, px, py, cR, dotR);
    }

    if (showVertex) {
        markPoint(ctx, vpx, vpy, cV, dotR + 1);
    }

    // 文字：顶点优先，其后交点和截距
    if (showVertex) {
        const tag = (quad.isMin ? '最小' : '最大') +
            '(' + num.fmt2(vx) + ',' + num.fmt2(vy) + ')';
        putLabel(ctx, tag, vpx, vpy, cV, W, H, placed,
            quad.isMin ? ['below', 'above', 'right', 'left'] : ['above', 'below', 'right', 'left']);
    }

    for (let i = 0; i < rp.length; i++) {
        const r = rp[i];
        if (!r) { continue; }
        // 和顶点几乎重合时只画点，不重复写字
        if (showVertex && Math.abs(r[0] - vpx) < MIN_SEP && Math.abs(r[1] - vpy) < MIN_SEP) {
            continue;
        }
        putLabel(ctx, '(' + num.fmt2(quad.roots[i]) + ',0)', r[0], r[1], cR, W, H, placed,
            ['below', 'above', 'right', 'left']);
    }

    if (showY) {
        let skip = false;
        if (showVertex && Math.abs(ypx - vpx) < MIN_SEP && Math.abs(ypy - vpy) < MIN_SEP) {
            skip = true;
        }
        for (let i = 0; i < rp.length && !skip; i++) {
            const r = rp[i];
            if (r && Math.abs(ypx - r[0]) < MIN_SEP && Math.abs(ypy - r[1]) < MIN_SEP) {
                skip = true;
            }
        }
        if (!skip) {
            putLabel(ctx, '(0,' + num.fmt2(cy) + ')', ypx, ypy, cY, W, H, placed,
                ['left', 'right', 'above']);
        }
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

/**
 * 全部模式的底部汇总：把每条二次函数的顶点坐标按「序号:(x,y)」紧凑列出。
 * 非二次函数留「-」占位，保证序号与曲线一一对应。
 */
function describeAll(list) {
    let s = '';
    for (let i = 0; i < list.length; i++) {
        const f = list[i];
        if (!f) { continue; }
        if (f.quad) {
            s += (i + 1) + ':(' + num.fmt2(f.quad.vertex.x) + ',' + num.fmt2(f.quad.vertex.y) + ')  ';
        } else {
            s += (i + 1) + ':-  ';
        }
    }
    return s;
}

export default {
    makeView: makeView,
    describeQuad: describeQuad,
    describeAll: describeAll,

    /**
     * 全量重绘。funcs 为曲线记录数组，curIdx 指定要高亮特殊点的那一条。
     */
    draw: function (ctx, W, H, funcs, curIdx, ox, oy, half, cx, cy, markAll, opts) {
        // 尺寸必须是有限正数，否则后续所有坐标都会是 NaN，
        // canvas 会抛 TypeError: wrong type of argument
        if (typeof W !== 'number' || typeof H !== 'number' || !isFinite(W) || !isFinite(H) || W <= 0 || H <= 0) {
            return;
        }
        OX = (typeof ox === 'number' && isFinite(ox)) ? ox : 0;
        OY = (typeof oy === 'number' && isFinite(oy)) ? oy : 0;
        // 外观设置（曲线粗细 / 交点开关 / 点标记大小 / 对称轴）；不传则沿用默认外观
        const o = opts || {};
        const lw = (typeof o.width === 'number' && o.width > 0) ? o.width : 3;
        const wantRoots = (o.showRoots !== 0);
        const dotSize = (typeof o.dotSize === 'number' && o.dotSize > 0) ? o.dotSize : 3;
        // showAxis 默认 1：不传 opts 时要保持「对称轴照画」的既有行为，
        // 只有设置里明确选成 0（隐藏）才关掉。
        const dotSet = { dotSize: dotSize, showAxis: (o.showAxis === 0) ? 0 : 1 };

        // 复用同一个 view 对象，避免每帧新建
        const v = fillView(VIEW_BUF, W, H, half, cx, cy);
        clear(ctx, W, H);
        // 画面等级：0 流畅（网格稀疏、采样减半）/ 1 标准 / 2 精细（网格与采样都加密）
        const q = (typeof o.quality === 'number') ? o.quality : 1;
        const gridTarget = (q >= 2) ? 12 : (q <= 0 ? 4 : 8);
        const tickTarget = (q >= 2) ? 6 : (q <= 0 ? 3 : 4);
        // 采样密度分三档。曲线是逐点折线，采样点间距 1.5px 与 1px 在 466 圆屏上肉眼无差，
        // 但求值次数少了三分之一 —— 这是每帧最贵的一步，优先砍这里。
        const sampleSteps = (q >= 2) ? (W > 360 ? 360 : W)
            : (q <= 0 ? Math.floor(W / 3) : Math.floor(W * 0.66));
        // 曲线入场动画的横向进度（1 表示完整）

        drawGrid(ctx, W, H, v, gridTarget);
        drawAxes(ctx, W, H, v);
        drawTicks(ctx, W, H, v, tickTarget);
        for (let i = 0; i < funcs.length; i++) {
            const f = funcs[i];
            if (!f) { continue; }
            // 正常路径用编译好的闭包；自测里手工构造的条目只有 ast，走兜底
            const ev = (typeof f.fn === 'function') ? f.fn : fallbackEval(f.ast);
            if (ev) { drawCurve(ctx, ev, f.color, W, H, v, lw, sampleSteps); }
        }
        // 标注共用一个 placed 表，多条函数之间也会互相避让
        const placed = [];
        if (markAll) {
            // 全部同屏：每条二次函数都标出顶点（用各自曲线的颜色）。
            // 交点是否一并标出取决于曲线条数：
            //   <= 2 条 —— 画面还有余量，交点/截距也标出来，信息更全；
            //   >= 3 条 —— 只标顶点，因为多条曲线的交点必然糊成一片。
            // 无论哪种情况，putLabel 的避让表都会兜底：位置太挤就只留点、不写字。
            const withRoots = (funcs.length <= 2) && wantRoots;
            for (let i = 0; i < funcs.length; i++) {
                const af = funcs[i];
                if (af && af.quad) {
                    drawQuadPoints(ctx, af.quad, W, H, v, placed,
                        { vertex: af.color, root: ROOT_C, yint: YINT_C }, !withRoots, dotSet);
                }
            }
        } else if (curIdx >= 0 && curIdx < funcs.length) {
            const cf = funcs[curIdx];
            if (cf && cf.quad) {
                drawQuadPoints(ctx, cf.quad, W, H, v, placed, null, !wantRoots, dotSet);
            }
        }
    }
};
