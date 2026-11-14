# RustMindPlot 便携思维导图

PyMindplot（`mindmap-app`）的 Rust 移植版：功能与原项目完全对齐，保存文件格式
（FreeMind `.mm`/`.xml`、XMind `.xmind` 导入）读写兼容。原生窗口（tao）承载本地
HTML/CSS/JS 界面（WebView2，经 wry），前端 7 个文件与原项目逐字节一致；原 Python 壳
的职责（窗口、桥接、解析/序列化、附件、对话框、自检）全部由 Rust 实现。

![截图](../mindmap-app/tests/shot-tabs.png)

## 与原版的差异（仅实现层）

- 免安装单文件 EXE 约 2.0 MB（原 11.9 MB）；宿主进程内存约 4 MB（原约 135 MB+，
  WebView2 运行时进程两者共享）
- 前端经自定义协议 `app://localhost/`（虚拟主机）提供：WebView2 会静默丢弃 file://
  页面的 `chrome.webview.postMessage`，故与 Tauri 同款改走 http 虚拟主机；资产编译期
  内嵌、不落盘
- Rust 注入 `window.pywebview.api` 垫片，前端代码零改动（允许 JS 覆写单个 API 方法，
  自检流程依赖该行为）

## 功能

完整功能与行为清单见 [docs/FEATURES.md](docs/FEATURES.md)（移植与验收依据）。要点：

- 多标签页（Chrome 风格）、6 种布局、6 套主题、撤销/重做（200 步）
- 节点增删改、拖拽调层级、折叠展开、框选批量删除、尺寸调整、一键调整格式
- 追踪模式（圆形聚焦区 + 方向迷你导图编号跳转）、查找替换、LaTeX 公式、内嵌图片
- 附件内嵌 .mm 文件（任意后缀）、附件另存为、粘贴图片/文件、旧版 .assets 兼容
- 导出高 DPI PNG（200/400/600 DPI）
- 拖放打开：把 .mm/.xml/.xmind 拖到 exe 图标上或拖进程序窗口即可打开（悬停显示
  可放置提示；多文件时第一个进当前标签页、其余后台标签页打开；非法类型拒绝并提示）
- 文件：.mm/.xml 读写、.xmind 只读导入（自动转存 .mm）

## 快捷键

按 **F1** 查看速查表；与原版完全一致（见 docs/FEATURES.md 第 9 节）。

## 使用

```
target\release\RustMindPlot.exe                  # 打开欢迎导图
target\release\RustMindPlot.exe D:\xx\demo.mm    # 启动时直接打开 .mm/.xml/.xmind
                                                 # （等同把文件拖到 exe 图标上）
target\release\RustMindPlot.exe --selftest       # 内置自检（写 selftest-result.json 后退出）
```

把 .mm/.xml/.xmind 文件拖进程序窗口也可打开（悬停有放置提示，多文件分别开成
标签页）；其他类型文件会被拒绝并提示，不会崩溃。

配置（`app.config.json`）生成在 exe 同目录；附件与图片均内嵌在 .mm 文件内部，
拷贝单个 .mm 文件即可在别的电脑使用。

## 从源码构建

```
cargo build            # debug（带控制台便于诊断）
cargo build --release  # release（窗口子系统，无控制台）
cargo test             # 解析器契约测试（对齐原 test_parser.py）
```

## 目录结构

```
RustMindPlot/
├─ src/
│  ├─ main.rs        # 入口：窗口、事件循环、关闭拦截、自检轮询、配置写回
│  ├─ bridge.rs      # pywebview 兼容垫片 + IPC 分发（19 个桥接命令）
│  ├─ assets.rs      # 内嵌前端资产 + 自定义协议虚拟主机
│  ├─ config.rs      # app.config.json 读写、启动参数解析
│  ├─ files.rs       # 导图加载/保存、附件、图片、PNG（对齐 main.py 语义）
│  ├─ mm.rs          # 数据模型、.mm/.xml 解析与 ET 兼容序列化
│  ├─ xmind.rs       # .xmind 导入（content.json / content.xml）
│  ├─ xml.rs         # 极简 XML DOM（quick-xml）+ ElementTree 兼容输出
│  └─ lib.rs
├─ web/              # 前端（与 mindmap-app/app/web 逐字节一致，include_str! 内嵌）
├─ samples/          # 样例（与原项目一致）
├─ tests/parser_test.rs  # 解析器契约测试
├─ docs/FEATURES.md  # 功能与行为清单（验收依据）
└─ assets/icon.ico   # 应用图标（构建期嵌入 EXE）
```

## 验证门禁

| 门禁 | 结果 |
| --- | --- |
| `cargo build` / `cargo build --release` | 通过 |
| `cargo test`（19 组，覆盖原 test_parser.py 109 项断言） | 19/19 通过 |
| `--selftest`（原 151 项 UI 自检，debug + release） | 151/151 `total:true` |
| 启动参数打开文件、优雅退出写回配置 | 通过 |
| 原项目样例全格式打开、保存格式逐字节兼容 | 通过 |
