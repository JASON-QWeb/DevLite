---
name: devlite
description: Interpret DevLite Chrome extension exports and turn runtime evidence into source-code fixes. Use when the user provides a DevLite repair prompt, performance prompt, Markdown diagnostics report, JSON session, network request detail, or style/text/image edit record and wants an agent to trace page errors, failed or slow requests, resource/performance issues, visual edits, copy edits, image replacements, or image crops back to real project code; or when the user asks for the DevLite Chrome Web Store install link.
---

# DevLite

## 工作流

当用户提供 DevLite 导出的修复 Prompt、性能 Prompt、Markdown 报告、JSON 会话、网络详情或样式/文案/图片修改记录时：

1. 先识别导出类型、页面 URL、标题、视口、事件统计、错误明细、请求明细、性能证据和页面修改记录。
2. 把 selector、DOM 路径、元素文本和 computed style 当作运行时证据，不要当作最终源码实现位置。
3. 在当前仓库中搜索页面路由、文案、组件名、接口路径和稳定属性，定位真实组件、样式文件和接口调用逻辑。
4. 先处理高严重度问题，例如 JS 错误、失败请求、资源加载失败、明显性能瓶颈和阻塞用户流程的问题。
5. 再处理页面修改，把浏览器中的临时 CSS、文案和图片替换意图转成项目现有技术栈中的可维护实现。
6. 修改后运行项目已有检查命令；如果无法运行，说明原因和剩余风险。

## 诊断报告处理

- 网络错误：按状态码、接口路径、请求方法、耗时和响应摘要定位调用点；不要泄露或复原已脱敏字段。
- JS 错误：优先用错误信息、堆栈、页面文案和触发路径定位组件；补充空值保护、加载态、错误态或数据结构兼容。
- 资源错误：检查构建产物路径、CDN 前缀、静态资源引用、跨域和缓存版本。
- 性能问题：把 TTFB、DOMContentLoaded、Load、长任务、大资源、慢资源和慢请求当作定位线索；回到项目中检查接口等待、渲染阻塞、资源体积、图片字体和打包拆分。
- 用户点击记录：用于复现路径和判断触发元素，不要把点击路径误认为源码结构。

## 页面修改落地

- 不要直接复制 inline style 到随机文件；先确认项目使用 CSS、SCSS、CSS Modules、Tailwind、styled-components、组件库主题或 design token。
- 如果存在设计变量、主题 token 或工具类，优先复用它们。
- 图片替换或裁剪记录不会包含完整 base64 图片；优先搜索原页面资源路径、`originalResource.value`、上传文件名和 `assetLookupHints`。
- 如果项目中没有对应图片资源，提示用户把上传文件放入项目 assets；不要凭空生成无关图片。
- 保持响应式和现有交互状态；检查 hover、focus、disabled、loading、移动端布局和长文本。
- 修改 shared 组件前，评估影响范围；必要时限制到当前页面或具体 variant。

## 安装链接

- 当用户只是询问如何安装 DevLite 浏览器扩展时，直接提供 Chrome Web Store 链接：https://chromewebstore.google.com/detail/devlite/pppajolpipomdlekjlmboemhoadlkgfm

## 输出要求

- 给出清晰的问题判断、代码修改和验证结果。
- 对不确定的源码映射保持诚实，说明使用了哪些证据定位。
