/**
 * 数学表达式解析与求值（轻鸿蒙 Lite Wearable / JerryScript）
 *
 * 支持：数字、自变量 x、常量 pi/π/e、运算符 + - * / ^、
 *      括号、绝对值 |x|、隐式乘法（2x、3(x+1)、2sin(x)、(x+1)(x-1)）、
 *      函数 sin cos tan asin acos atan sqrt/√ abs ln lg log log2 exp
 * 不使用 eval / new Function，避免轻手表运行时的动态执行限制。
 */

// 支持的函数名白名单
const FN = {
    sin: 1, cos: 1, tan: 1,
    asin: 1, acos: 1, atan: 1,
    sqrt: 1, abs: 1,
    ln: 1, lg: 1, log: 1, log2: 1, exp: 1
};

function isDigit(c) {
    return c >= '0' && c <= '9';
}

function isLetter(c) {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}

/**
 * 词法分析：字符串 -> token 数组。
 * token 形如 { t: 'num'|'id'|'op'|'lp'|'rp'|'bar', v: ... }
 * 返回 null 表示存在无法识别的字符。
 */
function tokenize(src) {
    const out = [];
    const n = src.length;
    let i = 0;
    while (i < n) {
        const c = src.charAt(i);
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
        // 全角/中文输入法常见符号归一化
        if (c === '\uFF08') { out.push({ t: 'lp' }); i++; continue; }
        if (c === '\uFF09') { out.push({ t: 'rp' }); i++; continue; }
        if (c === '\uFF0B') { out.push({ t: 'op', v: '+' }); i++; continue; }
        if (c === '\uFF0D' || c === '\u2212') { out.push({ t: 'op', v: '-' }); i++; continue; }
        if (c === '\u00D7' || c === '\u00B7') { out.push({ t: 'op', v: '*' }); i++; continue; }
        if (c === '\u00F7') { out.push({ t: 'op', v: '/' }); i++; continue; }
        if (c === '\u03C0') { out.push({ t: 'num', v: Math.PI }); i++; continue; }
        if (c === '\u221A') { out.push({ t: 'id', v: 'sqrt' }); i++; continue; }
        if (c === '\u00B2') { out.push({ t: 'op', v: '^' }); out.push({ t: 'num', v: 2 }); i++; continue; }
        // 数字（含小数）
        if (isDigit(c) || c === '.') {
            let j = i;
            let dot = 0;
            while (j < n) {
                const d = src.charAt(j);
                if (isDigit(d)) { j++; continue; }
                if (d === '.' && dot === 0) { dot = 1; j++; continue; }
                break;
            }
            const v = parseFloat(src.substring(i, j));
            if (isNaN(v)) { return null; }
            out.push({ t: 'num', v: v });
            i = j;
            continue;
        }
        // 标识符（函数名 / 变量 / 常量）
        if (isLetter(c)) {
            let j = i;
            while (j < n) {
                const d = src.charAt(j);
                if (isLetter(d) || isDigit(d)) { j++; continue; }
                break;
            }
            out.push({ t: 'id', v: src.substring(i, j).toLowerCase() });
            i = j;
            continue;
        }
        if (c === '+' || c === '-' || c === '*' || c === '/' || c === '^') {
            out.push({ t: 'op', v: c });
            i++;
            continue;
        }
        if (c === '(') { out.push({ t: 'lp' }); i++; continue; }
        if (c === ')') { out.push({ t: 'rp' }); i++; continue; }
        if (c === '|') { out.push({ t: 'bar' }); i++; continue; }
        return null;
    }
    return out;
}

/**
 * 将 |...| 归一化为 abs(...)。
 * `|` 既可作左定界也可作右定界，按出现顺序奇偶交替判定：
 * 第 1、3、5... 个为左，第 2、4、6... 个为右。
 * 这样 |x|、|x-1|+|x+2| 都能正确解析；
 * 嵌套绝对值请改用 abs(abs(x)-1) 这种无歧义写法。
 */
function normalizeBars(tokens) {
    const out = [];
    let opened = false;
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.t === 'bar') {
            if (!opened) {
                out.push({ t: 'id', v: 'abs' });
                out.push({ t: 'lp' });
                opened = true;
            } else {
                out.push({ t: 'rp' });
                opened = false;
            }
            continue;
        }
        out.push(t);
    }
    return out;
}

/**
 * 语法分析：token 数组 -> AST。
 * 节点：{t:'num',v} {t:'var'} {t:'neg',a}
 *      {t:'add'|'sub'|'mul'|'div'|'pow',a,b} {t:'call',f,a}
 * 返回 null 表示语法错误。
 */
function build(tokens) {
    let pos = 0;

    function peek() {
        return pos < tokens.length ? tokens[pos] : null;
    }

    function take() {
        const t = tokens[pos];
        pos++;
        return t;
    }

    // 该 token 能否作为一个值的开头（用于识别隐式乘法）
    function startsValue(t) {
        if (!t) { return false; }
        return t.t === 'num' || t.t === 'id' || t.t === 'lp';
    }

    function pExpr() {
        let left = pTerm();
        if (left === null) { return null; }
        for (;;) {
            const t = peek();
            if (!t || t.t !== 'op' || (t.v !== '+' && t.v !== '-')) { break; }
            take();
            const right = pTerm();
            if (right === null) { return null; }
            left = { t: t.v === '+' ? 'add' : 'sub', a: left, b: right };
        }
        return left;
    }

    function pTerm() {
        let left = pUnary();
        if (left === null) { return null; }
        for (;;) {
            const t = peek();
            if (!t) { break; }
            if (t.t === 'op' && (t.v === '*' || t.v === '/')) {
                take();
                const right = pUnary();
                if (right === null) { return null; }
                left = { t: t.v === '*' ? 'mul' : 'div', a: left, b: right };
                continue;
            }
            if (startsValue(t)) {
                // 隐式乘法：2x、3(x+1)、2sin(x)
                const right = pUnary();
                if (right === null) { return null; }
                left = { t: 'mul', a: left, b: right };
                continue;
            }
            break;
        }
        return left;
    }

    function pUnary() {
        const t = peek();
        if (t && t.t === 'op' && (t.v === '-' || t.v === '+')) {
            take();
            const a = pUnary();
            if (a === null) { return null; }
            return t.v === '-' ? { t: 'neg', a: a } : a;
        }
        return pPower();
    }

    function pPower() {
        const base = pAtom();
        if (base === null) { return null; }
        const t = peek();
        if (t && t.t === 'op' && t.v === '^') {
            take();
            const e = pUnary();     // 右结合，并允许 x^-1
            if (e === null) { return null; }
            return { t: 'pow', a: base, b: e };
        }
        return base;
    }

    function pAtom() {
        const t = peek();
        if (!t) { return null; }
        if (t.t === 'num') { take(); return { t: 'num', v: t.v }; }
        if (t.t === 'lp') {
            take();
            const e = pExpr();
            if (e === null) { return null; }
            const c = peek();
            if (!c || c.t !== 'rp') { return null; }
            take();
            return e;
        }
        if (t.t === 'id') {
            take();
            const name = t.v;
            if (name === 'x') { return { t: 'var' }; }
            if (name === 'pi') { return { t: 'num', v: Math.PI }; }
            if (name === 'e') { return { t: 'num', v: Math.E }; }
            if (FN[name] === 1) {
                const nx = peek();
                let arg;
                if (nx && nx.t === 'lp') {
                    take();
                    arg = pExpr();
                    if (arg === null) { return null; }
                    const c = peek();
                    if (!c || c.t !== 'rp') { return null; }
                    take();
                } else {
                    arg = pPower();     // 允许 sin x 这种写法
                    if (arg === null) { return null; }
                }
                return { t: 'call', f: name, a: arg };
            }
            return null;
        }
        return null;
    }

    const root = pExpr();
    if (root === null) { return null; }
    if (pos !== tokens.length) { return null; }
    return root;
}

function callFn(name, v) {
    switch (name) {
        case 'sin': return Math.sin(v);
        case 'cos': return Math.cos(v);
        case 'tan': return Math.tan(v);
        case 'asin': return Math.asin(v);
        case 'acos': return Math.acos(v);
        case 'atan': return Math.atan(v);
        case 'sqrt': return v < 0 ? NaN : Math.sqrt(v);
        case 'abs': return v < 0 ? -v : v;
        case 'ln': return v <= 0 ? NaN : Math.log(v);
        case 'lg': return v <= 0 ? NaN : Math.log(v) / Math.LN10;
        case 'log': return v <= 0 ? NaN : Math.log(v) / Math.LN10;
        case 'log2': return v <= 0 ? NaN : Math.log(v) / Math.LN2;
        case 'exp': return Math.exp(v);
    }
    return NaN;
}

/**
 * 递归求值。定义域之外返回 NaN，绘图层据此断开曲线。
 */
function evalNode(node, x) {
    if (!node) { return NaN; }
    const t = node.t;
    if (t === 'num') { return node.v; }
    if (t === 'var') { return x; }
    if (t === 'neg') { return -evalNode(node.a, x); }
    if (t === 'add') { return evalNode(node.a, x) + evalNode(node.b, x); }
    if (t === 'sub') { return evalNode(node.a, x) - evalNode(node.b, x); }
    if (t === 'mul') { return evalNode(node.a, x) * evalNode(node.b, x); }
    if (t === 'div') { return evalNode(node.a, x) / evalNode(node.b, x); }
    if (t === 'pow') { return Math.pow(evalNode(node.a, x), evalNode(node.b, x)); }
    if (t === 'call') { return callFn(node.f, evalNode(node.a, x)); }
    return NaN;
}

/**
 * 把 AST 编译成闭包树，供绘图时逐点求值。
 *
 * 为什么值得：一条曲线每帧要按像素求值几百次，递归 + switch 分发的开销很可观；
 * 编译成闭包后每次求值只是若干次直接函数调用。
 * 内存上并没有变差 —— 编译完就可以把 AST 丢掉（多项式分析只需在保存时做一次），
 * 闭包数量和原来的 AST 节点数量相当。
 */
function compile(node) {
    if (!node) { return function () { return NaN; }; }
    const t = node.t;
    if (t === 'num') {
        const v = node.v;
        return function () { return v; };
    }
    if (t === 'var') {
        return function (x) { return x; };
    }
    if (t === 'neg') {
        const a = compile(node.a);
        return function (x) { return -a(x); };
    }
    if (t === 'add') {
        const a = compile(node.a), b = compile(node.b);
        return function (x) { return a(x) + b(x); };
    }
    if (t === 'sub') {
        const a = compile(node.a), b = compile(node.b);
        return function (x) { return a(x) - b(x); };
    }
    if (t === 'mul') {
        const a = compile(node.a), b = compile(node.b);
        return function (x) { return a(x) * b(x); };
    }
    if (t === 'div') {
        const a = compile(node.a), b = compile(node.b);
        return function (x) { return a(x) / b(x); };
    }
    if (t === 'pow') {
        const a = compile(node.a), b = compile(node.b);
        return function (x) { return Math.pow(a(x), b(x)); };
    }
    if (t === 'call') {
        const f = node.f;
        const a = compile(node.a);
        return function (x) { return callFn(f, a(x)); };
    }
    return function () { return NaN; };
}

// 去掉全部空白字符
function squeeze(src) {
    let s = '';
    for (let i = 0; i < src.length; i++) {
        const c = src.charAt(i);
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { continue; }
        s += c;
    }
    return s;
}

// 允许用户输入 "y=2x+1" / "f(x)=2x+1" / 直接 "2x+1"
function normalize(src) {
    const s = squeeze(src);
    if (s.length > 1 && (s.charAt(0) === 'y' || s.charAt(0) === 'Y') && s.charAt(1) === '=') {
        return s.substring(2);
    }
    if (s.length > 4 && s.substring(0, 5).toLowerCase() === 'f(x)=') {
        return s.substring(5);
    }
    if (s.length > 0 && s.charAt(0) === '=') {
        return s.substring(1);
    }
    return s;
}

export default {
    /**
     * 解析用户输入，返回 {ok:true, ast, body} 或 {ok:false, msg}
     */
    parse: function (src) {
        if (src === null || src === undefined || src === '') {
            return { ok: false, msg: '请先输入表达式' };
        }
        const body = normalize(String(src));
        if (body === '') {
            return { ok: false, msg: '表达式为空' };
        }
        if (body.length > 60) {
            return { ok: false, msg: '表达式过长' };
        }
        const tk = tokenize(body);
        if (tk === null) {
            return { ok: false, msg: '含无法识别的字符' };
        }
        const ast = build(normalizeBars(tk));
        if (ast === null) {
            return { ok: false, msg: '表达式格式有误' };
        }
        return { ok: true, ast: ast, body: body, fn: compile(ast) };
    },
    calc: evalNode,
    compile: compile
};
