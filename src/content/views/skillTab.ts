import type { ContentTextKey } from "../i18n";
import { SKILL_INSTALL_PROMPT } from "../skillInstall";
import { escapeHtml } from "../utils";

type SkillTabContext = {
  t: (key: ContentTextKey) => string;
};

type AgentBadge = {
  name: string;
  tone: string;
  logoFile: string;
};

const AGENT_BADGES: AgentBadge[] = [
  { name: "Codex", tone: "codex", logoFile: "codex.svg" },
  { name: "Claude Code", tone: "claude", logoFile: "claude-code.svg" },
  { name: "Gemini", tone: "gemini", logoFile: "gemini.svg" },
  { name: "Qwen", tone: "qwen", logoFile: "qwen.svg" },
  { name: "DeepSeek", tone: "deepseek", logoFile: "deepseek.svg" },
  { name: "Kimi", tone: "kimi", logoFile: "kimi.svg" },
  { name: "MiniMax", tone: "minimax", logoFile: "minimax.svg" },
  { name: "GLM", tone: "glm", logoFile: "glm.svg" },
  { name: "Antigravity", tone: "antigravity", logoFile: "antigravity.svg" },
  { name: "Hermes", tone: "hermes", logoFile: "hermes.svg" },
  { name: "OpenClaw", tone: "openclaw", logoFile: "openclaw.svg" },
  { name: "Cursor", tone: "cursor", logoFile: "cursor.svg" }
];

export function renderSkillTabView({ t }: SkillTabContext): string {
  return `
      <div class="skill-install-panel">
        <section class="skill-install-card">
          <h3>${t("skillInstallTitle")}</h3>
          <p>${t("skillInstallIntro")}</p>
          <div class="skill-install-prompt-wrap">
            <code class="skill-install-prompt">${escapeHtml(SKILL_INSTALL_PROMPT)}</code>
            <button type="button" data-action="copy-skill-install-prompt" class="skill-prompt-copy" title="${t("copySkillPrompt")}" aria-label="${t("copySkillPrompt")}">
              ${copyIcon()}
            </button>
          </div>
        </section>
        <section class="skill-install-card">
          <h3>${t("skillSupportedAgents")}</h3>
          <div class="skill-agent-grid" aria-label="${t("skillSupportedAgents")}">
            ${AGENT_BADGES.map(renderAgentBadge).join("")}
          </div>
        </section>
        <a href="https://github.com/JASON-QWeb/DevLite" data-action="open-source-page" class="skill-open-source-note">${t("skillOpenSourceThanks")}</a>
      </div>
    `;
}

function renderAgentBadge(agent: AgentBadge): string {
  return `
      <div class="skill-agent-badge ${agent.tone}" aria-label="${escapeHtml(agent.name)}">
        <img src="${escapeHtml(agentLogoUrl(agent.logoFile))}" alt="" loading="lazy" />
        <span>${escapeHtml(agent.name)}</span>
      </div>
    `;
}

function agentLogoUrl(fileName: string): string {
  return chrome.runtime.getURL(`agent-logos/${fileName}`);
}

function copyIcon(): string {
  return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="9" y="9" width="10" height="10" rx="2" />
        <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
      </svg>
    `;
}
