<div align="center">

<img src="assets/readme-cover-zh.png" alt="DevLite" width="100%" />

中文 | [English](./README.en.md)

</div>

---

## 功能介绍

| 未安装 DevLite | 安装 DevLite 后 |
| --- | --- |
| 浏览器开发者工具学习成本高，新手难快速上手 | 打开页面即可检查元素、查看问题、诊断信息 |
| 无法直接在页面上编辑文字、图片和样式 | 直接选中页面元素实时修改，马上预览修改结果 |
| 只能通过截图与 Agent 沟通设计问题，定位和理解容易出现偏差 | 自动整理页面元素、修改记录和上下文，导出让 Agent 更容易定位、执行的结构化 Prompt。 |
| 日志、网络请求、性能问题分散在多个面板里，复制和整理线索费时费力 | 集中查看日志 、错误、请求状态、Promise 异常和性能指标，一键复制关键内容。 |

---

## 微前端与嵌套页面

Chrome 119+。元素选择支持普通页面、开放与封闭 Shadow DOM、同源与跨域 iframe，以及混合嵌套。真实框架回归覆盖无界正常/降级/保活/多应用、qiankun 严格样式隔离、micro-app Shadow DOM 与 iframe 沙箱配置。

子文档在本地执行选取、编辑和撤销，操作入口统一显示在主面板。支持中文文本输入、样式、图片、图标、删除、父级选择及带容器路径的修改导出。首次安装或更新扩展后请刷新目标页面。

受浏览器限制的 frame 可能无法注入；Canvas 内部图形、伪元素和浏览器原生控件内部不属于可编辑 DOM。业务输入框和富文本编辑器保留选择、样式及描述需求能力。删除记录需要手动确认；跨导航丢失的节点状态不会通过重建 HTML 冒充无损撤销。

实现与验收见 [元素选择跨容器适配说明](./docs/元素选择跨容器适配方案.md)。本轮扩展的是元素操作，子应用网络和 console 的完整采集不在此支持声明内。

## 功能演示

<div align="center">

![DevLite 功能演示](assets/devlite-demo-zh.gif)

</div>

---

## 下载安装

<div align="center">

[![Get it on Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-Get%20Extension-1A73E8?style=for-the-badge&logo=googlechrome&logoColor=white&labelColor=202124)](https://chromewebstore.google.com/detail/devlite/pppajolpipomdlekjlmboemhoadlkgfm)
&nbsp;&nbsp;
[![Get it on Microsoft Edge Add-ons](https://img.shields.io/badge/Microsoft%20Edge%20Add--ons-%E7%AB%8B%E5%8D%B3%E5%AE%89%E8%A3%85-0A7B83?style=for-the-badge&logo=microsoftedge&logoColor=white&labelColor=202124)](https://microsoftedge.microsoft.com/addons/detail/devlite/mglelpeocmhnogdgfioljebnonbjdkhj)
&nbsp;&nbsp;
</div>

---

## 安装配套 SKILL

DevLite 导出的 Prompt 支持**全部主流 Coding Agent**：

<div align="center">

<img src="public/agent-logos/codex.svg" title="Codex" alt="Codex" width="32" />&nbsp;&nbsp;&nbsp;&nbsp;
<img src="public/agent-logos/claude-code.svg" title="Claude Code" alt="Claude Code" width="32" />&nbsp;&nbsp;&nbsp;&nbsp;
<img src="public/agent-logos/gemini.svg" title="Gemini" alt="Gemini" width="32" />&nbsp;&nbsp;&nbsp;&nbsp;
<img src="public/agent-logos/qwen.svg" title="Qwen" alt="Qwen" width="32" />&nbsp;&nbsp;&nbsp;&nbsp;
<img src="public/agent-logos/deepseek.svg" title="DeepSeek" alt="DeepSeek" width="32" />&nbsp;&nbsp;&nbsp;&nbsp;
<img src="public/agent-logos/kimi.svg" title="Kimi" alt="Kimi" width="32" />
<br>
<img src="public/agent-logos/minimax.svg" title="MiniMax" alt="MiniMax" width="32" />&nbsp;&nbsp;&nbsp;&nbsp;
<img src="public/agent-logos/glm.svg" title="GLM" alt="GLM" width="32" />&nbsp;&nbsp;&nbsp;&nbsp;
<img src="public/agent-logos/antigravity.svg" title="Antigravity" alt="Antigravity" width="32" />&nbsp;&nbsp;&nbsp;&nbsp;
<img src="public/agent-logos/hermes.svg" title="Hermes" alt="Hermes" width="32" />&nbsp;&nbsp;&nbsp;&nbsp;
<img src="public/agent-logos/openclaw.svg" title="OpenClaw" alt="OpenClaw" width="32" />&nbsp;&nbsp;&nbsp;&nbsp;
<img src="public/agent-logos/cursor.svg" title="Cursor" alt="Cursor" width="32" />

</div>

发送此指令给你的 Agent，以强化 **处理 DevLite 的能力**：

```
Read https://github.com/JASON-QWeb/DevLite/blob/main/SKILL.md and install the SKILL
```

---

## 开发者启动

```bash
git clone https://github.com/JASON-QWeb/DevLite.git
cd DevLite
npm install
npm run build
```

然后将 `dist/` 文件夹作为未打包的扩展加载到浏览器中。

---

## 反馈与贡献

本项目基于 [Apache License 2.0 许可证](./LICENSE) 开源

觉得好用请留下你的Star，十分感谢

欢迎提交 Issue 反馈问题、提交 PR
