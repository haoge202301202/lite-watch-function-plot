/**
 * 左右键的焦点循环。
 *
 * pos:  0 = 全部同屏，1..n = 只显示第 (pos-1) 条
 * dir:  +1 = 下一个，-1 = 上一个
 * 返回推进后的 pos。
 *
 * 序列是 全部 -> 第1条 -> ... -> 第n条 -> 全部（环形）。
 * 单独成模块的理由：页面 index.js 依赖 @system.*，电脑端无法 import 做断言；
 * 抽出来之后 tools/selftest 可以直接验证边界（n=0、绕回、越界夹紧）。
 */
function stepFocusPos(pos, n, dir) {
    if (!(n > 0)) { return 0; }
    let p = (typeof pos === 'number' && isFinite(pos)) ? Math.floor(pos) : 0;
    if (p < 0) { p = 0; }
    if (p > n) { p = n; }
    const total = n + 1;
    return (p + dir + total) % total;
}

export default {
    stepFocusPos: stepFocusPos
};
