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
  for (const n of ['expr', 'num', 'poly', 'plot', 'keypad']) {
    let c = fs.readFileSync(path.join(COMMON, n + '.js'), 'utf8');
    c = c.replace(/from '\.\/([a-z0-9]+)'/g, "from './$1.mjs'");
    const f = path.join(tmp, n + '.mjs');
    fs.writeFileSync(f, c, 'utf8');
    mods[n] = await import(pathToFileURL(f).href);
  }
  const expr = mods.expr.default, num = mods.num.default, poly = mods.poly.default, plot = mods.plot.default;
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
        fillRect() { scan('fillRect', arguments); ops.push(['fillRect']); },
        strokeRect() { scan('strokeRect', arguments); },
        fillText(t, x, y) { scan('fillText', [x, y]); ops.push(['fillText', String(t)]); },
        beginPath() { ops.push(['beginPath']); },
        moveTo(x, y) { scan('moveTo', [x, y]); ops.push(['moveTo', x, y]); },
        lineTo(x, y) { scan('lineTo', [x, y]); ops.push(['lineTo', x, y]); },
        closePath() {}, arc() { scan('arc', arguments); }, rect() { scan('rect', arguments); },
        stroke() { ops.push(['stroke']); }
      }
    };
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
  chk('生成折线路径', moves > 20 && lines > 400, 'moveTo=' + moves + ' lineTo=' + lines);
  chk('渐近线断点生效', moves > 12, 'moveTo=' + moves);
  const texts = m.ops.filter((o) => o[0] === 'fillText').map((o) => o[1]);
  chk('标注含"最小"/"最大"', texts.some((t) => t.indexOf('最小') === 0 || t.indexOf('最大') === 0));
  chk('标注含 x 轴交点', texts.some((t) => t.indexOf(',0)') > 0));
  chk('标注含 y 轴截距', texts.some((t) => t.indexOf('(0,') === 0));
  const m2 = makeCtx();
  let threw2 = null;
  try { plot.draw(m2.ctx, 270, 270, [], -1); } catch (e) { threw2 = e.message; }
  chk('空函数列表不抛异常', threw2 === null, threw2);

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
  const limOff = pick(/const lim = this\.ch - (\d+);/, 174);
  const titleY = pick(/ctx\.fillText\(head, W \/ 2, (\d+)\);/, 44);

  let side = W - 60;
  const limH = H - limOff;
  if (side > limH) { side = limH; }
  if (side > 300) { side = 300; }
  side = Math.floor(side);

  console.log('  （参数取自 index.js：oy=' + oy + ' s=' + side + ' bw=' + bw + ' bh=' + bh + ' gap=' + gap + '）');
  check('标题 18字符@20px', center(180), titleY - 16, 180, 21);
  check('绘图区 ' + side, center(side), oy, side, side);
  check('摘要文字 20字符@16px', center(180), oy + side + 6, 180, 16);
  check('按钮行 3x' + bw, center(bw * 3 + gap * 2), oy + side + byOff, bw * 3 + gap * 2, bh);
  // 编辑页：键盘直接跑 keypad.js 的真实布局，逐个键的四个角都要在圆内
  chk('主键盘页键数 = 27（扁平数组 /5）', KEYPAD && KEYPAD.layout(KEYPAD.MAIN_KEYS, W).length / 5 === 27,
    KEYPAD && KEYPAD.layout(KEYPAD.MAIN_KEYS, W).length / 5);
  chk('函数键盘页键数 = 27', KEYPAD && KEYPAD.layout(KEYPAD.FN_KEYS, W).length / 5 === 27,
    KEYPAD && KEYPAD.layout(KEYPAD.FN_KEYS, W).length / 5);
  function scanKeys(name, rows) {
    const flat = KEYPAD.layout(rows, W);
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

(async function main() {
  console.log('函数绘图 · 电脑端自测');
  console.log('工程根: ' + ROOT);
  await runLogic();
  runHml();
  runSyscap();
  runGeom();
  runStateCheck();
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
