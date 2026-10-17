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
2. **多函数同屏绘图**：最多 5 条曲线同时绘制，每条一种颜色，用 `<` / `>` 或点击画布逐条切换。
3. **二次函数特殊点**：仅对能整理为 `y = ax² + bx + c`（a≠0）的表达式，自动标注
   - 顶点，并按开口方向标明是**最小值**还是**最大值**；
   - 与 x 轴的交点（判别式 >0 两个、=0 一个切点、<0 显示"无实根"）；
   - 与 y 轴的交点。
   其余函数按需求不做特殊点处理。

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
    │   ├── plot.js    # canvas 绘图：网格、坐标轴、刻度、曲线、特殊点
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

按 GT6/模拟器的 **466×466 圆屏**（半径 233px）排布，所有元素的**四角**都必须落在圆内：

| 页面 | 元素 | 位置 | 距圆心 / 余量 |
|---|---|---|---|
| 主页 | 表达式文字 | y 22..46 | 226.0 / 7.0px |
| 主页 | 画布 270×270 | y 74..344 | 208.6 / 24.4px |
| 主页 | 特殊点信息 | y 352..369 | 186.4 / 46.6px |
| 主页 | 按钮行 3×64 | y 382..426 | 224.2 / 8.8px |
| 编辑页 | canvas 键盘 27 键 | y 117..411 | 226.0 / 7.0px |

主页纵向占用 432/466px，编辑页键盘 110..430px。键盘四行宽度分档（58/64/64/70/66px）正是为了跟随圆屏上下收窄；
几何校验直接跑 `keypad.js` 的真实布局，**改键位后重跑 `node tools/selftest/run.cjs` 即可**。

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

## 验证状态

| 项目 | 状态 |
|---|---|
| 解析器 / 二次函数特殊点 / 绘图逻辑（47 项断言，Node 环境） | ✅ 通过 |
| 禁用语法扫描（源文件 + 转译产物，0 命中） | ✅ 通过 |
| HML 组件白名单（标签/事件/属性） | ✅ 通过 |
| `@system.*` syscap 归属（对照 liteWearable 能力集） | ✅ 通过 |
| 圆屏安全区几何校验（含 2 页 × 27 键的真实键位布局） | ✅ 通过 |
| 页面 `this.xxx` 声明检查（防受限 ViewModel 静默失败） | ✅ 通过 |
| 静态审计（Lite config、接口 @since、资源命名） | ✅ 通过 |
| hvigor 构建（Lite JS 编译 + 打包，**零 CSS 警告**） | ✅ BUILD SUCCESSFUL |
| Lite Wearable 模拟器冒烟 | ⬜ 未执行 |
| GT 6 真机（canvas 渲染、键盘点按、storage 持久化、尺寸基准） | ⬜ 未执行 |

> 审计脚本报出的 `optional chaining (expr.js:80)` 经逐行核对为**误报**：该脚本用非 UTF-8 方式读取含中文注释的源文件，导致行号错位；用 UTF-8 扫描源文件与转译产物均为 0 命中。

**未在真机验证前，不应宣称已兼容 GT 6。** 重点待验证项：canvas 在 Lite Wearable 真机上的渲染与稳定性（社区有 GT3 表盘使用 canvas 崩溃的个案）、`@system.storage` 读写、以及键盘同屏 20+ 个 `input button` 的点击响应。
