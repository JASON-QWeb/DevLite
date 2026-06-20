<div align="center">

<img src="assets/readme-cover-en.png" alt="DevLite" width="100%" />

English | [中文](./README.zh.md)

</div>

---

## Features

| Without DevLite | With DevLite |
| --- | --- |
| Browser DevTools has a high learning cost, making it hard for beginners to get started quickly. | Open the page to inspect elements, review issues, and access diagnostic information. |
| Text, images, and styles cannot be edited directly on the page. | Select page elements and edit them in real time, then preview the result immediately. |
| Design issues can only be communicated to agents through screenshots, which can cause positioning and interpretation gaps. | Automatically collect page elements, edit records, and context, then export a structured prompt that helps agents locate and execute fixes more easily. |
| Logs, network requests, and performance issues are scattered across multiple panels, making clues time-consuming to copy and organize. | View logs, errors, request status, Promise exceptions, and performance metrics in one place, then copy key details in one click. |

---

## Demo

<div align="center">

![DevLite Demo](assets/devlite-demo-en.gif)

</div>

---

## Download

<div align="center">

[![Get it on Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-Get%20Extension-1A73E8?style=for-the-badge&logo=googlechrome&logoColor=white&labelColor=202124)](https://chromewebstore.google.com/detail/devlite/pppajolpipomdlekjlmboemhoadlkgfm)
&nbsp;&nbsp;
![Microsoft Edge Add-ons Coming Soon](https://img.shields.io/badge/Microsoft%20Edge%20Add--ons-Coming%20Soon-0A7B83?style=for-the-badge&logo=microsoftedge&logoColor=white&labelColor=202124)
&nbsp;&nbsp;

</div>

---

## Install Companion SKILL to Strengthen Agent Capabilities

DevLite exports prompts compatible with **all mainstream coding agents**:

<div align="center">

[![Codex](https://img.shields.io/badge/Codex-000000?style=for-the-badge&logo=openai&logoColor=white)](#)
&nbsp;
[![Claude Code](https://img.shields.io/badge/Claude_Code-D97757?style=for-the-badge&logo=claude&logoColor=white)](#)
&nbsp;
[![Qwen](https://img.shields.io/badge/Qwen-615CED?style=for-the-badge&logo=alibabacloud&logoColor=white)](#)
&nbsp;
[![DeepSeek](https://img.shields.io/badge/DeepSeek-4D6BFF?style=for-the-badge&logo=deepseek&logoColor=white)](#)&nbsp;
[![Hermes](https://img.shields.io/badge/Hermes-7952B3?style=for-the-badge&logo=hermes&logoColor=white)](#)

</div>

Strengthen your AI agent's ability to **understand and process DevLite diagnostic reports** by sending this instruction to your agent:

```
Please install the SKILL.md from the https://github.com/JASON-QWeb/DevLite repository into your Agent Skills configuration, and use the browser download links in README.md to help the user install the DevLite browser extension.
```

---

## Developer Setup

```bash
git clone https://github.com/JASON-QWeb/DevLite.git
cd DevLite
npm install
npm run build
```

Then load the `dist/` folder as an unpacked extension in your browser.

---

## Feedback & Contributions

This project is open source under the [Apache License 2.0](./LICENSE). 

If you find it useful, please leave a Star, thanks a lot.

Issues and PRs are welcome.
