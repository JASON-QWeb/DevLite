# DevLite

DevLite 是一个简易版检查模式 Chrome 扩展，用于实时修改页面元素、查阅数据获取、诊断页面问题，并直接生成 prompt 复制给 agent 进行修复。

默认模式不调用 AI，不上传数据，只在用户主动点击后诊断当前页面。

## 核心功能

- 一键开始或停止当前页面诊断
- 捕获 JS 运行错误、未处理 Promise 异常、`console.error`
- 捕获 `fetch`、`XMLHttpRequest` 的 URL、方法、状态码、耗时和错误
- 捕获图片、脚本、样式、字体等资源加载失败
- 记录最近用户点击路径，辅助复现问题
- 使用本地规则生成 Markdown 诊断报告
- 选择页面元素并查看关键 computed style
- 实时修改文字颜色、背景色、字号、间距、圆角、布局等 CSS
- 直接在页面上编辑 HTML 文本内容
- 记录页面修改历史
- 通过页面右侧图标打开可拖动的诊断栏
- 支持中文和英文界面切换，报告和 Prompt 跟随当前语言
- 导出 AI Prompt、Markdown、JSON
- 可选配置用户自己的 OpenAI、DeepSeek、Anthropic、Gemini API Key

## 技术架构

```text
Chrome Extension Manifest V3
├── popup
│   ├── 诊断控制
│   ├── 统计展示
│   ├── 报告生成
│   ├── 导出通用 Prompt
│   └── AI 发送前预览
│
├── options
│   ├── response 摘要配置
│   ├── 脱敏字段配置
│   └── 用户 API Key 配置
│
├── background service worker
│   ├── 会话管理
│   ├── 数据汇总
│   ├── 脱敏
│   ├── 本地规则分析
│   ├── 导出生成
│   └── AI API 调用
│
├── content script
│   ├── 接收页面事件
│   ├── 捕获资源加载失败
│   ├── 元素选择器
│   ├── 右侧诊断栏入口
│   ├── CSS 编辑浮层
│   └── 页面修改记录
│
└── injected script
    ├── hook fetch
    ├── hook XMLHttpRequest
    ├── hook console.error
    ├── 捕获 window error
    └── 捕获 unhandledrejection
```

## 权限说明

```json
{
  "content_scripts": [
    {
      "matches": ["http://*/*", "https://*/*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ],
  "permissions": ["activeTab", "scripting", "storage", "clipboardWrite"],
  "host_permissions": ["http://*/*", "https://*/*"],
  "optional_host_permissions": [
    "https://api.openai.com/*",
    "https://api.deepseek.com/*",
    "https://api.anthropic.com/*",
    "https://generativelanguage.googleapis.com/*"
  ]
}
```

- `activeTab`：用户主动点击扩展后，临时访问当前页面。
- `content_scripts`：在普通 HTTP/HTTPS 页面默认显示右侧 DevLite 入口。
- `host_permissions`：允许用户点击页面入口后，按需向当前 HTTP/HTTPS 页面注入采集脚本。
- `scripting`：向当前页面注入诊断脚本和元素选择器。
- `storage`：保存本地设置，例如脱敏字段和用户 API Key。
- `clipboardWrite`：复制报告和 Prompt。
- `optional_host_permissions`：仅在用户启用对应能力时请求，例如 AI 服务接口访问。

DevLite 会在普通 HTTP/HTTPS 页面默认显示右侧入口，但不会自动开始诊断采集。`injected script` 只在用户打开面板、开始诊断或选择元素后按需注入。

## 开发

安装依赖：

```bash
npm install
```

构建扩展：

```bash
npm run build
```

打包 zip：

```bash
npm run zip
```

本地加载：

1. 打开 Chrome 的 `chrome://extensions`。
2. 开启开发者模式。
3. 点击「加载已解压的扩展程序」。
4. 选择项目生成的 `dist` 目录。

## 使用流程

1. 打开需要诊断的网页。
2. 点击 DevLite 图标。
3. 点击「开始诊断」。
4. 在页面上复现问题。
5. 点击页面右侧 DevLite 图标打开诊断栏，诊断栏可拖动并始终置顶。
6. 点击「生成报告」或直接导出 AI Prompt。
7. 如需调整页面，点击「选择元素」，在页面中点击目标元素并实时修改 CSS 或直接编辑文字内容。

## Agent Skill 一键安装

项目根目录提供了 `SKILL.md`，用于帮助 Agent 更好理解 DevLite 导出的 Prompt、诊断报告和样式修改记录。

上线后把下面指令中的仓库地址和 Chrome Web Store 链接替换为正式地址，然后直接发送给 Agent：

```text
请安装 DevLite Skill：从 <你的 DevLite 仓库地址>/SKILL.md 读取内容，创建或更新当前 Agent 的 Skill 目录中的 devlite/SKILL.md。安装完成后，请把 DevLite Chrome 插件安装链接发给我：<Chrome Web Store 上线链接>。
```

## AI 模式

DevLite 默认不启用 AI。需要 AI 分析时，用户可以在设置页选择「用户 API Key」模式并填写自己的 API Key。

发送给 AI 之前，popup 会展示即将发送的脱敏内容。默认不会发送 Cookie、Authorization、完整页面 HTML 或密码输入框内容。

## 隐私边界

- 默认本地分析。
- 默认不采集完整 response body。
- 默认不上传任何诊断数据。
- 所有敏感字段会经过脱敏规则处理。
- CSS 修改只作用于当前浏览器页面，刷新后恢复。
- AI 分析必须由用户主动确认。

更多说明见 [隐私与上架策略](./docs/隐私与上架策略.md)。

## 路线图

- v0.1：页面诊断、本地规则分析、CSS 实时修改、文字内容编辑、Prompt 导出
- v0.2：更完整的 CSS 编辑器、撤销栈、页面修改分组、截图标注
- v0.3：用户 API Key AI 分析、Issue 模板、Cursor Prompt
- v0.4：可选 DevTools Panel、HAR 导出、错误时间线
