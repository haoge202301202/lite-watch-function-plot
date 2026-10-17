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
// draw() 的标注占位表，模块级复用
const PLACED_BUF = [];

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

// 1/2/5 x 10^n 形式的“好看”步长（向下取整那一支）
//
// 老版本是往上取整（nor>5 → 10、>2 → 5、>1 → 2），再加上刻度用的是 target=1，
// 结果 step 总是 ≥ 整个视野宽度 —— 刻度标签一个都画不出来，
// 真机上表现为「坐标轴的坐标没了」，网格也只有中间一条线。
// 现在改成按「最多几个区间」来挑：先按 range/maxInt 定位量级，
// 再沿 1/2/5/10 往上找第一个能让区间数落进上限的步长。
// 容差 +1 是故意的：range=16 时 step=5 会得到 3.2 个区间，比 step=10 的 1.6 个好用得多。
function niceStep(range, maxInt) {
    const lim = (typeof maxInt === 'number' && maxInt > 0) ? maxInt : 6;
    if (!(range > 0) || !isFinite(range)) { return 1; }
    const p0 = Math.pow(10, Math.floor(Math.log(range / lim) / Math.LN10 + 1e-9));
    // 候选里带 4：只留 1/2/5/10 的话，±8 的视野只能取 5（3.2 个区间）或 10（1.6 个），
    // 前者只剩 ±5 两个刻度，后者连一个都画不出来；带 4 就能得到 ±4、±8 四个刻度。
    const CAND = [1, 2, 4, 5, 10];
    for (let k = 0; k < 4; k++) {
        const base = p0 * Math.pow(10, k);
        for (let i = 0; i < CAND.length; i++) {
            const st = CAND[i] * base;
            if (range / st <= lim + 1e-9) { return st; }
        }
    }
    return p0 * 10;
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

function drawGrid(ctx, W, H, v, step) {
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    let guard = 0;
    let seg = 0;
    let x = Math.ceil(v.xmin / step) * step;
    while (x <= v.xmax + 1e-9 && guard < 60) {
        guard++;
        const px = sxOf(x, W, v);
        ctx.moveTo(px, OY);
        ctx.lineTo(px, OY + H);
        seg++;
        x += step;
    }
    guard = 0;
    let y = Math.ceil(v.ymin / step) * step;
    while (y <= v.ymax + 1e-9 && guard < 60) {
        guard++;
        const py = syOf(y, H, v);
        ctx.moveTo(OX, py);
        ctx.lineTo(OX + W, py);
        seg++;
        y += step;
    }
    // 空路径不要 stroke：Lite 的 canvas 对「beginPath 之后没有任何线段就 stroke」
    // 没有明确行为约定，真机上疑似会把原生路径留在异常状态，下一次绘制才炸。
    if (seg > 0) { ctx.stroke(); }
    // 收尾：显式把路径置空。真机上怀疑上一帧的路径对象会被原生侧留着，
    // 下一次绘制（哪怕是 fillRect）才炸 —— 每次画完路径都 beginPath 一次最省心。
    ctx.beginPath();
}

function drawAxes(ctx, W, H, v) {
    ctx.strokeStyle = AXIS;
    ctx.lineWidth = 2;
    ctx.beginPath();
    let seg = 0;
    if (v.ymin <= 0 && v.ymax >= 0) {
        const py = syOf(0, H, v);
        ctx.moveTo(OX, py);
        ctx.lineTo(OX + W, py);
        seg++;
    }
    if (v.xmin <= 0 && v.xmax >= 0) {
        const px = sxOf(0, W, v);
        ctx.moveTo(px, OY);
        ctx.lineTo(px, OY + H);
        seg++;
    }
    if (seg > 0) { ctx.stroke(); }
    ctx.beginPath();
}

/**
 * 坐标轴刻度数字。这是「看得懂坐标系」的关键，一个都不能少。
 *
 * 三条硬约束：
 *  - 数量有上限：x 轴最多 4 个、y 轴最多 4 个，400px 的圆屏上再多就挤成一排；
 *  - 位置必须夹在绘图区内：平移后坐标原点可能远在画布外（例如 viewCx=160、half=1 时
 *    px0 会算到 ±24000），把这种坐标直接交给 fillText 是真机上最不该出现的东西；
 *  - 只跳过 0：原点处两条轴交叉，数字会盖住轴线。
 */
const TICK_BASELINE_DX = 17;
const TICK_LABEL_DY = 5;
// 刻度文字缓存。同一组 (步长, 首刻度) 算出来的标签串完全一致，
// 而复用是常态：缩放/平移之后往往还是同一档，反复 num.fmt 出一批新字符串
// 在 64KB 堆上是实打实的回收压力。命中率接近 100%，代价只有一次字符串比较。
const TICK_CACHE_N = 12;
// [0] = x 轴标签表，[1] = y 轴标签表；[2]/[3] 是各自上次的缓存键
const TICK_LABELS = [[], [], '', ''];

function tickLabels(v, step, axis) {
    const isX = (axis === 0);
    const lo = isX ? v.xmin : v.ymin;
    const hi = isX ? v.xmax : v.ymax;
    const first = Math.ceil(lo / step) * step;
    const key = step + '@' + first;
    const arr = TICK_LABELS[axis];
    if (key === TICK_LABELS[2 + axis]) { return arr; }
    arr.length = 0;
    let val = first;
    for (let i = 0; i < TICK_CACHE_N && val <= hi + 1e-9; i++) {
        arr.push(num.fmt(val, 2));
        val += step;
    }
    TICK_LABELS[2 + axis] = key;
    return arr;
}

function drawTicks(ctx, W, H, v, step) {
    const px0 = sxOf(0, W, v);
    const py0 = syOf(0, H, v);
    ctx.fillStyle = TICK_C;
    ctx.font = LABEL_FONT;

    // x 轴刻度：画在 x 轴下方；x 轴跑到画布下缘之外时改画在上方
    let ty = py0 + TICK_BASELINE_DX;
    if (ty > OY + H - 4) { ty = py0 - 6; }
    if (ty < OY + 14) { ty = OY + 14; }
    if (ty > OY + H - 4) { ty = OY + H - 4; }
    ctx.textAlign = 'center';
    const xs = tickLabels(v, step, 0);
    let x = Math.ceil(v.xmin / step) * step;
    for (let i = 0; i < xs.length; i++) {
        const px = sxOf(x, W, v);
        if (Math.abs(x) > 1e-9 && px > OX + 14 && px < OX + W - 14) {
            ctx.fillText(xs[i], px, ty);
        }
        x += step;
    }

    // y 轴刻度：画在 y 轴右侧；y 轴跑到画布外侧时贴到绘图区边上，绝不喂出画布外的坐标
    let lx = px0 + 5;
    if (lx < OX + 4) { lx = OX + 4; }
    if (lx > OX + W - 34) { lx = OX + W - 34; }
    ctx.textAlign = 'left';
    const ys = tickLabels(v, step, 1);
    let y = Math.ceil(v.ymin / step) * step;
    for (let i = 0; i < ys.length; i++) {
        const py = syOf(y, H, v);
        if (Math.abs(y) > 1e-9 && py > OY + 14 && py < OY + H - 4) {
            ctx.fillText(ys[i], lx, py + TICK_LABEL_DY);
        }
        y += step;
    }
}

/**
 * 绘制一条函数曲线。
 * 遇到 NaN/Infinity（定义域外）或相邻点竖直跳变（1/x、tan 的渐近线）时断开路径，
 * 避免出现横贯画布的假竖线。
 */
function drawCurve(ctx, item, color, W, H, v, lw, sampleSteps) {
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
    let drew = false;
    let lastPy = 0;

    for (let i = 0; i <= steps; i++) {
        const x = v.xmin + i * dx;
        const y = curveY(item, x);
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
        drew = true;
        lastPy = py;
    }
    // 整条曲线都在视野之外（例如 y = x^2 + 100 放在 ±8 视野里）时路径是空的，
    // 这时绝不能 stroke —— 空路径 stroke 在 Lite canvas 上没有行为约定。
    if (drew) { ctx.stroke(); }
    ctx.beginPath();
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
    if (!(len > 0) || !isFinite(len)) { return 0; }
    const ux = dx / len;
    const uy = dy / len;
    const step = dash + gap;
    let t = 0;
    let guard = 0;
    let n = 0;
    while (t < len && guard < 400) {
        guard++;
        const t2 = (t + dash < len) ? (t + dash) : len;
        ctx.moveTo(x1 + ux * t, y1 + uy * t);
        ctx.lineTo(x1 + ux * t2, y1 + uy * t2);
        n++;
        t += step;
    }
    return n;
}

// 逐点求值：直接用语法树递归。
// 一条曲线一帧只采样 31 个点，这里省掉的闭包树是常驻内存，
// 换来的 CPU 差异是微秒级 —— 在 64KB 堆上这笔买卖非常划算。
function curveY(item, x) {
    const ast = item.ast;
    if (!ast) { return NaN; }
    return expr.calc(ast, x);
}

function markPoint(ctx, px, py, color, r) {
    ctx.fillStyle = color;
    ctx.fillRect(px - r, py - r, r * 2 + 1, r * 2 + 1);
}

// 标签包围盒对象池。每次重绘都要为每个标注建一个 7 字段对象，
// 反复操作后这些短命对象会把 64KB 级别的堆推高（真机上表现为"多操作几次就崩"）。
// 这里改成模块级复用：每帧开始时 boxTop 归零，从头复用同一批对象。
const BOX_POOL = [];
let boxTop = 0;

function resetBoxPool() {
    boxTop = 0;
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
    let box;
    if (boxTop < BOX_POOL.length) {
        box = BOX_POOL[boxTop];
    } else {
        box = { x: 0, y: 0, w: 0, h: 0, tx: 0, ty: 0, align: '' };
        BOX_POOL.push(box);
    }
    boxTop++;
    box.x = x0;
    box.y = y0;
    box.w = w;
    box.h = h;
    box.tx = tx;
    box.ty = ty;
    box.align = align;
    return box;
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
const LABEL_FS = 15;
const LABEL_FONT = '15px HarmonyOS Sans';

function putLabel(ctx, text, px, py, color, W, H, placed, orders) {
    const w = textWidth(text, LABEL_FS);
    const h = LABEL_FS + 4;
    ctx.font = LABEL_FONT;      // 提成常量：一个标注原本要拼一次字符串
    for (let i = 0; i < orders.length; i++) {
        const box = labelBox(orders[i], px, py, w, h, W, H);
        if (!box) { continue; }
        if (overlapsAny(box, placed)) { continue; }
        placed.push(box);
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
function drawQuadPoints(ctx, quad, W, H, v, placed, vertexOnly, set) {
    // placed 是标注避让表；不复用也可以，传 null 时内部临时建一个
    if (!placed) { placed = []; }
    const st = set || {};
    const dotR = (typeof st.dotSize === 'number' && st.dotSize > 0) ? st.dotSize : 3;
    // 顶点 / 交点 / 截距用统一的配色（不跟曲线颜色走：曲线颜色只用于曲线本身，
    // 标注色高对比固定色，在圆屏小字号下更清楚）
    const cV = VERTEX_C;
    const cR = ROOT_C;
    const cY = YINT_C;
    // 只有点几乎完全重合（< 6px）时才放弃重复标注；稍远一些就交给 putLabel
    // 的方位尝试去避让，避免把「数值不同但位置接近」的坐标误丢。
    const MIN_SEP = 6;

    function inView(x, y) {
        return x >= v.xmin && x <= v.xmax && y >= v.ymin && y <= v.ymax;
    }

    const vx = quad.vertex.x;
    const vy = quad.vertex.y;

    // 对称轴 x = 顶点横坐标，淡色虚线，贯通整个绘图区。
    // 只在「完整标注」时画（vertexOnly 为 false）：对称轴本身调用数不低
    // （虚线要拆成十几段），默认关闭，由设置里的「二次函数对称轴」控制。
    if (!vertexOnly && st.showAxis === 1 && vx >= v.xmin && vx <= v.xmax) {
        const ax = sxOf(vx, W, v);
        ctx.strokeStyle = SYM_C;
        ctx.lineWidth = 1;
        ctx.beginPath();
        // 段长从 6px 加大到 16px：304px 的竖线从 28 段降到 11 段，
        // 单条对称轴的调用数从约 58 次降到约 24 次。仍然是虚线，远看几乎无差别。
        if (dashedSegments(ctx, ax, OY, ax, OY + H, 16, 12) > 0) { ctx.stroke(); }
        ctx.beginPath();
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
        // 顶点标签在分析阶段就拼好存进 quad，重绘时直接取，不再格式化数字
        const tag = quad.labelVertex ||
            ((quad.isMin ? '最小' : '最大') +
                '(' + num.fmt2(vx) + ',' + num.fmt2(vy) + ')');
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
        const rTag = (quad.labelRoots && quad.labelRoots[i])
            ? quad.labelRoots[i] : ('(' + num.fmt2(quad.roots[i]) + ',0)');
        putLabel(ctx, rTag, r[0], r[1], cR, W, H, placed,
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
            const yTag = quad.labelYint || ('(0,' + num.fmt2(cy) + ')');
            putLabel(ctx, yTag, ypx, ypy, cY, W, H, placed,
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

export default {
    makeView: makeView,
    describeQuad: describeQuad,

    /**
     * 全量重绘。funcs 为曲线记录数组，curIdx 指定要标出特殊点的那一条。
     *
     * 接口仍收数组（自测会一次传多条来压测），但**页面只会传一条**：
     * 「全部同屏」已按要求整体移除，画面上任何时刻只有一条函数图像。
     */
    draw: function (ctx, W, H, funcs, curIdx, ox, oy, half, cx, cy, opts) {
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
        // showAxis 默认 0（不画），与 settings 里的默认值保持一致。
        // 早先这里默认是 1，而设置默认是 0 —— 应用运行时因为总是传 snapshot() 所以看不出问题，
        // 但直接调 plot.draw 会得到与界面上不同的结果，属于埋雷。
        const dotSet = { dotSize: dotSize, showAxis: (o.showAxis === 1) ? 1 : 0 };

        // 复用同一个 view 对象，避免每帧新建
        const v = fillView(VIEW_BUF, W, H, half, cx, cy);
        clear(ctx, W, H);
        // 画面等级：0 流畅 / 1 标准 / 2 精细。三个参数直接决定每帧的 canvas 调用次数，
        // 而调用次数是本应用在真机上最敏感的指标（一次重绘上千次调用会撑不住）。
        // 已经整体下调过一轮：曲线采样减半、网格与刻度都更稀。
        // 画面等级：0 流畅 / 1 标准 / 2 精细。
        //
        // 这三个参数直接决定每帧的 canvas 调用次数，而调用次数是本应用在真机上
        // 最敏感的指标 —— 真机实测：绘图页一次重绘超过约 300 次调用后，
        // 从编辑页返回、松手结束平移这类"触发一次完整重绘"的动作就会崩。
        // 键盘页只有 54 次调用，从不崩，所以这里把绘图页也往那个量级压。
        //
        // 采样点既是表达式求值次数，也是一次 lineTo，是绝对大头：
        //   流畅 304px 画布约每 10 像素一个点（30 点），标准约每 6 像素（50 点），
        //   精细约每 4 像素（76 点）。折线在 466 圆屏上仍然看得出是曲线。
        const q = (typeof o.quality === 'number') ? o.quality : 1;
        // 网格与刻度共用同一个步长。早先两处各算各的（网格 target=2~6、刻度 target=1），
        // 于是网格线和刻度数字永远对不上，而且刻度 target=1 意味着「一个区间都拆不出来」——
        // 数字全部消失。现在只算一次：最多 3 个区间（含端点约 4 条线、3~4 个数字）。
        // 区间上限：流畅 4 / 精细 8。一屏 3~4 个刻度数字就够读，多了反而糊。
        const axisMaxInt = (q >= 2) ? 8 : 4;
        const step = niceStep(v.xmax - v.xmin, axisMaxInt);
        // 采样步长再收一档：现在一帧只画一条曲线，但每条曲线都是**一条斜线路径**，
        // 而真机上出问题的正是路径。304px 画布 60 个点（每 5 像素一个）已经看不出折线。
        let sampleSteps = (q >= 2) ? Math.floor(W / 5)
            : (q <= 0 ? Math.floor(W / 10) : Math.floor(W / 7));
        // 采样点上再压一道「总量预算」：每个采样点是一次求值 + 一次 lineTo，
        // 是整次重绘的绝对大头。曲线多了就按条数摊薄，保证总采样数不超过 120，
        // 否则「精细档 + 3 条曲线」会冲到 200 次以上调用 —— 那正是真机崩溃的量级。
        // 单条曲线时这条分支不生效，流畅/标准/精细三档的手感原样保留。
        if (funcs.length > 1) {
            const cap = Math.floor(120 / funcs.length);
            if (sampleSteps > cap) { sampleSteps = (cap < 10) ? 10 : cap; }
        }

        drawGrid(ctx, W, H, v, step);
        drawAxes(ctx, W, H, v);
        drawTicks(ctx, W, H, v, step);
        for (let i = 0; i < funcs.length; i++) {
            const f = funcs[i];
            if (!f) { continue; }
            if (f.ast) { drawCurve(ctx, f, f.color, W, H, v, lw, sampleSteps); }
        }
        // 只有一个标注避让表，复用模块级数组 + 每帧重置对象池，
        // 让这次重绘不再产生这些小对象。
        resetBoxPool();
        const placed = PLACED_BUF;
        placed.length = 0;
        if (curIdx >= 0 && curIdx < funcs.length) {
            const cf = funcs[curIdx];
            if (cf && cf.quad) {
                drawQuadPoints(ctx, cf.quad, W, H, v, placed, !wantRoots, dotSet);
            }
        }
    }
};
