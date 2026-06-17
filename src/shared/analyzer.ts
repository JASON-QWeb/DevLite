import type { AnalysisFinding, AnalysisResult, DiagnosticEvent, DiagnosticSession, UiLocale } from "./types";

export function analyzeSession(session: DiagnosticSession, slowRequestThreshold: number, locale: UiLocale = "zh"): AnalysisResult {
  const en = locale === "en";
  const events = session.events;
  const jsErrors = events.filter((event) => event.type === "js-error");
  const promiseErrors = events.filter((event) => event.type === "unhandled-rejection");
  const consoleErrors = events.filter((event) => event.type === "console-error");
  const networkEvents = events.filter((event) => event.type === "network");
  const failedRequests = networkEvents.filter((event) => isFailedStatus(event.status) || event.severity === "error");
  const slowRequests = networkEvents.filter((event) => typeof event.duration === "number" && event.duration >= slowRequestThreshold);
  const resourceErrors = events.filter((event) => event.type === "resource-error");

  const findings: AnalysisFinding[] = [
    ...buildNetworkFindings(failedRequests, locale),
    ...buildJsFindings([...jsErrors, ...promiseErrors, ...consoleErrors], locale),
    ...buildResourceFindings(resourceErrors, locale),
    ...buildPerformanceFindings(slowRequests, locale)
  ];

  if (session.styleChanges.length > 0) {
    findings.push({
      title: en ? "Temporary page edits detected" : "存在页面临时修改",
      detail: en
        ? `${session.styleChanges.length} temporary page edits were recorded. Export the repair prompt to implement them in source code.`
        : `本次会话记录了 ${session.styleChanges.length} 处页面临时修改，可导出修复 Prompt 后在源码中实现。`,
      severity: "info",
      evidence: session.styleChanges.slice(0, 5).map((change) => `${change.selector}: ${changeEvidence(change, locale)}`),
      suggestion: en
        ? "After exporting the repair prompt, locate the related components, copy, and style files, then implement the edits using the existing stack."
        : "导出修复 Prompt 后，在项目中定位对应组件、文案和样式文件，按现有技术栈实现这些页面调整。"
    });
  }

  const counters = {
    jsErrors: jsErrors.length,
    promiseErrors: promiseErrors.length,
    consoleErrors: consoleErrors.length,
    failedRequests: failedRequests.length,
    slowRequests: slowRequests.length,
    resourceErrors: resourceErrors.length,
    styleChanges: session.styleChanges.length
  };

  const summary = buildSummary(counters, locale);

  return { summary, findings, counters };
}

function buildSummary(counters: AnalysisResult["counters"], locale: UiLocale): string {
  if (locale === "en") {
    const parts = [
      counters.jsErrors ? `${counters.jsErrors} JS errors` : "",
      counters.promiseErrors ? `${counters.promiseErrors} Promise rejections` : "",
      counters.consoleErrors ? `${counters.consoleErrors} console.error entries` : "",
      counters.failedRequests ? `${counters.failedRequests} failed requests` : "",
      counters.slowRequests ? `${counters.slowRequests} slow requests` : "",
      counters.resourceErrors ? `${counters.resourceErrors} resource load failures` : "",
      counters.styleChanges ? `${counters.styleChanges} page edits` : ""
    ].filter(Boolean);

    if (parts.length === 0) {
      return "No obvious issues were detected. Continue reproducing the problem or verify that the business state is expected.";
    }

    return `The current page has ${parts.join(", ")}.`;
  }

  const parts = [
    counters.jsErrors ? `${counters.jsErrors} 个 JS 错误` : "",
    counters.promiseErrors ? `${counters.promiseErrors} 个 Promise 异常` : "",
    counters.consoleErrors ? `${counters.consoleErrors} 条 console.error` : "",
    counters.failedRequests ? `${counters.failedRequests} 个失败请求` : "",
    counters.slowRequests ? `${counters.slowRequests} 个慢请求` : "",
    counters.resourceErrors ? `${counters.resourceErrors} 个资源加载失败` : "",
    counters.styleChanges ? `${counters.styleChanges} 处页面修改` : ""
  ].filter(Boolean);

  if (parts.length === 0) {
    return "当前诊断未发现明显错误。可以继续复现问题，或检查业务状态是否符合预期。";
  }

  return `当前页面检测到 ${parts.join("、")}。`;
}

function changeEvidence(change: DiagnosticSession["styleChanges"][number], locale: UiLocale): string {
  const styleKeys = Object.keys(change.after);
  const parts = [
    styleKeys.length > 0 ? `CSS ${styleKeys.join(", ")}` : "",
    change.textAfter !== undefined && change.textAfter !== (change.textBefore ?? "") ? (locale === "en" ? "text content" : "文字内容") : "",
    change.domAfter !== undefined && change.domAfter !== (change.domBefore ?? "") ? (change.domAction ?? (locale === "en" ? "element DOM" : "元素结构")) : ""
  ].filter(Boolean);
  return parts.join(" / ") || (locale === "en" ? "No specific fields recorded" : "未记录具体字段");
}

function buildNetworkFindings(events: DiagnosticEvent[], locale: UiLocale): AnalysisFinding[] {
  const en = locale === "en";
  const grouped = new Map<string, DiagnosticEvent[]>();
  for (const event of events) {
    const key = `${event.status ?? "ERR"} ${event.method ?? "GET"} ${event.url ?? event.source ?? "unknown"}`;
    grouped.set(key, [...(grouped.get(key) ?? []), event]);
  }

  return [...grouped.entries()].slice(0, 8).map(([key, group]) => {
    const sample = group[0];
    const status = sample.status;
    const suggestion = networkSuggestion(status, sample.message, locale);
    return {
      title: en ? `Request issue: ${key}` : `请求异常：${key}`,
      detail: group.length > 1 ? (en ? `The same request failed ${group.length} times.` : `同一请求出现 ${group.length} 次异常。`) : sample.message,
      severity: "error",
      evidence: group.slice(0, 3).map((event) => `${formatTime(event.timestamp, locale)} ${event.duration ?? "-"}ms ${event.message}`),
      suggestion
    };
  });
}

function buildJsFindings(events: DiagnosticEvent[], locale: UiLocale): AnalysisFinding[] {
  const en = locale === "en";
  const grouped = new Map<string, DiagnosticEvent[]>();
  for (const event of events) {
    const key = normalizeErrorMessage(event.message);
    grouped.set(key, [...(grouped.get(key) ?? []), event]);
  }

  return [...grouped.entries()].slice(0, 8).map(([message, group]) => ({
    title: en ? `Script error: ${message}` : `脚本错误：${message}`,
    detail: group.length > 1 ? (en ? `Similar script errors occurred ${group.length} times.` : `同类脚本错误出现 ${group.length} 次。`) : group[0].message,
    severity: "error",
    evidence: group.slice(0, 3).map((event) => event.stack || `${formatTime(event.timestamp, locale)} ${event.source ?? ""}`.trim()),
    suggestion: jsSuggestion(message, locale)
  }));
}

function buildResourceFindings(events: DiagnosticEvent[], locale: UiLocale): AnalysisFinding[] {
  if (events.length === 0) {
    return [];
  }

  return [
    {
      title: locale === "en" ? "Static resource load failures" : "静态资源加载失败",
      detail:
        locale === "en"
          ? `${events.length} images, scripts, styles, or fonts failed to load.`
          : `页面有 ${events.length} 个图片、脚本、样式或字体资源加载失败。`,
      severity: "warning",
      evidence: events.slice(0, 8).map((event) => event.url || event.message),
      suggestion:
        locale === "en"
          ? "Check resource URLs, CDN publish paths, cache versions, and CORS configuration. Provide fallbacks for image resources."
          : "检查资源 URL、CDN 发布路径、缓存版本和跨域配置。图片类资源建议提供 fallback。"
    }
  ];
}

function buildPerformanceFindings(events: DiagnosticEvent[], locale: UiLocale): AnalysisFinding[] {
  if (events.length === 0) {
    return [];
  }

  return [
    {
      title: locale === "en" ? "Slow requests detected" : "存在慢请求",
      detail: locale === "en" ? `${events.length} requests exceeded the slow request threshold.` : `检测到 ${events.length} 个请求耗时超过阈值。`,
      severity: "warning",
      evidence: events.slice(0, 8).map((event) => `${event.duration}ms ${event.method ?? "GET"} ${event.url ?? ""}`),
      suggestion:
        locale === "en"
          ? "Check API response time, database queries, cache hit rate, and whether the frontend is waiting for multiple APIs serially."
          : "优先检查接口响应时间、数据库查询、缓存命中率，以及前端是否串行等待了多个接口。"
    }
  ];
}

function networkSuggestion(status?: number, message = "", locale: UiLocale = "zh"): string {
  if (locale === "en") {
    if (status === 401) return "Check login state, token expiration, Cookie SameSite settings, or authentication middleware.";
    if (status === 403) return "Check account permissions, API authorization policy, CSRF validation, or gateway rules.";
    if (status === 404) return "Check API routes, static resource publish paths, frontend environment variables, and reverse proxy configuration.";
    if (status === 408 || status === 504) return "Check gateway timeouts, backend slow queries, upstream service availability, and retry policy.";
    if (status && status >= 500) return "Check backend service logs, exception stacks, databases, and dependent service health.";
    if (/cors/i.test(message)) return "This looks related to CORS. Check Access-Control-Allow-Origin, preflight requests, and credentials settings.";
    if (/mixed content/i.test(message)) return "The HTTPS page loaded HTTP resources. Switch them to HTTPS or remove unsafe resources.";
    return "Check the request URL, network state, browser console, and server logs.";
  }

  if (status === 401) return "优先检查登录态、Token 过期、Cookie SameSite 配置或鉴权中间件。";
  if (status === 403) return "优先检查当前账号权限、接口权限策略、CSRF 校验或网关规则。";
  if (status === 404) return "优先检查接口路由、静态资源发布路径、前端环境变量和反向代理配置。";
  if (status === 408 || status === 504) return "优先检查网关超时、后端慢查询、上游服务可用性和重试策略。";
  if (status && status >= 500) return "优先检查后端服务日志、异常堆栈、数据库或依赖服务状态。";
  if (/cors/i.test(message)) return "这是跨域相关错误，检查 Access-Control-Allow-Origin、预检请求和凭证配置。";
  if (/mixed content/i.test(message)) return "HTTPS 页面加载了 HTTP 资源，需改为 HTTPS 或移除不安全资源。";
  return "检查请求 URL、网络状态、浏览器控制台和服务端日志。";
}

function jsSuggestion(message: string, locale: UiLocale = "zh"): string {
  if (locale === "en") {
    if (/cannot read prop|cannot read properties|undefined|null/i.test(message)) {
      return "The frontend may be missing null guards. Check whether the API response shape changed and add optional chaining, defaults, or loading states.";
    }
    if (/chunkloaderror|loading chunk/i.test(message)) {
      return "Frontend asset versions may be inconsistent with cache. Check deploy versions, CDN cache, and the refresh strategy after chunk failures.";
    }
    if (/is not a function/i.test(message)) {
      return "This may be caused by exports, dependency versions, or unexpected runtime data types. Check where the called object comes from.";
    }
    if (/script error/i.test(message)) {
      return "The browser hid cross-origin script error details. Check script crossorigin, CORS response headers, and sourcemaps.";
    }
    return "Locate the component from the error stack, then add boundary state handling and exception protection.";
  }

  if (/cannot read prop|cannot read properties|undefined|null/i.test(message)) {
    return "前端可能缺少空值保护。检查接口返回结构是否变化，并在组件中使用可选链、默认值或加载态。";
  }
  if (/chunkloaderror|loading chunk/i.test(message)) {
    return "前端资源版本可能与缓存不一致。检查部署版本、CDN 缓存和 chunk 失败后的刷新策略。";
  }
  if (/is not a function/i.test(message)) {
    return "可能是模块导出、依赖版本或运行时数据类型不符合预期。检查调用对象来源。";
  }
  if (/script error/i.test(message)) {
    return "跨域脚本错误信息被浏览器隐藏。检查脚本 crossorigin、CORS 响应头和 sourcemap。";
  }
  return "根据错误堆栈定位触发组件，补充边界状态处理和异常保护。";
}

function normalizeErrorMessage(message: string): string {
  return message.replace(/\s+/g, " ").slice(0, 160);
}

function isFailedStatus(status?: number): boolean {
  return typeof status === "number" && status >= 400;
}

function formatTime(timestamp: number, locale: UiLocale): string {
  return new Date(timestamp).toLocaleTimeString(locale === "en" ? "en-US" : "zh-CN", { hour12: false });
}
