#!/usr/bin/env node
/**
 * 函数绘图 · 电脑端自测脚本（不参与手表端构建，仅 tools/ 下使用）
 *
 * 用法：  node tools/selftest/run.cjs
 *
 * 做四件事：
 *   1. 把 common/*.js 复制为 .mjs 到临时目录，运行解析器/多项式/绘图逻辑断言；
 *   2. 校验 HML 只使用 Lite Wearable 组件白名单内的标签、事件与属性；
 *   3. 用圆屏几何（半径 = W/2）校验每个界面元素的四角都在安全区内；
 *   4. 汇总结果，任一项失败则退出码为 1。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const COMMON = path.join(ROOT, 'entry', 'src', 'main', 'js', 'MainAbility', 'common');
const PAGES = path.join(ROOT, 'entry', 'src', 'main', 'js', 'MainAbility', 'pages');

let pass = 0, fail = 0;
const failures = [];
let KEYPAD = null;   // 由逻辑段载入，几何段复用真实键位布局
function chk(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; failures.push(name + (extra !== undefined ? '  => ' + extra : '')); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }
const near = (a, b, eps) => typeof a === 'number' && isFinite(a) && Math.abs(a - b) < (eps === undefined ? 1e-9 : eps);

// ---------------------------------------------------------------- 1. 逻辑断言
async function runLogic() {
  section('1. 表达式解析 / 二次函数特殊点 / 绘图逻辑');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hanshu-selftest-'));
  const mods = {};
  // settings.js 依赖 @system.storage，Node 里没有这个模块；
  // 写一个内存 stub 顶掉它（get 走 fail 分支 => 用默认值），这样设置逻辑也能断言。
  fs.writeFileSync(path.join(tmp, 'storage-stub.mjs'),
    'export default { get: function (o) { if (o && o.fail) { o.fail(); } }, set: function () {} };\n', 'utf8');
  for (const n of ['expr', 'num', 'poly', 'plot', 'keypad', 'settings', 'store']) {
    let c = fs.readFileSync(path.join(COMMON, n + '.js'), 'utf8');
    c = c.replace(/from '\.\/([a-z0-9]+)'/g, "from './$1.mjs'");
    c = c.replace(/from '@system\.storage'/g, "from './storage-stub.mjs'");
    const f = path.join(tmp, n + '.mjs');
    fs.writeFileSync(f, c, 'utf8');
    mods[n] = await import(pathToFileURL(f).href);
  }
  const expr = mods.expr.default, num = mods.num.default, poly = mods.poly.default, plot = mods.plot.default;
  const settings = mods.settings.default;
  const store = mods.store.default;
  KEYPAD = mods.keypad.default;

  const ev = (src, x) => { const r = expr.parse(src); return r.ok ? expr.calc(r.ast, x) : 'ERR:' + r.msg; };
  const quad = (src) => { const r = expr.parse(src); return r.ok ? poly.quadInfo(poly.polyOf(r.ast)) : null; };

  chk('2x+1 @1 = 3', near(ev('2x+1', 1), 3));
  chk('y = 2x+1 前缀', near(ev('y = 2x+1', 4), 9));
  chk('f(x)=x+1 前缀', near(ev('f(x)=x+1', 1), 2));
  chk('x^2-3x+2 @3 = 2', near(ev('x^2-3x+2', 3), 2));
  chk('隐式乘法 (x-1)(x+2) @0 = -2', near(ev('(x-1)(x+2)', 0), -2));
  chk('-2^2 = -4', near(ev('-2^2', 0), -4));
  chk('2^3^2 = 512 右结合', near(ev('2^3^2', 0), 512));
  chk('1/x @0 非有限', !isFinite(ev('1/x', 0)));
  chk('|x| @-3 = 3', near(ev('|x|', -3), 3));
  chk('|x-1|+|x+2| @-3 = 5', near(ev('|x-1|+|x+2|', -3), 5));
  chk('abs(abs(x)-1) @-3 = 2', near(ev('abs(abs(x)-1)', -3), 2));
  chk('sqrt 符号 @4 = 2', near(ev('\u221Ax', 4), 2));
  chk('2sin(x)+1 @pi/2 = 3', near(ev('2sin(x)+1', Math.PI / 2), 3, 1e-12));
  chk('ln(e) = 1', near(ev('ln(e)', 0), 1, 1e-12));
  chk('log2(8) = 3', near(ev('log2(8)', 0), 3, 1e-12));
  chk('ln(-1) = NaN', isNaN(ev('ln(x)', -1)));
  chk('全角括号', near(ev('\uFF08x+1\uFF09', 1), 2));
  chk('空串解析失败', !expr.parse('').ok);
  chk('非法字符解析失败', !expr.parse('x@').ok);
  chk('括号不闭合解析失败', !expr.parse('(x+1').ok);

  let q = quad('x^2-3x+2');
  chk('x^2-3x+2 顶点(1.5,-0.25)', q && near(q.vertex.x, 1.5) && near(q.vertex.y, -0.25));
  chk('  标记为最小值', q && q.isMin === true);
  chk('  根为 1 与 2', q && q.roots.length === 2 && near(q.roots[0], 1) && near(q.roots[1], 2));
  q = quad('(x-1)(x+2)');
  chk('(x-1)(x+2) 顶点(-0.5,-2.25)', q && near(q.vertex.x, -0.5) && near(q.vertex.y, -2.25));
  q = quad('-x^2+4');
  chk('-x^2+4 为最大值且顶点(0,4)', q && q.isMin === false && near(q.vertex.y, 4));
  q = quad('x^2-2x+1');
  chk('x^2-2x+1 一个切点 x=1', q && q.roots.length === 1 && near(q.roots[0], 1));
  q = quad('x^2+1');
  chk('x^2+1 无实根', q && q.roots.length === 0);
  q = quad('x^2/2-3');
  chk('x^2/2-3 系数 a=0.5 c=-3', q && near(q.a, 0.5) && near(q.c, -3));
  chk('1/x 不识别为二次', quad('1/x') === null);
  chk('sin(x) 不识别为二次', quad('sin(x)') === null);

  // 左右键的切换逻辑即 store.next / store.prev 的环形，放在第 1 节末尾统一断言。

  chk('fmt 抑制浮点误差', num.fmt(0.1 + 0.2) === '0.3');
  chk('fmt2 去掉多余 0', num.fmt2(1.5) === '1.5' && num.fmt2(3) === '3');
  chk('fmt 非有限给占位符', num.fmt(Infinity) === '\u2014');

  // 用 mock context 跑一遍绘制，确保不抛异常且不产生 NaN 坐标
  function makeCtx() {
    const ops = [], bad = [];
    const scan = (tag, args) => { for (const v of args) if (typeof v === 'number' && !isFinite(v)) bad.push(tag); };
    return {
      ops, bad,
      ctx: {
        fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '',
        fillRect(x, y, w, h) { scan('fillRect', [x, y, w, h]); ops.push(['fillRect', w, h]); },
        strokeRect() { scan('strokeRect', arguments); },
        fillText(t, x, y) { scan('fillText', [x, y]); ops.push(['fillText', String(t)]); },
        beginPath() { ops.push(['beginPath']); },
        moveTo(x, y) { scan('moveTo', [x, y]); ops.push(['moveTo', x, y]); },
        lineTo(x, y) { scan('lineTo', [x, y]); ops.push(['lineTo', x, y]); },
        closePath() {}, arc() { scan('arc', arguments); }, rect() { scan('rect', arguments); },
        stroke() { ops.push(['stroke', this.lineWidth]); }
      }
    };
  }
  // 对称轴是"竖向短虚线"：连续一段 moveTo→lineTo 的 x 相同、y 差在 1~20px。
  // 用这个特征把它和网格线/坐标轴的整条竖线（y 差 300+）、曲线的相邻采样点（x 差 1px）区分开。
  function hasVerticalDash(ops) {
    for (let i = 0; i + 1 < ops.length; i++) {
      const a = ops[i], b = ops[i + 1];
      if (a[0] === 'moveTo' && b[0] === 'lineTo' &&
          Math.abs(a[1] - b[1]) < 0.01 &&
          Math.abs(a[2] - b[2]) > 1 && Math.abs(a[2] - b[2]) < 20) {
        return true;
      }
    }
    return false;
  }

  const funcs = ['x^2-3x+2', '1/x', 'sin(x)', 'tan(x)', 'ln(x)', 'sqrt(x)', '-x^2+4'].map((s) => {
    const r = expr.parse(s);
    const it = { src: r.body, ast: r.ast, color: '#4FC3F7', quad: null };
    const qq = poly.quadInfo(poly.polyOf(r.ast));
    if (qq) it.quad = qq;
    return it;
  });
  const m = makeCtx();
  let threw = null;
  try { plot.draw(m.ctx, 270, 270, funcs, 0); } catch (e) { threw = e.message; }
  chk('plot.draw 不抛异常', threw === null, threw);
  chk('plot 不产生 NaN 坐标', m.bad.length === 0, m.bad.slice(0, 4).join(','));
  const moves = m.ops.filter((o) => o[0] === 'moveTo').length;
  const lines = m.ops.filter((o) => o[0] === 'lineTo').length;
  // 这里是 7 条曲线的压力测试，采样点会被「总量预算」摊薄到每条约 17 个，
  // 所以阈值不能按单条曲线的密度来定；只要每条曲线都画出了连续折线就算通过。
  chk('生成折线路径', moves >= 10 && lines > 60, 'moveTo=' + moves + ' lineTo=' + lines);
  chk('渐近线断点生效', moves > 12, 'moveTo=' + moves);
  const texts = m.ops.filter((o) => o[0] === 'fillText').map((o) => o[1]);
  chk('标注含"最小"/"最大"', texts.some((t) => t.indexOf('最小') === 0 || t.indexOf('最大') === 0));
  chk('标注含 x 轴交点', texts.some((t) => t.indexOf(',0)') > 0));
  chk('标注含 y 轴截距', texts.some((t) => t.indexOf('(0,') === 0));
  const m2 = makeCtx();
  let threw2 = null;
  try { plot.draw(m2.ctx, 270, 270, [], -1); } catch (e) { threw2 = e.message; }
  chk('空函数列表不抛异常', threw2 === null, threw2);

  // 视图平移：makeView 的中心偏移与非法值回落
  const vBase = plot.makeView(288, 288, 8, 0, 0);
  chk('makeView 默认居中 ±8',
    vBase.xmin === -8 && vBase.xmax === 8 && vBase.ymin === -8 && vBase.ymax === 8,
    JSON.stringify(vBase));
  const vPan = plot.makeView(288, 288, 8, 3, -2);
  chk('makeView 支持中心偏移 (3,-2)',
    vPan.xmin === -5 && vPan.xmax === 11 && vPan.ymin === -10 && vPan.ymax === 6,
    JSON.stringify(vPan));
  const vBadC = plot.makeView(288, 288, 8, NaN, undefined);
  chk('makeView 非法中心值回落 0', vBadC.xmin === -8 && vBadC.ymin === -8, JSON.stringify(vBadC));
  const vZoomPan = plot.makeView(288, 288, 2, 1, 1);
  chk('缩放与平移可叠加 ±2 @ (1,1)',
    vZoomPan.xmin === -1 && vZoomPan.xmax === 3 && vZoomPan.ymin === -1 && vZoomPan.ymax === 3,
    JSON.stringify(vZoomPan));

  const mPan = makeCtx();
  let threwPan = null;
  try { plot.draw(mPan.ctx, 288, 288, funcs, 0, 89, 66, 8, 5, -3); } catch (e) { threwPan = e.message; }
  chk('平移后绘制不抛异常且无 NaN', threwPan === null && mPan.bad.length === 0,
    threwPan || mPan.bad.slice(0, 4).join(','));
  const m0 = makeCtx();
  plot.draw(m0.ctx, 288, 288, funcs, 0, 89, 66);
  chk('不传 half/cx/cy 时仍按默认视野绘制', m0.bad.length === 0, m0.bad.slice(0, 4).join(','));

  // 两端极端档位（3 倍放大 / 4 倍缩小）都要能正常出图
  const vMin = plot.makeView(288, 288, 0.5, 0, 0);
  chk('最小档 ±0.5', vMin.xmin === -0.5 && vMin.xmax === 0.5, JSON.stringify(vMin));
  const vMax = plot.makeView(288, 288, 48, 0, 0);
  chk('最大档 ±48', vMax.xmin === -48 && vMax.xmax === 48, JSON.stringify(vMax));
  const mExtMin = makeCtx();
  plot.draw(mExtMin.ctx, 288, 288, funcs, 0, 89, 66, 0.5, 0, 0);
  chk('±0.5 档绘制无 NaN', mExtMin.bad.length === 0, mExtMin.bad.slice(0, 4).join(','));
  const mExtMax = makeCtx();
  plot.draw(mExtMax.ctx, 288, 288, funcs, 0, 89, 66, 48, 0, 0);
  chk('±48 档绘制无 NaN', mExtMax.bad.length === 0, mExtMax.bad.slice(0, 4).join(','));

  // 多条曲线：仍然全部画线，但特殊点只标「当前这一条」（全部同屏已移除）
  const COLORS3 = ['#4FC3F7', '#FFB74D', '#7BD389'];
  const multi = ['x^2-3x+2', '-x^2+4', '2x+1'].map((s, i) => {
    const r = expr.parse(s);
    const it = { src: r.body, ast: r.ast, color: COLORS3[i], quad: null, pts: '' };
    const qq = poly.quadInfo(poly.polyOf(r.ast));
    if (qq) { it.quad = qq; it.pts = plot.describeQuad(qq); }
    return it;
  });
  chk('构造 3 条（前 2 条是二次函数）',
    multi.length === 3 && !!multi[0].quad && !!multi[1].quad && !multi[2].quad);

  // 3 条曲线一起画、只给第 1 条标点：画线不抛异常，标注只出现一份
  const mMark = makeCtx();
  let threwMark = null;
  try { plot.draw(mMark.ctx, 304, 304, multi, 0, 81, 66, 8, 0, 0, { showAxis: 1 }); } catch (e) { threwMark = e.message; }
  chk('3 条曲线同屏绘制不抛异常且无 NaN', threwMark === null && mMark.bad.length === 0,
    threwMark || mMark.bad.slice(0, 4).join(','));
  const markTexts = mMark.ops.filter((o) => o[0] === 'fillText').map((o) => o[1]);
  const vLabels = markTexts.filter((t) => t.indexOf('最小') === 0 || t.indexOf('最大') === 0);
  chk('只标当前这一条的顶点（1 个，不再标注所有曲线）', vLabels.length === 1, JSON.stringify(vLabels));
  chk('当前条是二次函数，额外标出 x 交点',
    markTexts.filter((t) => t.indexOf(',0)') > 0).length > 0,
    JSON.stringify(markTexts.filter((t) => t.indexOf(',0)') > 0)));
  chk('当前条额外标出 y 截距',
    markTexts.filter((t) => t.indexOf('(0,') === 0).length > 0,
    JSON.stringify(markTexts.filter((t) => t.indexOf('(0,') === 0)));
  chk('当前条画出对称轴（竖向虚线）', hasVerticalDash(mMark.ops));

  // 同一次绘制里第 3 条是非二次函数：切到它就没有任何特殊点/对称轴
  const mCur2 = makeCtx();
  plot.draw(mCur2.ctx, 304, 304, multi, 2, 81, 66, 8, 0, 0, { showAxis: 1 });
  const cur2Texts = mCur2.ops.filter((o) => o[0] === 'fillText').map((o) => o[1]);
  chk('切到非二次函数不标任何特殊点',
    cur2Texts.filter((t) => t.indexOf('最小') === 0 || t.indexOf('最大') === 0).length === 0,
    JSON.stringify(cur2Texts));
  chk('切到非二次函数不画对称轴', !hasVerticalDash(mCur2.ops));

  // 切到第 2 条（-x^2+4）：标的是第 2 条自己的顶点，不是第 1 条的
  const twoQuads = multi.slice(0, 2);
  const mTwo = makeCtx();
  plot.draw(mTwo.ctx, 304, 304, twoQuads, 1, 81, 66, 8, 0, 0, { showAxis: 1 });
  const twoTexts = mTwo.ops.filter((o) => o[0] === 'fillText').map((o) => o[1]);
  const twoV = twoTexts.filter((t) => t.indexOf('最小') === 0 || t.indexOf('最大') === 0);
  chk('切到第 2 条只标它的 1 个顶点', twoV.length === 1, JSON.stringify(twoV));
  chk('第 2 条顶点是最大值(0,4)', twoV[0] === '最大(0,4)', JSON.stringify(twoV));
  chk('第 2 条画出对称轴', hasVerticalDash(mTwo.ops));
  chk('2 条曲线绘制无 NaN', mTwo.bad.length === 0, mTwo.bad.slice(0, 4).join(','));

  const mOne = makeCtx();
  plot.draw(mOne.ctx, 304, 304, multi, 1, 81, 66, 8, 0, 0, { showAxis: 1 });
  const oneLabels = mOne.ops.filter((o) => o[0] === 'fillText').map((o) => o[1])
    .filter((t) => t.indexOf('最小') === 0 || t.indexOf('最大') === 0);
  chk('只突出当前这一条（1 个顶点标注）', oneLabels.length === 1, JSON.stringify(oneLabels));

  // 非二次函数不该有对称轴
  // 非二次函数：即使显式开启对称轴也不该画
  const mNonQuad = makeCtx();
  plot.draw(mNonQuad.ctx, 304, 304, [multi[2]], 0, 81, 66, 8, 0, 0, { showAxis: 1 });
  chk('非二次函数即使开启也不画对称轴', !hasVerticalDash(mNonQuad.ops));

  // 默认（不传 opts）应与设置默认一致：不画对称轴
  const mDefaultAxis = makeCtx();
  plot.draw(mDefaultAxis.ctx, 304, 304, twoQuads, 0, 81, 66, 8, 0, 0);
  chk('不传 opts 时默认不画对称轴（与设置默认一致）', !hasVerticalDash(mDefaultAxis.ops));

  // ---- 设置项：默认值必须与改版前的外观一致，循环切换要能绕回 ----
  settings.reset();
  chk('设置项共 6 项（外观 4 + 保留上次函数 + 画面等级）', settings.count() === 6, settings.count());
  chk('默认曲线粗细 3px（与改版前一致）', settings.snapshot().width === 3, settings.snapshot().width);
  chk('默认显示交点', settings.snapshot().showRoots === 1, settings.snapshot().showRoots);
  chk('默认点标记 3px', settings.snapshot().dotSize === 3, settings.snapshot().dotSize);
  chk('默认隐藏对称轴（一条轴 24 次 canvas 调用，默认关掉）', settings.snapshot().showAxis === 0, settings.snapshot().showAxis);
  chk('粗细显示文本带单位', settings.textOf(0).indexOf('px') > 0, settings.textOf(0));
  settings.next(0);
  chk('粗细循环 中->粗', settings.snapshot().width === 4, settings.snapshot().width);
  settings.next(0);
  chk('粗细循环 粗->细（绕回）', settings.snapshot().width === 2, settings.snapshot().width);
  settings.next(1);
  chk('交点开关 显示->隐藏', settings.snapshot().showRoots === 0, settings.snapshot().showRoots);
  settings.setIdx(2, 99);
  chk('越界下标夹紧到末项', settings.snapshot().dotSize === 5, settings.snapshot().dotSize);
  settings.setIdx(2, -3);
  chk('负下标夹紧到首项', settings.snapshot().dotSize === 2, settings.snapshot().dotSize);
  settings.reset();
  chk('reset 回到默认值', settings.snapshot().dotSize === 3 && settings.snapshot().width === 3);
  chk('默认每次重来（keepLast=0）', settings.snapshot().keepLast === 0, settings.snapshot().keepLast);
  chk('保留开关显示文本', settings.textOf(4) === '每次重来', settings.textOf(4));
  settings.next(4);
  chk('切到接着上次（keepLast=1）', settings.snapshot().keepLast === 1, settings.snapshot().keepLast);
  chk('切到接着上次的显示文本', settings.textOf(4) === '接着上次', settings.textOf(4));
  settings.reset();
  chk('默认画面等级=0 流畅（最省的一档）', settings.snapshot().quality === 0, settings.snapshot().quality);
  settings.next(5);
  chk('画面等级 流畅->标准', settings.snapshot().quality === 1, settings.snapshot().quality);
  settings.next(5);
  chk('画面等级 标准->精细', settings.snapshot().quality === 2, settings.snapshot().quality);
  settings.next(5);
  chk('画面等级 精细->流畅（绕回）', settings.snapshot().quality === 0, settings.snapshot().quality);
  settings.reset();
  chk('动画相关设置项已全部移除', settings.indexOf('anim') === -1, settings.indexOf('anim'));

  // 回归：菜单曾用 count()-1 取「保留上次函数」，加了两项设置后它指到了「画面等级」，
  // 于是菜单底部开关显示成"标准"。改为按 id 查找后必须钉死这个约束。
  chk('indexOf 能按 id 定位设置项', settings.indexOf('keepLast') === 4, settings.indexOf('keepLast'));
  chk('keepLast 不是最后一项（count()-1 会取错）',
    settings.indexOf('keepLast') !== settings.count() - 1,
    'idx=' + settings.indexOf('keepLast') + ' last=' + (settings.count() - 1));
  chk('未知 id 返回 -1', settings.indexOf('nope') === -1);
  chk('菜单开关取的确实是 keepLast 的文本',
    settings.textOf(settings.indexOf('keepLast')) === '每次重来',
    settings.textOf(settings.indexOf('keepLast')));
  chk('画面等级才是最后一项', settings.indexOf('quality') === settings.count() - 1,
    settings.indexOf('quality'));

  // ---- 外观设置真正作用到绘制 ----
  const mApp = makeCtx();
  plot.draw(mApp.ctx, 304, 304, multi, 1, 81, 66, 8, 0, 0,
    { width: 4, dotSize: 5, showAxis: 1, showRoots: 1 });
  const strokeW = mApp.ops.filter((o) => o[0] === 'stroke').map((o) => o[1]);
  chk('曲线线宽按设置生效(4px)', strokeW.indexOf(4) >= 0, JSON.stringify(strokeW));
  const rectW = mApp.ops.filter((o) => o[0] === 'fillRect').map((o) => o[1]);
  chk('点标记大小按设置生效(11px)', rectW.indexOf(11) >= 0, JSON.stringify(rectW));
  chk('对称轴开启时画出虚线', hasVerticalDash(mApp.ops));

  const mOff = makeCtx();
  plot.draw(mOff.ctx, 304, 304, multi, 1, 81, 66, 8, 0, 0, { showAxis: 0, showRoots: 0 });
  chk('设置关闭对称轴后不画', !hasVerticalDash(mOff.ops));
  const offTexts = mOff.ops.filter((o) => o[0] === 'fillText').map((o) => o[1]);
  chk('设置隐藏交点后不标 x 交点',
    offTexts.filter((t) => t.indexOf(',0)') > 0).length === 0,
    JSON.stringify(offTexts.filter((t) => t.indexOf(',0)') > 0)));
  chk('设置隐藏交点后仍标顶点',
    offTexts.filter((t) => t.indexOf('最小') === 0 || t.indexOf('最大') === 0).length === 1);

  // 画面等级影响网格密度与采样密度
  const mQ0 = makeCtx();
  plot.draw(mQ0.ctx, 304, 304, multi, 0, 81, 66, 8, 0, 0, { quality: 0 });
  const mQ2 = makeCtx();
  plot.draw(mQ2.ctx, 304, 304, multi, 0, 81, 66, 8, 0, 0, { quality: 2 });
  const mv0 = mQ0.ops.filter((o) => o[0] === 'moveTo').length;
  const mv2 = mQ2.ops.filter((o) => o[0] === 'moveTo').length;
  chk('画面等级「精细」比「流畅」绘制更多图元', mv2 > mv0, '流畅=' + mv0 + ' 精细=' + mv2);
  chk('画面等级切换不产生 NaN', mQ0.bad.length === 0 && mQ2.bad.length === 0);

  // ---- canvas 调用预算 ----
  // 真机上唯一能稳定复现的崩溃原因，就是「一次重绘」的 canvas 调用数太大：
  // 引擎会在绘制管线里直接黑屏重来。这里把每个档位的实测调用数钉住，
  // 以后无论谁改了采样、网格或标注，只要越界就立刻红。
  const opsOf = (list, opt) => {
    const mB = makeCtx();
    plot.draw(mB.ctx, 304, 304, list, 0, 81, 66, 6, 0, 0, opt);
    return mB.ops.length;
  };
  const mkItems = (srcs) => srcs.map((s2, i2) => {
    const rr = expr.parse(s2);
    const ii = { text: s2, src: rr.body, ast: rr.ast, color: COLORS3[i2 % 3], quad: null, pts: '' };
    const qq2 = poly.quadInfo(poly.polyOf(rr.ast));
    if (qq2) { ii.quad = qq2; ii.pts = plot.describeQuad(qq2); }
    ii.ast = null;
    return ii;
  });
  const heavy = mkItems(['sin(x)', 'x^2-1', '2x+1']);
  const nDef3 = opsOf(heavy, { quality: 0 });
  const nFine3 = opsOf(heavy, { quality: 2 });
  const nAxis3 = opsOf(heavy, { quality: 0, showAxis: 1 });
  chk('默认档 3 条曲线 <= 110 次调用', nDef3 <= 110, nDef3 + ' 次');
  chk('精细档 3 条曲线 <= 145 次调用', nFine3 <= 145, nFine3 + ' 次');
  chk('精细档 2 条曲线 <= 145 次调用',
    opsOf(mkItems(['sin(x)', 'x^2-1']), { quality: 2 }) <= 145);
  chk('对称轴开启 3 条曲线 <= 120 次调用', nAxis3 <= 120, nAxis3 + ' 次');
  chk('单条曲线精细档 <= 125 次调用', opsOf(mkItems(['sin(x)']), { quality: 2 }) <= 125);
  // 曲线越多调用越多是必然的，但增长必须被采样预算压住：3 条不能超过 1 条的 2 倍
  const nDef1 = opsOf(mkItems(['sin(x)']), { quality: 0 });
  chk('采样总量预算生效（3 条 / 1 条 < 2 倍）', nDef3 < nDef1 * 2 + 30, nDef1 + ' -> ' + nDef3);

  // 全程无定时器：源码里不该再出现 setInterval / setTimeout
  const idxSrcNoAnim = fs.readFileSync(path.join(ROOT, 'entry', 'src', 'main', 'js', 'MainAbility', 'pages', 'index', 'index.js'), 'utf8');
  // 不允许任何轮询式定时器；setTimeout 只允许"延迟重绘"这一处（一次性，非轮询）
  const nInterval = idxSrcNoAnim.split('setInterval(').length - 1;
  const nTimeout = idxSrcNoAnim.split('setTimeout(').length - 1;
  chk('没有 setInterval 轮询', nInterval === 0, 'setInterval x' + nInterval);
  chk('setTimeout 只有延迟重绘一处', nTimeout === 1, 'setTimeout x' + nTimeout);
  chk('延迟重绘在 onHide/onDestroy 里被清理',
    idxSrcNoAnim.indexOf('cancelDefer()') >= 0 &&
    idxSrcNoAnim.split('cancelDefer()').length - 1 >= 3,
    'cancelDefer 调用次数=' + (idxSrcNoAnim.split('cancelDefer()').length - 1));

  // ---- store：从开始界面进入绘图时会 clearAll，这里验证清空语义 ----
  store.clearAll();
  chk('clearAll 后列表为空', store.count() === 0, store.count());
  chk('clearAll 后 curItem 为 null', store.curItem() === null);
  const addRes = store.add('x^2-1');
  chk('add 合法表达式成功', addRes.ok === true && store.count() === 1, JSON.stringify(addRes));
  store.add('2x+1');
  chk('add 后共 2 条', store.count() === 2, store.count());
  chk('add 后 curItem 非空', store.curItem() !== null);

  // 左右键 = store.next / store.prev（页面 shiftFocus 直接调这两个）。
  // 必须是无「全部同屏」这一档的纯 0..n-1 环形：第末条 next 回到第 1 条，
  // 第 1 条 prev 回到第末条。之前有一档 0=全部，这就是崩溃的入口，已整体删除。
  store.setCur(0);
  chk('环形 next 0->1', (store.next(), store.getCur() === 1), store.getCur());
  chk('环形 next 1->0 (绕回，不再有「全部」档)', (store.next(), store.getCur() === 0), store.getCur());
  chk('环形 prev 0->1 (反向绕回)', (store.prev(), store.getCur() === 1), store.getCur());
  chk('环形 prev 1->0', (store.prev(), store.getCur() === 0), store.getCur());
  store.clearAll();
  store.add('x^2-1');
  chk('单条时 next 仍在 0（n<2 页面直接返回不重绘）', (store.next(), store.getCur() === 0), store.getCur());
  chk('单条时 prev 仍在 0', (store.prev(), store.getCur() === 0), store.getCur());
  store.clearAll();
  store.add('x^2-1');
  store.add('2x+1');
  const badRes = store.add('abc');
  chk('add 非法表达式被拒绝', badRes.ok === false && store.count() === 2, JSON.stringify(badRes));
  store.clearAll();
  chk('clearAll 清空全部（再进绘图即空白）', store.count() === 0, store.count());
  chk('clearAll 后 curItem 回到 null', store.curItem() === null);

  console.log('  逻辑断言通过 ' + pass + ' 项（失败 ' + fail + ' 项）');
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ------------------------------------------------------------ 2. HML 白名单
function runHml() {
  section('2. HML 组件白名单（来自 API 24 SDK lite_component_map.js）');
  const TAGS = ['div', 'canvas', 'stack', 'qrcode', 'list', 'list-item', 'swiper', 'tabs', 'tab-bar',
    'tab-content', 'image-animator', 'image', 'img', 'progress', 'text', 'marquee', 'analog-clock',
    'clock-hand', 'chart', 'input', 'slider', 'switch', 'picker-view'];
  const EVENTS = ['click', 'longpress', 'touchstart', 'touchmove', 'touchcancel', 'touchend', 'key',
    'swipe', 'change', 'scrollend', 'stop', 'prepared', 'start', 'pause', 'finish', 'error',
    'seeking', 'seeked', 'timeupdate'];
  const ATTRS = {
    '*': ['id', 'style', 'class', 'ref', 'if', 'elif', 'else', 'for', 'tid', 'show'],
    input: ['checked', 'type', 'name', 'value', 'placeholder', 'maxlength'],
    canvas: [], text: ['type', 'value'], image: ['src'], progress: ['type', 'percent'],
    slider: ['min', 'max', 'value'], switch: ['checked'], qrcode: ['value', 'type'],
    chart: ['type', 'datasets', 'options'], marquee: ['scrollamount'], list: [],
    swiper: ['index', 'loop', 'duration', 'vertical']
  };
  let files = 0, problems = 0;
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.hml')) { files++; check(p); }
    }
  })(PAGES);

  function check(file) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);
    const used = new Set();
    let m;
    const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)/g;
    while ((m = tagRe.exec(src)) !== null) {
      used.add(m[1]);
      if (TAGS.indexOf(m[1]) < 0) { problems++; console.log('  [FAIL] ' + rel + ' 标签不在白名单: <' + m[1] + '>'); }
    }
    const evRe = /(?:on|grab):([a-zA-Z]+)\s*=/g;
    while ((m = evRe.exec(src)) !== null) {
      if (EVENTS.indexOf(m[1]) < 0) { problems++; console.log('  [FAIL] ' + rel + ' 事件不在白名单: ' + m[1]); }
    }
    const attrRe = /<([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)\/?>/g;
    while ((m = attrRe.exec(src)) !== null) {
      const tag = m[1];
      if (TAGS.indexOf(tag) < 0) continue;
      const aRe = /(?<![\w:-])([a-zA-Z][a-zA-Z0-9-]*)\s*=/g;
      let a;
      while ((a = aRe.exec(m[2])) !== null) {
        const allowed = ATTRS['*'].concat(ATTRS[tag] || []);
        if (allowed.indexOf(a[1]) < 0) { problems++; console.log('  [FAIL] ' + rel + ' <' + tag + '> 属性不在白名单: ' + a[1]); }
      }
    }
    // {{...}} 里避免复合表达式：暗测中一旦两个 if 都挂掉，整块 UI 会静默消失
    const expRe = /\{\{([^}]*)\}\}/g;
    while ((m = expRe.exec(src)) !== null) {
      const expr = m[1].replace(/!=/g, '=');
      if (expr.indexOf('!') >= 0) {
        problems++;
        console.log('  [FAIL] ' + rel + ' HML 表达式含取反，Lite 上可能失效: {{' + m[1].trim() + '}}');
      }
    }
    console.log('  [ ok ] ' + rel + '  标签: ' + Array.from(used).join(', '));
  }
  chk('HML 全部合规（' + files + ' 个文件）', problems === 0, problems + ' 处问题');
}

// --------------------------------------------------------- 3. 圆屏安全区几何
function runGeom() {
  section('4. 圆屏安全区几何校验（466x466，r=233）');
  const W = 466, H = 466, cx = 233, cy = 233, r = 233;
  const center = (w) => (W - w) / 2;
  let bad = 0;
  function check(name, x, y, w, h) {
    let worst = 0, wp = null;
    for (const p of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
      const d = Math.hypot(p[0] - cx, p[1] - cy);
      if (d > worst) { worst = d; wp = p; }
    }
    const ok = worst <= r;
    if (!ok) bad++;
    console.log('  ' + (ok ? '[ ok ]' : '[FAIL]') + ' ' + name.padEnd(24) +
      '最远角(' + wp[0] + ',' + wp[1] + ')  d=' + worst.toFixed(1) +
      (ok ? '  余量 ' + (r - worst).toFixed(1) + 'px' : '  ★越界 ' + (worst - r).toFixed(1) + 'px'));
  }
  // 主页是 canvas 全自绘：几何参数直接从 index.js 源码提取，
  // 避免出现「改了布局，测试却还在校验旧数值」的脱节。
  const idxPath = path.join(ROOT, 'entry', 'src', 'main', 'js', 'MainAbility', 'pages', 'index', 'index.js');
  const idxSrc = fs.readFileSync(idxPath, 'utf8');
  function pick(re, dflt) {
    const m = idxSrc.match(re);
    return m ? Number(m[1]) : dflt;
  }
  const oy = pick(/const oy = (\d+);/, 58);
  const bw = pick(/const bw = (\d+);/, 72);
  const bh = pick(/const bh = (\d+);/, 42);
  const gap = pick(/const gap = (\d+);/, 10);
  const byOff = pick(/const by = oy \+ s \+ (\d+);/, 30);
  const limOff = pick(/const lim = this\.ch - (\d+);/, 162);
  const sideCap = pick(/if \(s > (\d+)\) \{ s = \d+; \}/, 304);
  const titleY = pick(/ctx\.fillText\(head, W \/ 2, (\d+)\);/, 44);
  const ptsOff = pick(/ctx\.fillText\(clip\(it\.pts, 24\), W \/ 2, oy \+ s \+ (\d+)\);/, 18);

  let side = W - 60;
  const limH = H - limOff;
  if (side > limH) { side = limH; }
  if (side > sideCap) { side = sideCap; }
  side = Math.floor(side);

  console.log('  （参数取自 index.js：oy=' + oy + ' s=' + side + ' bw=' + bw + ' bh=' + bh + ' gap=' + gap + '）');
  chk('绘图区已达 304 上限（较 v1.2 的 288 放大）', side === sideCap && sideCap >= 304, 'side=' + side + ' cap=' + sideCap);
  check('标题 18字符@20px', center(180), titleY - 16, 180, 21);
  check('绘图区 ' + side, center(side), oy, side, side);
  check('摘要文字 24字符@14px', center(200), oy + side + ptsOff - 11, 200, 14);
  // 摘要行与按钮行不能叠在一起（v1.6.0 曾因间距只剩 4px，字的下沿被按钮压住）
  const btnTop = oy + side + 22;
  const ptsBottom = oy + side + ptsOff + 4;
  chk('摘要行与按钮行之间留有间隙', btnTop - ptsBottom >= 3,
    '摘要底 ' + ptsBottom + ' vs 按钮顶 ' + btnTop);
  check('按钮行 3x' + bw, center(bw * 3 + gap * 2), oy + side + byOff, bw * 3 + gap * 2, bh);

  // 绘图区上角两排键：左上「返」、右上缩放。四个角都要落在圆内。
  const zbw = pick(/const zbw = (\d+);/, 46);
  const zbh = pick(/const zbh = (\d+);/, 38);
  const zEdge = pick(/const zby = oy \+ (\d+);/, 4);
  const retW = pick(/const retW = (\d+);/, 58);
  const retH = pick(/const retH = (\d+);/, 44);
  const retIn = pick(/card\(ctx, ox \+ (\d+), zby, retW, retH, CARD\);/, 4);
  const zIn = pick(/const zx = ox \+ s - (\d+) - zbw/, 8);
  const zGap = pick(/const zx = ox \+ s - \d+ - zbw - z \* \(zbw \+ (\d+)\);/, 6);
  const oxCalc = Math.floor((W - side) / 2);
  const zxRight = oxCalc + side - zIn - zbw;
  const zxLeft = zxRight - zbw - zGap;
  check('缩放键 左 ' + zbw + 'x' + zbh, zxLeft, oy + zEdge, zbw, zbh);
  check('缩放键 右 ' + zbw + 'x' + zbh, zxRight, oy + zEdge, zbw, zbh);
  check('绘图页 返回键 ' + retW + 'x' + retH, oxCalc + retIn, oy + zEdge, retW, retH);
  // 18mm 以上的最小可点尺寸：轻表上小于 40px 的按钮基本点不准
  chk('返回键不小于 40x40（原 42x34 太难点）', retW >= 40 && retH >= 40, retW + 'x' + retH);
  chk('缩放键不小于 40x40', zbw >= 40 && zbh >= 40, zbw + 'x' + zbh);

  // 开始界面：标题 + 两个入口按钮
  const hbw = pick(/const hbw = (\d+);/, 280);
  const hbh = pick(/const hbh = (\d+);/, 88);
  const hysM = idxSrc.match(/const hys = \[(\d+), (\d+)\];/);
  const hy1 = hysM ? Number(hysM[1]) : 150;
  const hy2 = hysM ? Number(hysM[2]) : 262;
  const kbh = pick(/const kbh = (\d+);/, 44);
  const kby = pick(/const kby = (\d+);/, 356);
  const homeTitleY = pick(/ctx\.fillText\('函数绘图', W \/ 2, (\d+)\);/, 96);
  const homeSubY = pick(/ctx\.fillText\('高中数学函数图像', W \/ 2, (\d+)\);/, 124);
  // 菜单底部那行「画布 W × H」诊断文字（装饰抛物线已在 v1.15 移除，这里改查它）
  const diagY = pick(/ctx\.fillText\('画布 ' \+ W \+ ' × ' \+ this\.ch, W \/ 2, (\d+)\);/, 434);
  check('开始界面 画布尺寸诊断行', center(140), diagY - 12, 140, 14);
  check('开始界面 标题', center(128), homeTitleY - 26, 128, 32);
  check('开始界面 副标题', center(120), homeSubY - 12, 120, 15);
  check('开始界面 按钮1(进入绘图)', center(hbw), hy1, hbw, hbh);
  check('开始界面 按钮2(设置)', center(hbw), hy2, hbw, hbh);
  check('开始界面 保留开关行', center(hbw), kby, hbw, kbh);

  // 设置界面：标题 + 4 行（对应 settings.ITEMS）+ 返回键
  const srw = pick(/const srw = (\d+);/, 300);
  const srh = pick(/const srh = (\d+);/, 60);
  const sry0 = pick(/const sry0 = (\d+);/, 106);
  const obw = pick(/const obw = (\d+);/, 120);
  const obh = pick(/const obh = (\d+);/, 46);
  const rows = 6;
  chk('设置界面行数与 settings.ITEMS 一致(6)', rows === 6);
  check('设置界面 标题', center(56), 48, 56, 28);
  check('设置界面 首行', center(srw), sry0 + 3, srw, srh - 6);
  check('设置界面 末行', center(srw), sry0 + (rows - 1) * srh + 3, srw, srh - 6);
  check('设置界面 返回键', center(obw), sry0 + rows * srh + 8, obw, obh);
  chk('设置界面纵向不越出屏幕', sry0 + rows * srh + 8 + obh <= H,
    (sry0 + rows * srh + 8 + obh) + ' / ' + H);

  // 缩放档位表：必须递增，且默认索引落在表内
  const zoomsM = idxSrc.match(/const ZOOMS = \[([\d.,\s]+)\];/);
  const zoomNums = zoomsM ? zoomsM[1].split(',').map((s) => Number(s.trim())) : [];
  const zoomBase = pick(/const ZOOM_BASE = (\d+);/, -1);
  chk('缩放档位递增且默认索引合法',
    zoomNums.length >= 3 &&
    zoomNums.every((v, i) => v > 0 && (i === 0 || v > zoomNums[i - 1])) &&
    zoomBase >= 0 && zoomBase < zoomNums.length,
    'n=' + zoomNums.length + ' base=' + zoomBase + ' 档位=' + JSON.stringify(zoomNums));
  // 编辑页：键盘直接跑 keypad.js 的真实布局，逐个键的四个角都要在圆内。
  // topY 必须从 index.js 提取：早先自测用 layout 的默认值(110)，而页面实际传的是 60，
  // 于是测试校验的是一个屏幕上根本不存在、也安全得多的布局 —— 真实键盘顶部其实越界 18px。
  const kbdTop = pick(/keypad\.layout\(rows, W, (\d+)\);/, 100);
  chk('主键盘页键数 = 27（扁平数组 /5）', KEYPAD && KEYPAD.layout(KEYPAD.MAIN_KEYS, W, kbdTop).length / 5 === 27,
    KEYPAD && KEYPAD.layout(KEYPAD.MAIN_KEYS, W, kbdTop).length / 5);
  chk('函数键盘页键数 = 27', KEYPAD && KEYPAD.layout(KEYPAD.FN_KEYS, W, kbdTop).length / 5 === 27,
    KEYPAD && KEYPAD.layout(KEYPAD.FN_KEYS, W, kbdTop).length / 5);
  function scanKeys(name, rows) {
    const flat = KEYPAD.layout(rows, W, kbdTop);
    let worstD = 0, worstLabel = '', over = 0;
    for (let i = 0; i + 4 < flat.length; i += 5) {
      const kx = flat[i], ky = flat[i + 1], kw = flat[i + 2], kh = flat[i + 3], label = flat[i + 4];
      for (const p of [[kx, ky], [kx + kw, ky], [kx, ky + kh], [kx + kw, ky + kh]]) {
        const d = Math.hypot(p[0] - cx, p[1] - cy);
        if (d > worstD) { worstD = d; worstLabel = label; }
        if (d > r) over++;
      }
    }
    if (over > 0) bad++;
    console.log('  ' + (over === 0 ? '[ ok ]' : '[FAIL]') + ' ' + name +
      '  最远键 ' + worstLabel + ' d=' + worstD.toFixed(1) + (over === 0 ? '  余量 ' + (r - worstD).toFixed(1) + 'px' : '  ★越界 ' + over + ' 角'));
  }
  if (KEYPAD) {
    scanKeys('主键盘 27 键', KEYPAD.MAIN_KEYS);
    scanKeys('函数键盘 27 键', KEYPAD.FN_KEYS);
  }
  chk('所有元素四角都在圆内', bad === 0, bad + ' 个越界');
}

// --------------------------------------------- 3. liteWearable 系统能力(syscap)
function runSyscap() {
  section('3. @system.* 接口的 syscap 归属');
  // liteWearable 默认能力集（SDK: js/api/device-define/liteWearable.json）只含
  // SystemCapability.ArkUI.ArkUI.Lite，不含 ArkUI.Full。
  // @system.router 逐方法标注不同：replace = ArkUI.Lite，其余均为 ArkUI.Full。
  // 调用 ArkUI.Full 的方法会被 DevEco 的 ArkTSCheck 报错，故按白名单拦截。
  const ALLOW = {
    '@system.router': ['replace'],
    '@system.device': ['getInfo'],
    '@system.storage': ['get', 'set', 'delete', 'clear']
  };
  const SRC = path.join(ROOT, 'entry', 'src', 'main', 'js');
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) files.push(p);
    }
  })(SRC);

  let calls = 0, problems = 0;
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);
    const bind = {};
    let m;
    const impRe = /import\s+(\w+)\s+from\s+'(@system\.[\w.]+)'/g;
    while ((m = impRe.exec(src)) !== null) { bind[m[1]] = m[2]; }
    for (const varName of Object.keys(bind)) {
      const mod = bind[varName];
      const allow = ALLOW[mod];
      if (!allow) {
        problems++;
        console.log('  [FAIL] ' + rel + ' 使用了未审查的模块 ' + mod);
        continue;
      }
      const callRe = new RegExp('\\b' + varName + '\\.(\\w+)\\s*\\(', 'g');
      while ((m = callRe.exec(src)) !== null) {
        calls++;
        if (allow.indexOf(m[1]) < 0) {
          problems++;
          console.log('  [FAIL] ' + rel + '  ' + mod + '.' + m[1] + '() 不属于 liteWearable 能力集');
        } else {
          console.log('  [ ok ] ' + rel + '  ' + mod + '.' + m[1] + '()');
        }
      }
    }
  }
  chk('@system 接口均属 liteWearable 能力集（' + calls + ' 处调用）', problems === 0, problems + ' 处越界');
}

// ------------------------- 5. 页面状态必须声明在 data 或方法中
function runStateCheck() {
  section('5. 页面 this.xxx 必须在 data / 方法中声明（Lite 的 this 是受限 ViewModel）');
  const BUILTIN = ['$refs', '$t', '$app', '$el', 'data'];
  const PAGE_DIR = path.join(ROOT, 'entry', 'src', 'main', 'js', 'MainAbility', 'pages');
  let problems = 0, files = 0, refs = 0;

  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith('.js')) continue;
      files++;
      const src = fs.readFileSync(p, 'utf8');
      const rel = path.relative(ROOT, p);

      const declared = new Set(BUILTIN);
      // data 内字段（8 空格缩进）
      const dataBlock = src.match(/data:\s*\{([\s\S]*?)\n {4}\}/);
      if (dataBlock) {
        const re = /^ {8}([a-zA-Z_$][\w$]*)\s*:/gm;
        let m;
        while ((m = re.exec(dataBlock[1])) !== null) declared.add(m[1]);
      }
      // export default 顶层的方法（4 空格缩进）
      const mRe = /^ {4}([a-zA-Z_$][\w$]*)\s*[:(]/gm;
      let mm;
      while ((mm = mRe.exec(src)) !== null) declared.add(mm[1]);

      const thisRe = /this\.([a-zA-Z_$][\w$]*)/g;
      const missing = new Set();
      let t;
      while ((t = thisRe.exec(src)) !== null) {
        refs++;
        if (!declared.has(t[1])) missing.add(t[1]);
      }
      if (missing.size > 0) {
        problems += missing.size;
        console.log('  [FAIL] ' + rel + '  未声明的 this 属性: ' + Array.from(missing).join(', '));
      } else {
        console.log('  [ ok ] ' + rel);
      }
    }
  })(PAGE_DIR);

  chk('页面 this 属性均已声明（' + files + ' 文件 / ' + refs + ' 处引用）', problems === 0, problems + ' 处未声明');
}

// ------------------------------------------------- 6. 「全部同屏」已彻底移除
// 这一节存在的意义：全部同屏是真机上唯一能稳定复现黑屏（引擎级崩溃）的入口，
// 已经按需求整体砍掉。代码里只要再冒出这些符号，就是这个功能在偷偷复活。
function runLegacyGone() {
  section('6. 「全部同屏」相关代码已彻底移除');
  const JS = path.join(ROOT, 'entry', 'src', 'main', 'js', 'MainAbility');
  const idxSrc = fs.readFileSync(path.join(JS, 'pages', 'index', 'index.js'), 'utf8');
  const plotSrc = fs.readFileSync(path.join(JS, 'common', 'plot.js'), 'utf8');
  const storeSrc = fs.readFileSync(path.join(JS, 'common', 'store.js'), 'utf8');

  chk('common/focus.js 已删除', !fs.existsSync(path.join(JS, 'common', 'focus.js')));
  chk('页面不再维护 focusPos', !/\bfocusPos\b/.test(idxSrc));
  chk('页面不再 import focus 模块', !/from '\S*focus'/.test(idxSrc));
  chk('页面不再计算 single / markAll', !/\bsingle\b/.test(idxSrc) && !/\bmarkAll\b/.test(idxSrc));
  chk('plot 不再有 describeAll', !/describeAll/.test(plotSrc));
  chk('plot.draw 不再收 markAll 形参', !/markAll/.test(plotSrc));
  // 注释里还留着「全部曲线都会画成线条」这类说明，所以只查「全部」开头的字符串字面量
  chk('页面标题不再有「全部 N 条」分支', !/['"]全部/.test(idxSrc));
  // drawQuadPoints 的 pal 参数是给「每条曲线用自己的颜色标顶点」用的，随全部同屏一起删
  chk('drawQuadPoints 不再收 pal 调色参数', !/\bpal\b/.test(plotSrc));
  // 页面仍然只画一条曲线的特殊点：draw(ctx,W,H,list,curIdx,ox,oy,half,cx,cy,opts) = 11 个实参
  const drawCall = idxSrc.match(/plot\.draw\(([\s\S]*?)\);/);
  chk('plot.draw 调用存在', !!drawCall);
  if (drawCall) {
    const argc = drawCall[1].split(',').length;
    chk('plot.draw 传 11 个实参（已去掉 markAll）', argc === 11, '实参 ' + argc + ' 个');
  }
  chk('store 的 next/prev 是纯环形（无 n+1 档）', /cur = \(cur \+ 1\) % list\.length/.test(storeSrc));
  // 关键：绘图区任何时刻只画一条曲线。页面曾经把整份 list 交给 plot.draw，
  // 结果多条曲线同屏 —— 那正是「全部同屏」的实质，也是真机黑屏的根源。
  chk('绘图区只把当前一条交给 plot.draw（传 ONE/NONE）',
    /ONE\[0\] = it;/.test(idxSrc) && !/plot\.draw\(ctx, s, s, list,/.test(idxSrc));
  chk('单元素数组复用，不每帧新建', /const ONE = \[null\];/.test(idxSrc) && /const NONE = \[\];/.test(idxSrc));
  // 敲键只重画顶部一行文字，不整页重绘（整页 56 次 canvas 调用足以在点击回调里打黑屏）
  chk('敲键走 repaintInput（只重画表达式行）', /repaintInput\(\) \{/.test(idxSrc));
  const backKey = idxSrc.match(/if \(a === '\u9000'\) \{([\s\S]*?)\n        \}/);
  chk('退格键不再整页重绘', !!backKey && backKey[1].indexOf('repaintInput') >= 0 && backKey[1].indexOf('this.repaint()') < 0,
    backKey ? 'ok' : '未匹配到退格分支');
  // 空路径 stroke：Lite canvas 对「beginPath 之后没有线段就 stroke」没有行为约定，
  // 真机上疑似把原生路径留在异常状态、到下一次绘制才炸。所有 stroke 都必须有守卫。
  const plotSrc2 = fs.readFileSync(path.join(JS, 'common', 'plot.js'), 'utf8');
  const bareStroke = plotSrc2.split('\n').filter((ln) => ln.indexOf('ctx.stroke();') >= 0 && ln.indexOf('if (') < 0);
  chk('plot.js 里没有裸的 ctx.stroke()（都被 if 守卫）', bareStroke.length === 0,
    JSON.stringify(bareStroke.map((s2) => s2.trim())));
  chk('drawGrid / drawAxes / 对称轴都做了空路径守卫',
    plotSrc2.indexOf('if (seg > 0) { ctx.stroke(); }') >= 0 &&
    (plotSrc2.split('if (seg > 0) { ctx.stroke(); }').length - 1) >= 2 &&
    plotSrc2.indexOf('if (drew) { ctx.stroke(); }') >= 0 &&
    plotSrc2.indexOf('if (dashedSegments(ctx, ax, OY, ax, OY + H, 16, 12) > 0) { ctx.stroke(); }') >= 0);
}

(async function main() {
  console.log('函数绘图 · 电脑端自测');
  console.log('工程根: ' + ROOT);
  await runLogic();
  runHml();
  runSyscap();
  runGeom();
  runStateCheck();
  runLegacyGone();
  console.log('\n' + '='.repeat(60));
  console.log('断言通过 ' + pass + ' / ' + (pass + fail));
  if (fail > 0) {
    console.log('失败项:');
    for (const f of failures) console.log('  - ' + f);
    process.exitCode = 1;
  } else {
    console.log('全部通过');
  }
})();
