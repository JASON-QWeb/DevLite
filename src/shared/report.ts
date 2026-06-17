import { analyzeSession } from "./analyzer";
import type { DiagnosticSettings, DiagnosticSession, UiLocale } from "./types";

export function generateMarkdownReport(session: DiagnosticSession, settings: DiagnosticSettings): string {
  const locale = settings.locale;
  const analysis = analyzeSession(session, settings.slowRequestThreshold, locale);
  const page = session.page;
  const lines: string[] = [];
  const l = (zh: string, en: string) => (locale === "en" ? en : zh);

  lines.push(locale === "en" ? "# DevLite Page Diagnostics Report" : "# DevLite 页面诊断报告");
  lines.push("");
  lines.push(locale === "en" ? "## Issue Summary" : "## 问题摘要");
  lines.push(analysis.summary);
  lines.push("");

  lines.push(locale === "en" ? "## Page Info" : "## 页面信息");
  lines.push(`- URL: ${page.url}`);
  lines.push(`- ${l("标题", "Title")}: ${page.title || l("无标题", "Untitled")}`);
  lines.push(`- ${l("浏览器", "Browser")}: ${page.userAgent}`);
  lines.push(`- ${l("语言", "Language")}: ${page.language}`);
  lines.push(`- ${l("视口", "Viewport")}: ${page.viewport.width} x ${page.viewport.height}, DPR ${page.viewport.devicePixelRatio}`);
  lines.push(`- ${l("开始时间", "Started at")}: ${formatDate(page.startedAt, locale)}`);
  if (page.endedAt) {
    lines.push(`- ${l("结束时间", "Ended at")}: ${formatDate(page.endedAt, locale)}`);
  }
  lines.push("");

  lines.push(locale === "en" ? "## Local Rule Analysis" : "## 本地规则分析");
  if (analysis.findings.length === 0) {
    lines.push(l("未发现明显错误。", "No obvious issues were detected."));
  } else {
    analysis.findings.forEach((finding, index) => {
      lines.push(`### ${index + 1}. ${finding.title}`);
      lines.push(`- ${l("级别", "Severity")}: ${finding.severity}`);
      lines.push(`- ${l("说明", "Detail")}: ${finding.detail}`);
      lines.push(`- ${l("建议", "Suggestion")}: ${finding.suggestion}`);
      if (finding.evidence.length > 0) {
        lines.push(`- ${l("证据", "Evidence")}:`);
        finding.evidence.forEach((item) => lines.push(`  - ${truncate(item, 500)}`));
      }
      lines.push("");
    });
  }

  lines.push(locale === "en" ? "## Event Counters" : "## 事件统计");
  lines.push(`- ${l("JS 错误", "JS errors")}: ${analysis.counters.jsErrors}`);
  lines.push(`- ${l("Promise 异常", "Promise rejections")}: ${analysis.counters.promiseErrors}`);
  lines.push(`- console.error: ${analysis.counters.consoleErrors}`);
  lines.push(`- ${l("失败请求", "Failed requests")}: ${analysis.counters.failedRequests}`);
  lines.push(`- ${l("慢请求", "Slow requests")}: ${analysis.counters.slowRequests}`);
  lines.push(`- ${l("资源加载失败", "Resource load failures")}: ${analysis.counters.resourceErrors}`);
  lines.push(`- ${l("样式修改", "Style edits")}: ${analysis.counters.styleChanges}`);
  lines.push("");

  if (session.events.length > 0) {
    lines.push(locale === "en" ? "## Error And Request Details" : "## 错误和请求明细");
    session.events.slice(0, 80).forEach((event, index) => {
      lines.push(`### ${index + 1}. ${event.type} / ${event.severity}`);
      lines.push(`- ${l("时间", "Time")}: ${formatDate(event.timestamp, locale)}`);
      lines.push(`- ${l("信息", "Message")}: ${truncate(event.message, 800)}`);
      if (event.method || event.url) {
        lines.push(`- ${l("请求", "Request")}: ${event.method ?? "GET"} ${event.url ?? ""}`);
      }
      if (event.status) lines.push(`- ${l("状态码", "Status")}: ${event.status}`);
      if (event.duration) lines.push(`- ${l("耗时", "Duration")}: ${event.duration}ms`);
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
    lines.push(locale === "en" ? "## Page Edits" : "## 页面修改");
    session.styleChanges.forEach((change, index) => {
      const hasStyleChanges = Object.values(change.after).some(Boolean);
      const hasTextChange = change.textAfter !== undefined && change.textAfter !== (change.textBefore ?? "");
      lines.push(`### ${index + 1}. ${change.elementLabel}`);
      lines.push(`- Selector: \`${change.selector}\``);
      lines.push(`- ${l("文本", "Text")}: ${change.textSnippet || l("无文本", "No text")}`);

      if (hasTextChange) {
        lines.push("");
        lines.push(l("文字修改前:", "Text before:"));
        lines.push("```text");
        lines.push(truncate(change.textBefore ?? "", 1200));
        lines.push("```");
        lines.push("");
        lines.push(l("文字修改后:", "Text after:"));
        lines.push("```text");
        lines.push(truncate(change.textAfter ?? "", 1200));
        lines.push("```");
      }

      if (hasStyleChanges) {
        lines.push("");
        lines.push(l("样式修改前:", "Styles before:"));
        lines.push("```css");
        lines.push(cssBlock(change.before, locale));
        lines.push("```");
        lines.push("");
        lines.push(l("样式修改后:", "Styles after:"));
        lines.push("```css");
        lines.push(cssBlock(change.after, locale));
        lines.push("```");
      }
      lines.push("");
    });
  }

  lines.push(locale === "en" ? "## Privacy Note" : "## 隐私说明");
  lines.push(
    locale === "en"
      ? "This report was generated locally by DevLite on the current page. Sensitive fields are redacted by built-in rules and Cookie, Authorization, and full page HTML are not included by default."
      : "本报告由 DevLite 在当前页面本地生成。敏感字段已按内置规则脱敏，默认不包含 Cookie、Authorization 或完整页面 HTML。"
  );

  return lines.join("\n");
}

function cssBlock(styles: Record<string, string>, locale: UiLocale): string {
  const entries = Object.entries(styles);
  if (entries.length === 0) {
    return locale === "en" ? "/* none */" : "/* 无 */";
  }
  return entries.map(([key, value]) => `${key}: ${value};`).join("\n");
}

function formatDate(timestamp: number, locale: UiLocale): string {
  return new Date(timestamp).toLocaleString(locale === "en" ? "en-US" : "zh-CN");
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n...[TRUNCATED ${value.length - max} chars]`;
}
