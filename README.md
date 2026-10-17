# 函数绘图（轻鸿蒙 / Lite Wearable）

运行在华为轻智能手表上的高中数学函数绘图应用。

| 项 | 值 |
|---|---|
| 包名 | `com.example.hanshu` |
| 设备形态 | `liteWearable`（FA 模式，HML + JS） |
| 编译 SDK | HarmonyOS 6.1.1(24)，`compatibleSdkVersion: "6.1.1(24)"` |
| 目标设备 | HUAWEI WATCH GT 6（46mm/41mm 均为 1.47"/1.32" AMOLED，**466×466** 圆屏） |
| 设计基准 | 466×466，画布与内容均收在圆屏内接安全区内 |

## 功能

1. **自由表达式输入**：**整块键盘画在 canvas 上**（两页键位），单页 27 键：
   - 主键盘：`0-9 . + - × ÷ ^ ( ) | x √ π 退 清 函数`
   - 函数页：`sin cos tan ln lg log2 asin acos atan sqrt abs exp 返回`
   表达式实时回显 `y=...`，解析失败时整串变红且不允许保存。
   为什么不用 `input` 组件排键盘：轻手表同屏几十个 `input` 实例会渲染失败（见下节）。
2. **多函数同屏绘图**：最多 5 条曲线同时绘制，每条一种颜色。
   底部的 **`<` / `>` 在「全部 ⟷ 单条」之间环形切换**（`common/focus.js`）：
   - 焦点 0 = 全部同屏；焦点 1..n = **只画第 (焦点-1) 条**；
   - 右 `>` 走 全部 → 第1条 → … → 第n条 → 全部；左 `<` 反向；
   - 切到单条时画面只剩那一条、特殊点标注也随之切换，按键的反馈非常直接；
   - 顶部标题同步显示当前状态：单条是 `y=…  2/3`，全部是 `全部 3 条`；
   - **全部模式同样会显示各函数的顶点坐标**：canvas 上每条二次函数用自己的曲线颜色标出顶点，
     底部再按 `序号:(x,y)` 逐个列出（非二次函数留 `-` 占位），多条同屏也能逐个核对。
   保存新函数后会自动聚焦到刚保存的那条。
3. **二次函数特殊点**：仅对能整理为 `y = ax² + bx + c`（a≠0）的表达式，自动标注
   - 顶点，并按开口方向标明是**最小值**还是**最大值**；
   - 与 x 轴的交点（判别式 >0 两个、=0 一个切点、<0 显示"无实根"）；
   - 与 y 轴的交点。

   标注策略按模式区分，避免多条叠在一起糊成一片：

   | 模式 | canvas 标注 | 底部摘要 |
   |---|---|---|
   | 单条 | 顶点 + x 交点 + y 截距，统一配色，带避让 | 完整特殊点（最值 / 交点 / 截距） |
   | 全部（**≤ 2 条**） | 顶点 + x 交点 + y 截距；顶点用**各自曲线颜色**，交点/截距用统一配色 | `1:(1.5,-0.25) 2:(0,4)` |
   | 全部（**≥ 3 条**） | **只标顶点**（曲线自身颜色）—— 多条曲线的交点必然糊成一片 | `1:(1.5,-0.25) 2:(0,4) 3:-` |

   不管哪种模式，`putLabel` 的避让表都会兜底：标签放不下就只留点、不写字，
   所以「位置分散」的判据不需要额外计算，挤了自然就不标。

   所有条的特殊点都是**惰性计算一次**（`quadDone` 标记），不会因为每帧重绘而反复做多项式提取。
4. **视野缩放**：绘图区**左上角 `-` / 右上角 `+`** 两个键，在 **±0.5 … ±48 共 13 档**（`ZOOMS`）间切换视野，
   单次步进保持 1.33~1.5 倍；两端各扩若干档 —— 放大到 ±0.5 可看顶点/交点附近的曲率，缩小到 ±48 可看整体走势，
   右下角实时显示当前半宽（如 `±8`）；到档位尽头时对应按钮变暗。
   缩放改的是 `plot.makeView` 的 `half`，网格步长由 `niceStep` 随视野自动重算，
   曲线采样始终是每像素一个点，放大后不会变粗糙。
5. **滑动平移**：在绘图区**按住拖动**即可平移视图（`on:touchmove`）。
   - 判定依据是**相对按下点的位移**超过 `DRAG_MIN`(8px)，低于阈值仍按点击处理；
     不用"累加路径长度"，因为手指在按钮上抖动几下再回原处会累加超标，把点击误判成拖动、按钮静默失效；
   - 拖动中重绘按 `PAN_REPAINT_MS`(90ms) 节流，松手时补画一次停在准确位置；
   - 滑动过的那一次触摸**不再派发点击**（`suppressClick`），避免滑完手一抬误触按钮；
   - 平移量限制在 ±`PAN_LIMIT`(160) 世界单位，**点绘图区空白处即归位**到原点；
   - 平移后右下角的 `±8` 会变蓝并显示「已移」，提示视图已偏离原点。
   缩放与平移可叠加：缩放以当前视图中心为锚点，不会跳回原点。

## 支持的表达式语法

| 类别 | 写法 |
|---|---|
| 前缀 | `y=2x+1`、`f(x)=2x+1`，或直接写 `2x+1` |
| 运算符 | `+ - * / ^`，`^` 右结合 |
| 隐式乘法 | `2x`、`3(x+1)`、`2sin(x)`、`(x-1)(x+2)` |
| 绝对值 | `|x-1|`（`|` 按出现顺序奇偶配对；嵌套请写 `abs(abs(x)-1)`） |
| 常量 | `pi`、`π`、`e` |
| 函数 | `sin cos tan asin acos atan sqrt abs ln lg log log2 exp` |
| 全角容错 | `（）＋－×÷π√`、`x²` 等会被自动归一化 |

解析器为手写词法 + 递归下降语法分析（`common/expr.js`），**不使用 `eval` / `new Function`**，符合轻手表禁止动态执行的要求。

## 目录结构

```
entry/src/main/
├── config.json                       # liteWearable 模块配置，注册 index / edit 两个页面
├── resources/base/element/string.json
└── js/MainAbility/
    ├── app.js
    ├── common/
    │   ├── expr.js    # 表达式词法/语法分析 + 求值
    │   ├── poly.js    # 多项式系数提取、二次函数顶点与交点
    │   ├── plot.js    # canvas 绘图：网格、坐标轴、刻度、曲线、特殊点、视图窗口
    │   ├── focus.js   # 左右键「全部 / 单条」焦点循环（纯函数，可单独断言）
    │   ├── num.js     # 数值格式化（抑制浮点误差）
    │   ├── store.js   # 函数列表单例 + @system.storage 持久化
    │   └── keypad.js  # 键盘键位表 + canvas 绘制 + 触摸命中测试
    └── pages/
        ├── index/     # 主页：绘图 + 曲线切换
        └── edit/      # 编辑页：canvas 键盘（组件数仅 3）
```

## ⚠ 轻手表的 `input` 组件不是输入框（改代码前必读）

官方 ArkUI.Lite 文档里，`input` 是"交互式组件，包括单选框，多选框，按钮"，**`type` 只支持
`button` / `checkbox` / `radio`，没有 `text`** —— 它**不会唤起任何键盘**。
写上 `type="text"` 既不是文本框，也不会弹出输入法；轻手表上要做文本输入只能**自绘键盘**。

顺带记两个 Lite CSS 的坑：`max-lines` 与 `line-height` 会被构建器判为
"not a standard attribute name"，已从样式中移除，改用 JS 端按字符数截断。

## ⚠ ACELite 页面保留方法名与事件模型（血泪教训）

### 1. `render` 是保留方法名，绝对不能自定义

页面里写 `render() { ... }` 会覆盖框架自身的渲染方法，导致 `this.render` 变成非函数，
框架渲染流程一并失效 —— 表现为**整页不渲染，连 HML 里的 `<text>` 都不显示**，
日志只有 `TypeError: Expected a function` 和 `JsEngine Crash 0xc0000005`。本工程改用 `repaint()`。

> 排查时先后误判为「组件太多」「路由失败」「JS 堆不够」，全错。真正定位靠 DevEco 调试器断在
> `this.render()` 时看到的 `exception = TypeError: Expected a function`。

### 2. 预览器：拖动 = touch，直接点击 = click

鼠标**拖动**被映射成 `touchstart/touchmove/touchend`，**直接点击**只派发 `click`。
canvas 自绘界面必须两条路径都处理：

```html
<stack on:touchstart="onTS" on:touchend="onTE" on:click="onClick">
```

`click` 在 Lite 里没有类型声明，坐标字段依次尝试 `globalX / clientX / x / pageX`。

### 3. 事件只能绑一处，否则一次点击触发两次

父节点与子节点同时绑定、或 `touchend` 与 `click` 都触发时，一次点击执行两遍，
表现为**按一个键输入两个字符**。做法：只绑根 `stack` 一处，两条路径汇到同一命中入口，
再用「键名 + 150ms 时间窗」防抖去重。命中判定用**按下点**，抬起点容易被拖动带偏。

### 4. 页面用 onShow 驱动，别在 onInit 里发异步回调

在 `onInit` 里发起 `Device.getInfo` / `store.load` 时 `$refs` 尚未就绪、
回调时机也不稳定。改为 `onShow` 里**先渲染、再异步补数据**。

### 5. `this.$refs` 在 onInit 阶段整个是 undefined

必须 `if (!this.$refs) { return; }` 先判 `$refs` 本身；
写 `if (!this.$refs.cv) ...` 会在 `$refs` 为 undefined 时抛 TypeError。

## ⚠ JS 堆只有 64KB（真正的崩溃原因）

`previewer.log` 里能直接看到 OOM 现场：

```
[JERRYSCRIPT] Error: ERR_OUT_OF_MEMORY
	heap total size: 65528              # 实际只给 64KB
	currently allocated bytes: 64880   # 已经撑满
	allocated memory for byte code: 21296
	allocated memory for objects: 10288
	allocated memory for properties: 16736
	allocated memory for strings: 11458
[JS Exception]: JS HEAP OOM
[Previewer server] liteWearable engine crash   # 引擎直接崩溃
```

注意日志里 `CommandParser js heap: 524288` 显示预览器**配置的是 512KB，但引擎实际只拿到 64KB**。
引擎一旦 OOM 崩溃，表现就是「页面只渲染一部分」「点击完全没反应」「提示重启预览器」——
这些全是下游现象，不要当成布局或事件绑定的问题去查。

### 据此做的内存优化

| 措施 | 收益 |
|---|---|
| 键位从「对象数组」改成扁平数组 `[x,y,w,h,label,...]` | 省掉 135 个对象属性 |
| 页面状态从 `data` 移到模块级变量（`data` 变化会触发序列化） | 省掉每次按键的序列化峰值 |
| 键位只在 rebuild 时算一次，绘制/命中复用 | 避免重复分配 |
| `store.js` 去掉 `poly` 依赖，二次函数分析改为主页惰性计算 | 编辑页产物 31.5KB → **26.2KB** |
| 键盘配色从 8 个常量 + 3 个分类数组降到 4 个常量 | 省字符串与数组 |

**未在真机确认前不要假设堆够用。** GT6 的堆档位官方没公开数据，社区普遍说是 512KB，但预览器实测只有 64KB。

## ⚠ 页面的 `this` 是受限 ViewModel（最容易踩的坑）

Lite 页面对象的 `this` **只能给 `data` 里声明过的字段赋值**。自行往 `this` 上挂属性会
**静默失败**（不报运行时错误，读回来是 `undefined`），IDE 里对应这条告警：

```
Property 'keys' does not exist on type 'ViewModel & { idx: number; cw: number; ... }'  <ArkTSCheck>
```

本工程实际踩过两次：

- 编辑页把 `keys` / `text` / `tsX` 等写成实例字段 → `this.keys` 恒为 `undefined` → 按键命中时抛异常 → **点键盘无反应**；
- 主页 `this.winW` / `this.winH` 未声明 → `undefined - 196` = `NaN` → 画布边长变成 NaN。

**规则：`data` 里没有的字段，一律不能写。** `tools/selftest/run.cjs` 第 5 项会静态扫描页面所有 `this.xxx` 引用，未声明即报错。

另外 `$refs` 的 d.ts（`ElementReferences`）没声明 `getContext`，会报 `Property 'getContext' does not exist`；canvas 元素运行时是有这个方法的，用 JSDoc `/** @type {any} */` 放宽即可。

### 同屏组件数要克制

编辑页最初用 `input button` 排了 56 个键 + 12 个容器 div，真机上**只有顶部那行 text 显示出来**，
整块键盘静默消失（构建却能通过）。现在的做法是：

- 键盘由 `common/keypad.js` 在 canvas 上绘制，整页只有 `stack` / `canvas` / 一个透明 `div` 三个组件；
- 触摸事件来自覆盖层 div，坐标取事件对象的 `globalX` / `globalY`（按下时记录、抬起时命中判定）；
- 改键位只需改 `keypad.js` 里的 `MAIN_KEYS` / `FN_KEYS` 两行数组，几何校验会自动跟着跑。

## ⚠ 轻手表的 syscap 陷阱（改代码前必读）

`liteWearable` 的默认系统能力集（SDK: `js/api/device-define/liteWearable.json`）**只含
`SystemCapability.ArkUI.ArkUI.Lite`，不含 `ArkUI.Full`**。而 `@system.router` 是**逐方法**标注的：

| 方法 | syscap | liteWearable |
|---|---|---|
| `replace` | `ArkUI.Lite` | ✅ 可用 |
| `back` / `push` / `getParams` / `clear` / `getLength` / `getState` | `ArkUI.Full` | ❌ 会被 ArkTSCheck 报错 |

所以本工程**返回页面统一用 `Router.replace({ uri: '/pages/index/index' })`**，不使用 `Router.back()`。
副作用是页面栈深度恒为 1（在轻手表上反而更省内存）；index 页会重新走一次 `onInit`，但函数列表由
`common/store.js` 单例保持并已写入 storage，不会丢状态。

本工程用到的三个平台接口都已核对在能力集内：

| 接口 | syscap |
|---|---|
| `@system.router.replace` | `ArkUI.Lite` ✅ |
| `@system.device.getInfo` | `Startup.SystemInfo.Lite` ✅ |
| `@system.storage.get/set` | `DistributedDataManager.Preferences.Core.Lite` ✅ |

`tools/selftest/run.cjs` 的第 3 项检查会扫描所有 `@system.*` 调用并对照白名单，新增越界调用会直接报错。

## 布局与圆屏安全区

按 GT6/模拟器的 **466×466 圆屏**（半径 233px）排布。判定标准是**元素四角到圆心的距离 ≤ 233**：

| 元素 | 位置 | 最远角距圆心 / 余量 |
|---|---|---|
| 标题（20px，13 字符 + 序号） | 基线 y=42 | 225.7 / 7.3px |
| 绘图区 | y 66 起，边长 **304** | 225.8 / 7.2px |
| 缩放键 42×34（左 / 右） | 绘图区上角内缩 8px | 214.5 / **18.5px** |
| 特殊点摘要（16px，20 字符） | y 378..391 | 177.1 / 55.9px |
| 按钮行 3×66（gap 10） | y 392..434 | 228.7 / 4.3px |

绘图区从 288 放大到 304 是靠压缩摘要行（+21→+18）与按钮行（+30→+22）换来的，
扣掉的高度给了绘图区；按钮随之从 72 收窄到 66，才守住圆屏四角的安全余量。
| 键盘 27 键（主键盘 / 函数页） | y 110..430 | 226.0 / 7.0px |

缩放键之所以能"免费"放在绘图区上角：圆屏四角本来就是裁切区，这两块位置到圆心仅 209px，
既不影响底部三个主按钮，也不需要额外一行高度。

主页的几何参数全部在 `pages/index/index.js` 的 `side()` / `oy` / `bw,bh,gap` / `by`；
自测第 4 项**直接从源码用正则提取这些数值**再算圆心距，所以改完布局重跑
`node tools/selftest/run.cjs` 就会立刻发现越界。

> **圆屏上"看得见"不等于"点得到"。** 越出圆外的部分会被裁掉，但热区仍在原坐标，
> 于是表现为「按钮画出来了，却点不动」。最早按钮行做成 3×76 + gap12，在 y=438 处
> 最远角 240.6（越界 7.6px），左右两个按钮的两端正好落在圆外。
> 同理，标题基线原来在 y=30，20px 字形的上部达到 y=14，那一段圆宽只有约 159px，
> 放不下 200px 的文字——现在基线挪到 y=44 才够。

## 自测

```powershell
node tools/selftest/run.cjs
```

一条命令跑五组检查：

1. 解析器 / 二次函数特殊点 / 绘图逻辑断言（用 mock canvas context 验证不产生 NaN 坐标）；
2. HML 组件白名单（标签 / 事件 / 属性，对照 API 24 SDK 的 `lite_component_map.js`）＋ 禁止 `{{...}}` 里出现取反等复合表达式；
3. `@system.*` 调用的 syscap 归属（对照 liteWearable 能力集，越界即报错）；
4. 圆屏安全区几何（直接跑 `keypad.js` 的真实键位布局）；
5. 页面 `this.xxx` 引用是否都在 `data` 或方法中声明。

该目录只在电脑端使用，不参与手表端打包。

## 交互

- 主页顶部显示当前表达式（点击进入编辑页），下方显示 `序号 / 总数`。
- 主页底部：`<` 上一条、`+` 新增、`>` 下一条；点击画布也可逐条切换。
- 编辑页：**点键盘输入**，顶部实时回显 `y=...`；解析失败时整串变红并不允许保存。
- 主键盘第 4 行最右的「函数」键切到函数键盘，函数页左下「返回」切回。
- 编辑已有曲线时，编辑页末行把「取消」换成「删除」。
- 函数列表写入 `@system.storage`，重启后保留。

## 构建

需要 DevEco Studio 26.0 自带工具链（**注意不要用旧版 DevEco 3.1**）：

```powershell
$env:DEVECO_SDK_HOME = 'D:\DevEco Studio\sdk'
$env:JAVA_HOME = 'D:\DevEco Studio\tools\openjdk'
node 'D:\DevEco Studio\tools\hvigor\bin\hvigorw.js' --mode module -p product=default assembleHap --no-daemon
```

产物：`entry/build/default/outputs/default/entry-default-unsigned.hap`

未配置 `signingConfigs` 时产出的是 **unsigned** HAP，装真机前需要在 DevEco 中配置签名。

## 绘图实现要点

Lite Wearable 的 `CanvasRenderingContext2D` 只支持 `fillRect / fillStyle / strokeRect / fillText /
lineWidth / strokeStyle / stroke / beginPath / moveTo / lineTo / closePath / font / textAlign / arc / rect`，
没有 `clearRect`、`measureText`、`fill()`。因此：

- 清屏用整块 `fillRect` 覆盖；
- 文字宽度按字号估算（`length * fontSize * 0.56`）；
- 点标记用 `fillRect` 画实心小方块；
- 曲线按每像素列采样一次（≤360 点）逐点 `lineTo`，遇到 `NaN`/`Infinity`（定义域外）或相邻点竖直跳变超过一个屏高时断开路径，避免 `1/x`、`tan x` 出现横贯画布的假竖线。

### 两个容易把"图像画错"的坑

1. **曲线坐标必须带 `OX`/`OY` 偏移。** 绘图区可以落在页面任意矩形里，偏移量存在模块级
   `OX`/`OY`。`sxOf`/`syOf` 已经加过偏移，但 `drawCurve` 早期手工算
   `px = (x - v.xmin) * kx` 漏了 `OX`，结果**曲线整体左移一个绘图区宽度**，
   与网格、坐标轴、刻度全部错位——看上去就像"函数图像画错了"，
   实际函数本身是对的。新增任何直接算坐标的代码，都要走 `sxOf`/`syOf`。
2. **曲线要显式裁到绘图区上下界**（`OY-1` ~ `OY+H+1`）。Lite canvas 没有 `clip()`，
   若按"上下各放一屏高"放行，曲线会直接压到顶部表达式文字和底部按钮上。

### 特殊点标注的避让规则

顶点、x 交点、y 截距可能落在同一点（例如 `y=-x^2` 三者都在原点）。早期三条标注各自找位置，
叠成了 `最(0(0)0)`。现在：

- 点按优先级绘制（截距 → 交点 → 顶点），重合时顶点压在最上层；
- 文字先比**点位间距**（<6px 视为重合，直接不重复写），再比**包围盒**；
- 每个标签按 `below / above / right / left` 依次尝试，全部冲突才放弃（此时只留点不写字）；
- 文字宽度按字符类别估算：中文/全角算一个字号宽，半角算 0.56 字号。

## 验证状态

| 项目 | 状态 |
|---|---|
| 解析器 / 二次函数特殊点（含全部模式按条数决定标注范围）/ 左右键焦点循环 / 视图缩放平移 / 绘图逻辑（**79 项断言**，Node 环境） | ✅ 通过 |
| 禁用语法扫描（源文件 + 转译产物，0 命中） | ✅ 通过 |
| HML 组件白名单（标签/事件/属性） | ✅ 通过 |
| `@system.*` syscap 归属（对照 liteWearable 能力集） | ✅ 通过 |
| 圆屏安全区几何校验（主页参数从 `index.js` 源码提取 + 缩放键 + 2 页 × 27 键真实键位） | ✅ 通过 |
| 页面 `this.xxx` 声明检查（防受限 ViewModel 静默失败） | ✅ 通过 |
| 静态审计（Lite config、接口 @since、资源命名） | ✅ 通过 |
| hvigor 构建（Lite JS 编译 + 打包，**零 CSS 警告**） | ✅ BUILD SUCCESSFUL |
| **预览器功能验收**（多函数同屏绘图、正弦/直线曲线渲染、坐标系网格刻度、27 键键盘输入、确定保存、函数页切换） | ✅ 通过（v0.3-preview-ok） |
| 视野缩放（13 档 ±0.5~±48、到档变暗、右下角半宽显示） | ⬜ v1.3.0 起，待预览器/真机复验 |
| 绘图区放大后（304）的曲线观感与按钮可点性 | ⬜ **本次改版，待预览器/真机复验** |
| 滑动平移（拖动跟随、松手定位、拖动不误触按钮、点空白归位） | ⬜ **本次新增，待预览器/真机复验** |
| 修复：曲线 OX 偏移 / 曲线越界 / 标注重叠 / 按钮与标题越出圆屏 | ⬜ **待预览器或真机复验** |
| Lite Wearable 模拟器冒烟 | ⬜ 未执行 |
| GT 6 真机（canvas 渲染与稳定性、storage 持久化、尺寸基准 466×466） | ⬜ 未执行 |

> 审计脚本报出的 `optional chaining (expr.js:80)` 经逐行核对为**误报**：该脚本用非 UTF-8 方式读取含中文注释的源文件，导致行号错位；用 UTF-8 扫描源文件与转译产物均为 0 命中。

**未在真机验证前，不应宣称已兼容 GT 6。** 预览器验收的是**功能正确性**，不等于真机兼容性。
重点待验证项：

1. canvas 在 Lite Wearable 真机上的渲染稳定性（社区有 GT3 表盘使用 canvas 崩溃的个案）；
2. `@system.storage` 在真机上的读写（预览器里不可用，代码已降级为纯内存）；
3. 尺寸基准：预览器是 454×454，GT6 是 466×466，布局按 `Device.getInfo` 自适应但需真机确认；
4. 真机 tap 与预览器 click 的事件差异（已同时处理两条路径，但需真机复核）。

## 版本记录

| 版本 | 内容 |
|---|---|
| **1.6.0** | 全部模式的标注范围按曲线条数决定：**≤ 2 条**时顶点/交点/截距全标，**≥ 3 条**时只标顶点；位置是否分散交给 `putLabel` 避让表兜底 |
| 1.5.0 | 全部模式也显示各函数的顶点坐标：canvas 上每条用曲线自身颜色标顶点（跨曲线共享避让表），底部按 `序号:(x,y)` 汇总，非二次留占位；特殊点分析加 `quadDone` 标记只算一次 |
| 1.4.0 | 左右键改为「全部 ⟷ 单条」环形切换：焦点 0 = 全部同屏，1..n = 只画那一条；顶部标题同步显示模式，保存后自动聚焦新函数。焦点循环抽成 `common/focus.js` 纯函数以便断言（9 项边界用例） |
| 1.3.0 | 绘图区 288→304（压缩摘要行与按钮行的间距换高度），按钮 72→66 以守住圆屏余量；缩放范围两端扩容到 ±0.5 … ±48 共 13 档，**单次步进不变**；自测的 side 上限改为从源码提取并断言已达上限 |
| 1.2.0 | 新增滑动平移：`on:touchmove` 拖动改视图中心，累计位移超阈值才判为拖动、拖动后抑制点击、拖动中重绘节流、点空白处归位；`plot.makeView/draw` 新增中心偏移参数，缩放与平移可叠加 |
| 1.1.1 | 修复缩放键 `+`/`-` 文字基线偏移：缩放键曾用 `+9`、底部按钮用 `-24*0.35`，两者方向相反，符号整体下坠约 17px 掉到按钮边缘；现抽出 `FONT_MID` 常量两处共用 |
| 1.1.0 | 新增视野缩放（±2 … ±24 共 8 档）；`plot.makeView/draw` 支持可配置视图半宽；缩放键几何纳入自测 |
| 1.0.0 | 表达式解析、二次函数特殊点、多函数同屏绘图、canvas 自绘键盘 |
