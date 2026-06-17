# DevLite

DevLite is a lightweight inspection-mode Chrome extension for live page edits, data lookup, page diagnostics, and repair prompt exports for agents.

By default, it does not call AI services, does not upload data, and only diagnoses the current page after the user explicitly starts a session.

## Features

- Start or stop diagnostics for the current page
- Capture JavaScript runtime errors, unhandled Promise rejections, and `console.error`
- Capture `fetch` and `XMLHttpRequest` URL, method, status, duration, and failures
- Capture failed image, script, stylesheet, and font resources
- Record recent user clicks to help reproduce issues
- Generate a local Markdown diagnostic report
- Select page elements and inspect key computed styles
- Live-edit color, background, font size, spacing, radius, layout, and more
- Edit HTML text content directly on the page
- Track page changes
- Open a draggable always-on-top diagnostics panel from the right-side page icon
- Export AI Prompt, Markdown, or JSON
- Optionally use the user's own OpenAI, DeepSeek, Anthropic, or Gemini API key

## Architecture

```text
Chrome Extension Manifest V3
├── popup
├── options
├── background service worker
├── content script
└── injected script
```

The content script handles page interaction and the visual CSS editor. The injected script runs in the page context so it can hook `fetch`, `XMLHttpRequest`, and console errors. The background service worker aggregates data, redacts sensitive fields, generates reports, and optionally calls AI providers with the user's own API key.

## Development

Install dependencies:

```bash
npm install
```

Build the extension:

```bash
npm run build
```

Package a zip:

```bash
npm run zip
```

Load locally:

1. Open `chrome://extensions`.
2. Enable developer mode.
3. Click "Load unpacked".
4. Select the generated `dist` directory.

## Agent Skill One-Command Install

The project root includes `SKILL.md` so agents can better understand DevLite Prompt exports, diagnostic reports, and style change records.

After launch, replace the repository URL and Chrome Web Store URL in this instruction, then send it directly to an agent:

```text
Install the DevLite Skill: read <your DevLite repository URL>/SKILL.md, then create or update devlite/SKILL.md in the current agent's Skill directory with that content. After installation, send me the DevLite Chrome extension install link: <Chrome Web Store launch URL>.
```

## Privacy Model

- Local analysis by default.
- No automatic upload.
- No full response body collection by default.
- Sensitive fields are redacted.
- CSS and text edits are temporary and only affect the current browser page.
- AI analysis requires explicit user confirmation.

See the Chinese documentation in [docs/隐私与上架策略.md](./docs/隐私与上架策略.md).
