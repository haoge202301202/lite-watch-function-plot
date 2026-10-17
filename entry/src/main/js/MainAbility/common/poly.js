/**
 * 多项式系数提取 + 二次函数特殊点计算。
 *
 * 只有能整理成 y = ax^2 + bx + c（a != 0）的表达式才给出顶点与交点，
 * 其余函数按需求不做特殊点处理。
 *
 * 这里顺带把 canvas 上要写的标注文字也拼好（labelVertex / labelRoots / labelYint）：
 * 这些坐标是固定的，而重绘一次要写好几条标注 —— 每帧重新格式化数字会不断产生
 * 短命字符串，在 64KB 级别的堆上是实打实的压力。
 */
import num from './num';

const MAXDEG = 6;

// 返回实际次数（忽略高位 0）
function degOf(p) {
    let d = p.length - 1;
    while (d > 0 && p[d] === 0) { d--; }
    return d;
}

function isConstPoly(p) {
    return degOf(p) === 0;
}

function polyAdd(a, b, sign) {
    const n = a.length > b.length ? a.length : b.length;
    const out = [];
    for (let i = 0; i < n; i++) {
        const x = i < a.length ? a[i] : 0;
        const y = i < b.length ? b[i] : 0;
        out.push(sign > 0 ? x + y : x - y);
    }
    return out;
}

function polyMul(a, b) {
    const n = a.length + b.length - 1;
    if (n - 1 > MAXDEG) { return null; }
    const out = [];
    for (let i = 0; i < n; i++) { out.push(0); }
    for (let i = 0; i < a.length; i++) {
        const ai = a[i];
        if (ai === 0) { continue; }
        for (let j = 0; j < b.length; j++) {
            out[i + j] += ai * b[j];
        }
    }
    return out;
}

/**
 * 尝试把 AST 展开为多项式系数数组（下标 = 次数）。
 * 不是多项式时返回 null。
 */
function polyOf(node) {
    if (!node) { return null; }
    const t = node.t;
    if (t === 'num') { return [node.v]; }
    if (t === 'var') { return [0, 1]; }
    if (t === 'neg') {
        const a = polyOf(node.a);
        if (!a) { return null; }
        const out = [];
        for (let i = 0; i < a.length; i++) { out.push(-a[i]); }
        return out;
    }
    if (t === 'add' || t === 'sub') {
        const a = polyOf(node.a);
        const b = polyOf(node.b);
        if (!a || !b) { return null; }
        return polyAdd(a, b, t === 'add' ? 1 : -1);
    }
    if (t === 'mul') {
        const a = polyOf(node.a);
        const b = polyOf(node.b);
        if (!a || !b) { return null; }
        return polyMul(a, b);
    }
    if (t === 'div') {
        const a = polyOf(node.a);
        const b = polyOf(node.b);
        if (!a || !b) { return null; }
        if (!isConstPoly(b)) { return null; }   // 除以含 x 的式子不是多项式
        const k = b[0];
        if (k === 0) { return null; }
        const out = [];
        for (let i = 0; i < a.length; i++) { out.push(a[i] / k); }
        return out;
    }
    if (t === 'pow') {
        const a = polyOf(node.a);
        const b = polyOf(node.b);
        if (!a || !b) { return null; }
        if (!isConstPoly(b)) { return null; }
        const e = b[0];
        if (e < 0 || e !== Math.floor(e) || e > MAXDEG) { return null; }
        let out = [1];
        for (let i = 0; i < e; i++) {
            out = polyMul(out, a);
            if (!out) { return null; }
        }
        return out;
    }
    return null;    // call（sin/ln 等）不是多项式
}

/**
 * 二次函数分析。
 * 返回 {a,b,c,vertex:{x,y},isMin,roots:[x...],yIntercept,disc}；不是二次函数返回 null。
 */
function quadInfo(p) {
    if (!p) { return null; }
    if (degOf(p) !== 2) { return null; }
    const a = p[2];
    const b = p.length > 1 ? p[1] : 0;
    const c = p.length > 0 ? p[0] : 0;
    if (!isFinite(a) || a === 0) { return null; }

    const vx = -b / (2 * a);
    const vy = a * vx * vx + b * vx + c;

    const disc = b * b - 4 * a * c;
    const tol = 1e-9 * (Math.abs(b * b) + Math.abs(4 * a * c) + 1);

    const roots = [];
    if (disc > tol) {
        const s = Math.sqrt(disc);
        let x1 = (-b - s) / (2 * a);
        let x2 = (-b + s) / (2 * a);
        if (x1 > x2) { const tmp = x1; x1 = x2; x2 = tmp; }
        roots.push(x1);
        roots.push(x2);
    } else if (disc >= -tol) {
        roots.push(vx);
    }

    // 标注文字一次性拼好（坐标固定，重绘时直接取）
    const labelRoots = [];
    for (let i = 0; i < roots.length; i++) {
        labelRoots.push('(' + num.fmt2(roots[i]) + ',0)');
    }

    return {
        a: a,
        b: b,
        c: c,
        vertex: { x: vx, y: vy },
        isMin: a > 0,
        roots: roots,
        yIntercept: c,
        disc: disc,
        labelVertex: (a > 0 ? '\u6700\u5c0f' : '\u6700\u5927') +
            '(' + num.fmt2(vx) + ',' + num.fmt2(vy) + ')',
        labelRoots: labelRoots,
        labelYint: Math.abs(c) > 1e-9 ? ('(0,' + num.fmt2(c) + ')') : ''
    };
}

export default {
    polyOf: polyOf,
    quadInfo: quadInfo
};
