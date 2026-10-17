/**
 * 数值显示格式化：抑制浮点误差（避免出现 0.30000000000000004 这类结果）。
 * 不依赖 toFixed（轻手表上对极小/极大值的表现未经验证，统一走手算）。
 */
function fmt(v, digits) {
    if (typeof v !== 'number' || !isFinite(v)) { return '\u2014'; }
    const d = (digits === undefined || digits === null) ? 3 : digits;
    const f = Math.pow(10, d);
    const r = Math.round(v * f) / f;
    if (r === 0) { return '0'; }
    const s = String(r);
    if (s.length > 12) {
        // 超大或超小量级改用科学计数法，避免撑破画布
        return v.toExponential(2);
    }
    return s;
}

// 去掉末尾多余的 0 和小数点（用于顶点/交点坐标）
function fmt2(v) {
    const s = fmt(v, 3);
    if (s.indexOf('e') >= 0 || s === '\u2014') { return s; }
    if (s.indexOf('.') < 0) { return s; }
    let e = s.length;
    while (e > 0 && s.charAt(e - 1) === '0') { e--; }
    if (e > 0 && s.charAt(e - 1) === '.') { e--; }
    return s.substring(0, e);
}

export default {
    fmt: fmt,
    fmt2: fmt2
};
