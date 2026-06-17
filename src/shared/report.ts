import { analyzeSession } from "./analyzer";
import type { DiagnosticSettings, DiagnosticSession } from "./types";

export function generateMarkdownReport(session: DiagnosticSession, settings: DiagnosticSettings): string {
  const analysis = analyzeSession(session, settings.slowRequestThreshold);
  const page = session.page;
  const lines: string[] = [];

  lines.push("# DevLite 页面诊断报告");
  lines.push("");
  lines.push("## 问题摘要");
  lines.push(analysis.summary);
  lines.push("");

  lines.push("## 页面信息");
  lines.push(`- URL: ${page.url}`);
  lines.push(`- 标题: ${page.title || "无标题"}`);
  lines.push(`- 浏览器: ${page.userAgent}`);
  lines.push(`- 语言: ${page.language}`);
  lines.push(`- 视口: ${page.viewport.width} x ${page.viewport.height}, DPR ${page.viewport.devicePixelRatio}`);
  lines.push(`- 开始时间: ${new Date(page.startedAt).toLocaleString("zh-CN")}`);
  if (page.endedAt) {
    lines.push(`- 结束时间: ${new Date(page.endedAt).toLocaleString("zh-CN")}`);
  }
  lines.push("");

  lines.push("## 本地规则分析");
  if (analysis.findings.length === 0) {
    lines.push("未发现明显错误。");
  } else {
    analysis.findings.forEach((finding, index) => {
      lines.push(`### ${index + 1}. ${finding.title}`);
      lines.push(`- 级别: ${finding.severity}`);
      lines.push(`- 说明: ${finding.detail}`);
      lines.push(`- 建议: ${finding.suggestion}`);
      if (finding.evidence.length > 0) {
        lines.push("- 证据:");
        finding.evidence.forEach((item) => lines.push(`  - ${truncate(item, 500)}`));
      }
      lines.push("");
    });
  }

  lines.push("## 事件统计");
  lines.push(`- JS 错误: ${analysis.counters.jsErrors}`);
  lines.push(`- Promise 异常: ${analysis.counters.promiseErrors}`);
  lines.push(`- console.error: ${analysis.counters.consoleErrors}`);
  lines.push(`- 失败请求: ${analysis.counters.failedRequests}`);
  lines.push(`- 慢请求: ${analysis.counters.slowRequests}`);
  lines.push(`- 资源加载失败: ${analysis.counters.resourceErrors}`);
  lines.push(`- 样式修改: ${analysis.counters.styleChanges}`);
  lines.push("");

  if (session.events.length > 0) {
    lines.push("## 错误和请求明细");
    session.events.slice(0, 80).forEach((event, index) => {
      lines.push(`### ${index + 1}. ${event.type} / ${event.severity}`);
      lines.push(`- 时间: ${new Date(event.timestamp).toLocaleString("zh-CN")}`);
      lines.push(`- 信息: ${truncate(event.message, 800)}`);
      if (event.method || event.url) {
        lines.push(`- 请求: ${event.method ?? "GET"} ${event.url ?? ""}`);
      }
      if (event.status) lines.push(`- 状态码: ${event.status}`);
      if (event.duration) lines.push(`- 耗时: ${event.duration}ms`);
      if (event.stack) {
        lines.push("");
        lines.push("```text");
        lines.push(truncate(event.stack, 1400));
        lines.push("```");
      }
      if (event.responseBody) {
        lines.push("");
        lines.push("```text");
        lines.push(truncate(event.responseBody, settings.maxResponseLength));
        lines.push("```");
      }
      lines.push("");
    });
  }

  if (session.styleChanges.length > 0) {
    lines.push("## 页面修改");
    session.styleChanges.forEach((change, index) => {
      const hasStyleChanges = Object.values(change.after).some(Boolean);
      const hasTextChange = change.textAfter !== undefined && change.textAfter !== (change.textBefore ?? "");
      lines.push(`### ${index + 1}. ${change.elementLabel}`);
      lines.push(`- Selector: \`${change.selector}\``);
      lines.push(`- 文本: ${change.textSnippet || "无文本"}`);

      if (hasTextChange) {
        lines.push("");
        lines.push("文字修改前:");
        lines.push("```text");
        lines.push(truncate(change.textBefore ?? "", 1200));
        lines.push("```");
        lines.push("");
        lines.push("文字修改后:");
        lines.push("```text");
        lines.push(truncate(change.textAfter ?? "", 1200));
        lines.push("```");
      }

      if (hasStyleChanges) {
        lines.push("");
        lines.push("样式修改前:");
        lines.push("```css");
        lines.push(cssBlock(change.before));
        lines.push("```");
        lines.push("");
        lines.push("样式修改后:");
        lines.push("```css");
        lines.push(cssBlock(change.after));
        lines.push("```");
      }
      lines.push("");
    });
  }

  lines.push("## 隐私说明");
  lines.push("本报告由 DevLite 在当前页面本地生成。敏感字段已按内置规则脱敏，默认不包含 Cookie、Authorization 或完整页面 HTML。");

  return lines.join("\n");
}

function cssBlock(styles: Record<string, string>): string {
  const entries = Object.entries(styles);
  if (entries.length === 0) {
    return "/* 无 */";
  }
  return entries.map(([key, value]) => `${key}: ${value};`).join("\n");
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n...[TRUNCATED ${value.length - max} chars]`;
}
