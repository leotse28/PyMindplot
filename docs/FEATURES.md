# RustMindPlot 功能与行为清单（移植验收依据）

本清单整理自原项目 PyMindplot v1.26.0（`mindmap-app`）的 README、`app/main.py` 与
`app/web/`（index.html / app.js / render.js / layout.js / model.js / minimath.js）源码，
作为 Rust 移植与验收的逐项依据。前端 7 个文件与原项目**逐字节一致**，所有界面与交互
行为由前端保证；Rust 壳负责窗口、桥接、文件格式与附件。

验收门禁（全部通过）：

| 门禁 | 结果 |
| --- | --- |
| `cargo build` / `cargo build --release` | 通过 |
| `cargo test`（解析器契约 19 组，覆盖原 test_parser.py 的 109 项断言） | 19/19 通过 |
| `RustMindPlot.exe --selftest`（原 151 项 UI 自检，debug 与 release） | 151/151 `total:true` |
| 启动参数打开 .mm / .xmind → `lastFile` 落盘 | 通过 |
| WM_CLOSE 优雅退出 → 窗口尺寸写回 app.config.json | 通过 |
| 打开原项目 samples/ 全部样例（sample.mm / reading.xml / special.mm / sample.xmind） | 通过 |
| 保存格式与原版逐字节兼容（ET 序列化：单引号声明、` />` 空元素、属性顺序、2 空格缩进） | 通过 |

## 1. 界面与交互

- [x] 顶部工具栏：新建/打开/保存/另存为、子节点/同级/编辑/删除、折叠/展开、撤销/重做、
      缩放（－/100%/＋/适应）、追踪范围与倍数输入框、追踪、一键调整格式、导出PNG、
      DPI 下拉（200/400/600）、快捷键
- [x] 工具栏自适应换行（CSS 变量 `--tb-h` 同步，≤1560px/≤1366px 紧凑规则）
- [x] Chrome 风格多标签页：新建（Ctrl+T/+）、关闭（Ctrl+W/×/中键）、切换（点击/Ctrl+Tab）、
      未保存 ● 标记、关闭确认；每标签页独立持有内容/布局主题/视图/撤销/选中
- [x] 画布：中心发散树状布局、点阵背景、滚轮缩放（围绕光标）、空白拖拽平移、适应画布
- [x] 右侧面板：布局（6 种）、主题（6 套）、背景色/文字色色板、加粗/斜体/下划线、
      字号（14–32）、LaTeX 公式输入、清除样式、附件列表与插入
- [x] 状态栏：文件路径、● 未保存、节点计数、缩放百分比、提示文案
- [x] Toast 提示（2.2s，错误红色）、确认弹窗（modal）、快捷键速查弹窗（F1）
- [x] 右键上下文菜单（10 项，按节点状态禁用：根节点不能删除/剪切/加同级、无子不能折叠、
      无剪贴板不能粘贴、无附件不能另存）
- [x] 附件徽标弹窗（📎 点击弹出，打开/移除/插入）
- [x] 查找/替换面板（Ctrl+F / Ctrl+H）

## 2. 节点操作

- [x] 新建导图（中心主题）、Tab/Insert 添加子节点、Enter 添加同级（根节点时加子节点）
- [x] 双击/F2 编辑文字（输入框沿用节点配色，Ctrl+B/I 编辑中实时生效，Enter 提交/Esc 取消）
- [x] Delete 删除（根节点保护；框选多选时批量删除）
- [x] 拖拽调整层级与顺序（悬停中部=作为子节点，上下边缘=排序；不能移入自身子树）
- [x] 剪切/复制/粘贴（Ctrl+X 半透明标记；剪切粘贴=移动，复制粘贴=副本含子树与附件引用；
      粘贴到自身/子节点被拒绝）
- [x] 折叠/展开：圆形按钮显示折叠子孙数、Space 切换、工具栏全部折叠/展开
- [x] 方向键导航（↑↓ 就近移动；←→ 进入子级/返回父级、折叠展开）
- [x] 右键框选批量删除（空白处右键拖拽虚线选框，Del 批量删除，根节点受保护）
- [x] 节点尺寸调整（右缘/下缘/右下角手柄，宽高持久化，撤销/重做生效）
- [x] 一键调整格式：按层级 26px→13px 字号插值、层级最小尺寸预设（根 340×96 → 逐级递减）、
      按内容自动加宽（层级限宽 400/260/200）与换行、幂等可重复
- [x] 节点字号按层级自动缩放（根 18 → 一级 16 → 二级 15 → 三级 14 → 更深 13；显式设置优先）
- [x] 文字格式：Ctrl+B/Ctrl+I 切换加粗/斜体、侧栏斜体/下划线/字号、清除样式

## 3. 视图与追踪

- [x] 缩放：滚轮围绕光标、Ctrl+=/-/0、按钮（0.15–4 倍钳制）
- [x] 平移：空白拖拽；适应画布（≤1.2 倍钳制）
- [x] 追踪模式（F4/工具栏）：圆形聚焦区（半径=视口短边×范围%，默认 65%，虚线参考圈）、
      区内完整显示、仅选中格放大（默认 1.5 倍，1–3 可调）、圆外渐变虚化（smoothstep）、
      屏外祖先连线保持可见、方向键平滑跟随、范围 20–100 钳制
- [x] 追踪方向切换（悬浮迷你导图）：←/→ 单格直接切换、多格弹出编号迷你导图
      （黄金分割 1.618:1 基准、高度 55% 视口、格子按内容自适应宽度、①②③ 编号、
      数字+Enter 跳转、反方向切换作用侧、Esc/点击外部关闭）
- [x] 选中格 z-index 置顶（追踪放大重叠不遮挡）

## 4. 查找与替换

- [x] Ctrl+F 查找 / Ctrl+H 查找替换；实时高亮全部匹配、当前/总数（如 3/17）
- [x] Enter/Shift+Enter/F3 循环跳转（自动展开折叠分支并居中）
- [x] 区分大小写、全字匹配选项；空输入/无匹配明确提示；关闭清高亮
- [x] 替换当前处、全部替换（确认框显示数量，替换后重新计数）

## 5. 附件与图片

- [x] 插入附件（Ctrl+Shift+I / 侧栏 / 右键 / 📎 弹窗），文件名自动填入格子，插入后自动保存
- [x] 附件内容 base64 内嵌 .mm 文件（任意后缀），单文件可拷贝分享
- [x] 附件另存为（字节一致；目标已存在拒绝；旧版 .assets rel 引用同样支持）
- [x] 打开附件（解压到 %TEMP%\PyMindplot_附件，重名 (i) 去重，系统关联程序打开）
- [x] 移除附件引用（自动保存；删除节点时引用一并移除）
- [x] 粘贴图片（Ctrl+V 剪贴板截图，内嵌 IMGDATA，立即显示，随文件保存）
- [x] 粘贴文件（复制的文件 Ctrl+V 作为附件内嵌，完整文件名填入格子，100MB 上限）
- [x] 旧版兼容：.assets 文件夹的附件与图片经内部桥接读取显示

## 6. LaTeX 与渲染

- [x] 内置离线迷你渲染引擎（minimath.js）：分式、根号（含 n 次方根）、上下标、希腊字母、
      求和/积分/极限等常用符号；随文件保存（LATEX 属性）
- [x] 节点内嵌图片显示（data URL / 旧版 .assets 经桥接）
- [x] 6 套主题（默认蓝/极简白/暗黑/暖橙/森绿/紫青），手动颜色优先于主题
- [x] 6 种布局（思维导图平衡/逻辑图向右/组织结构图向下/树状图/时间轴/鱼骨图），
      分支配色贝塞尔曲线、时间轴轴线、鱼骨主刺骨刺

## 7. 导出

- [x] 导出高 DPI PNG（200/400/600 DPI，整张导图含折叠分支自动展开，16000px 边长上限，
      保存为同名 .png；圆角格子/分支配色曲线/加粗斜体字号/内嵌图片全部还原）

## 8. 文件格式（读写兼容）

- [x] FreeMind `.mm` / `.xml`：完整层级与文字；COLOR/BACKGROUND_COLOR/FOLDED/
      `<font BOLD/ITALIC/SIZE>`（SIZE≤12 忽略）/UNDERLINE/`<richcontent>`（取纯文本）
- [x] 自定义属性：`<map layout theme>`、节点 WIDTH/HEIGHT/LATEX/IMAGE/IMGDATA/
      ATTACHMENTS（base64 JSON，坏值容错归零）
- [x] XMind `.xmind` 只读导入：新版 content.json 与旧版 XMind 8 content.xml；
      备注/标签/优先级标记以 `[备注]`/`[标签]`/➊➋⭐ 保留在文本；多工作表取第一个；
      保存时自动转存同名 .mm（不写回 .xmind、不弹对话框）
- [x] 序列化与 Python ElementTree 逐字节兼容：`<?xml version='1.0' encoding='UTF-8'?>`、
      空元素 ` />`、属性顺序（TEXT→…→ATTACHMENTS；font：BOLD,SIZE,ITALIC,NAME）、
      2 空格缩进、UTF-8 无 BOM、tmp+rename 原子写
- [x] 保存保护：.xmind 拒绝写回；路径穿越防护（附件名/图片名取 file_name）

## 9. 快捷键（F1 速查表）

Tab/Insert 子节点 · Enter 同级 · Delete 删除 · F2/双击 编辑 · Space 折叠展开 ·
右键菜单 · Ctrl+Shift+I 附件 · Ctrl+B/I 加粗斜体 · Ctrl+C/X/V 复制剪切粘贴 ·
Ctrl+F/H 查找替换 · Enter/Shift+Enter/F3 匹配循环 · F4 追踪 · 右键拖拽框选 ·
Ctrl+T/W/Tab 标签页 · ↑↓←→ 导航 · Ctrl+Z/Y 撤销重做（200 步） ·
Ctrl+S/O/N 保存打开新建 · Ctrl+=/-/0 缩放 · 滚轮/拖拽 缩放平移 —— 全部与原版一致

## 10. 应用壳行为（Rust 实现，对齐原 main.py）

- [x] 窗口：标题 PyMindplot、初始尺寸记忆（app.config.json width/height）、最小 760×540、
      背景色 #f4f6fb、私隐模式（WebView2 InPrivate，对齐 pywebview private_mode）
- [x] 配置：app.config.json（exe 旁；utf-8-sig 读、原子写、未知键保留、lastFile 记忆）
- [x] 未保存退出拦截：原生 OK/Cancel 警告框（文案与原版一致）
- [x] 启动参数：直接打开指定 .mm/.xml/.xmind（consume-once 契约）；把文件拖到 exe
      图标上即以启动参数方式传入——扩展名校验后打开，非法类型弹提示且不污染 lastFile；
      多个文件时第一个进当前标签页、其余依次后台标签页打开
- [x] 窗口拖放打开：文件拖入窗口悬停时显示可放置提示（虚线框遮罩，Rust 端
      DragDropEvent 经 __MM_DROP_HINT__ 驱动——Windows 下 wry 接管原生拖放、
      HTML5 拖放事件不可用）；松开后经 __MM_DROP_OPEN__ 转发路径，校验扩展名
      （.mm/.xml/.xmind）后打开：第一个有效文件进当前标签页（脏标签先弹确认，
      取消则中止整批），其余依次在后台标签页打开并切回第一个标签页；不支持的
      类型与读取失败均 toast 提示，不崩溃、不打开空白内容
- [x] `--selftest`：加载 #selftest=1 → 轮询 window.__SELFTEST__（150ms×100 次）→
      写 selftest-result.json → 自动退出；超时写 `{"error":"selftest timeout","total":false}`
- [x] 桥接 API（19 个，方法名与返回结构对齐原 Api 类；take_startup_files 为移植
      扩展——返回启动文件路径数组并清空队列）：set_dirty / get_config /
      set_config / get_version / take_startup_files / pick_open_file / get_save_path /
      get_save_path_any / save_attachment_as / add_attachment_data / load_map / save_map /
      add_attachment / open_attachment / add_image / read_image_data / save_png /
      pick_attachment_file / report_selftest
- [x] 前端兼容：Rust 注入 `window.pywebview.api` 垫片（Promise 语义、允许 JS 覆写
      单个方法）；web/ 与原项目一致，仅 app.js 末尾追加拖放打开块
      （DROP_EXTS / openDroppedFiles / __MM_DROP_HINT__ / __MM_DROP_OPEN__，
      pollStartup 改用 take_startup_files），其余六个文件逐字节一致

## 11. 已知说明（与原版一致）

- 仅支持 FreeMind XML 结构（.mmz 压缩包、Freeplane 加密文件不支持）
- .xmind 为只读导入；折叠状态、主题样式、关联线不映射
- LaTeX 复杂环境（如 \begin{matrix}）按原文显示；导出 PNG 中公式按原文绘制
- 富文本打开取纯文本；撤销历史切换文件后清空；布局/主题切换不进撤销栈
- 移除附件引用不删除 .assets 旧文件（支持撤销恢复）
