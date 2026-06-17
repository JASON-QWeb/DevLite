import { formatBytes } from "./utils";
import type { LiveDiagnosticEvent, PerformanceInsights, PerformanceIssue, UiLocale } from "./types";

type PerformanceText = {
  domReadyTime: string;
  pageLoadComplete: string;
  resourceSize: string;
  longTasks: string;
  over50ms: string;
};

type PerformanceContext = {
  locale: UiLocale;
  slowThreshold: number;
  pageContext: Record<string, unknown>;
  allEvents: LiveDiagnosticEvent[];
  networkEvents: LiveDiagnosticEvent[];
  text: PerformanceText;
  formatTime: (timestamp: number) => string;
  formatUrl: (value: string) => string;
};

export function getPerformanceInsights(context: PerformanceContext): PerformanceInsights {
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  const { locale, slowThreshold } = context;
  const largeResources = resources
    .filter((resource) => resource.transferSize >= 512 * 1024 || resource.encodedBodySize >= 512 * 1024)
    .sort((a, b) => Math.max(b.transferSize, b.encodedBodySize) - Math.max(a.transferSize, a.encodedBodySize));
  const slowResources = resources.filter((resource) => resource.duration >= Math.max(1200, slowThreshold)).sort((a, b) => b.duration - a.duration);
  const longTasks = context.allEvents
    .filter((event) => event.type === "performance" && event.metadata?.kind === "longtask")
    .sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0));
  const slowNetwork = context.networkEvents.filter((event) => typeof event.duration === "number" && event.duration >= slowThreshold);
  const resourceErrors = context.allEvents.filter((event) => event.type === "resource-error");
  const metrics = buildPerformanceMetrics(nav, resources, longTasks, context);
  const issues: PerformanceIssue[] = [];

  if (nav) {
    const ttfb = Math.round(nav.responseStart - nav.requestStart);
    const domReady = Math.round(nav.domContentLoadedEventEnd);
    const load = Math.round(nav.loadEventEnd || nav.duration);
    if (ttfb >= 600) {
      issues.push({
        title: locale === "en" ? "High TTFB" : "首包时间偏高",
        severity: ttfb >= 1200 ? "error" : "warning",
        detail: locale === "en" ? `TTFB is about ${ttfb}ms. The page may be slowed by server response or network latency.` : `TTFB 约 ${ttfb}ms，页面启动可能被服务端响应或网络链路拖慢。`,
        evidence: [`TTFB: ${ttfb}ms`, `${locale === "en" ? "Page" : "页面"}: ${location.href}`],
        suggestion:
          locale === "en"
            ? "Check the HTML document request, server rendering time, CDN cache hit rate, and gateway latency."
            : "检查 HTML 文档请求、服务端渲染耗时、CDN 缓存命中和接口网关延迟。"
      });
    }
    if (domReady >= 2500 || load >= 4500) {
      issues.push({
        title: locale === "en" ? "Slow page load phase" : "页面加载阶段偏慢",
        severity: load >= 8000 ? "error" : "warning",
        detail: locale === "en" ? `DOMContentLoaded ${domReady}ms, Load ${load}ms.` : `DOMContentLoaded ${domReady}ms，Load ${load}ms。`,
        evidence: [`DOMContentLoaded: ${domReady}ms`, `Load: ${load}ms`],
        suggestion:
          locale === "en"
            ? "Check first-screen scripts, render-blocking styles, font loading, and key API calls that may block rendering serially."
            : "检查首屏脚本、阻塞样式、字体加载和关键接口是否串行阻塞渲染。"
      });
    }
  }

  if (longTasks.length > 0) {
    const total = longTasks.reduce((sum, event) => sum + Number(event.duration ?? 0), 0);
    issues.push({
      title: locale === "en" ? "Main thread long tasks" : "主线程存在长任务",
      severity: longTasks.some((event) => Number(event.duration ?? 0) >= 200) ? "error" : "warning",
      detail: locale === "en" ? `${longTasks.length} long tasks, about ${Math.round(total)}ms total blocking.` : `${longTasks.length} 个长任务，总阻塞约 ${Math.round(total)}ms。`,
      evidence: longTasks.slice(0, 6).map((event) => `${event.duration ?? 0}ms @ ${context.formatTime(event.timestamp)}`),
      suggestion:
        locale === "en"
          ? "Split synchronous work, defer non-critical work, reduce large one-pass renders, and check list rendering or third-party scripts."
          : "拆分同步计算、推迟非首屏工作、减少大组件一次性渲染，并检查列表渲染和第三方脚本。"
    });
  }

  if (largeResources.length > 0) {
    issues.push({
      title: locale === "en" ? "Large resource loading" : "存在大资源加载",
      severity: largeResources.some((resource) => Math.max(resource.transferSize, resource.encodedBodySize) >= 2 * 1024 * 1024) ? "error" : "warning",
      detail: locale === "en" ? `${largeResources.length} resources exceed 512KB.` : `${largeResources.length} 个资源超过 512KB。`,
      evidence: largeResources.slice(0, 6).map((resource) => formatResourceTiming(resource, context.formatUrl)),
      suggestion:
        locale === "en"
          ? "Compress images and fonts, split JS/CSS, enable gzip/brotli, and keep non-critical large resources off the critical path."
          : "压缩图片和字体、拆分 JS/CSS、启用 gzip/brotli，并避免非首屏大资源抢占带宽。"
    });
  }

  if (slowResources.length > 0 || slowNetwork.length > 0) {
    issues.push({
      title: locale === "en" ? "Slow resources or requests" : "存在慢资源或慢请求",
      severity: "warning",
      detail: locale === "en" ? `${slowResources.length} slow resources and ${slowNetwork.length} slow API requests.` : `资源慢加载 ${slowResources.length} 个，接口慢请求 ${slowNetwork.length} 个。`,
      evidence: [...slowResources.slice(0, 4).map((resource) => formatResourceTiming(resource, context.formatUrl)), ...slowNetwork.slice(0, 4).map((event) => `${event.duration}ms ${event.method ?? "GET"} ${event.url ?? ""}`)],
      suggestion:
        locale === "en"
          ? "Check CDN behavior, cache policy, API response time, and whether the page serially waits for async work."
          : "检查 CDN、缓存策略、接口响应时间，以及页面是否串行等待多个异步任务。"
    });
  }

  if (resourceErrors.length > 0) {
    issues.push({
      title: locale === "en" ? "Resource load failures" : "资源加载失败",
      severity: "warning",
      detail: locale === "en" ? `${resourceErrors.length} images, scripts, styles, or fonts failed to load.` : `${resourceErrors.length} 个图片、脚本、样式或字体资源加载失败。`,
      evidence: resourceErrors.slice(0, 6).map((event) => event.url || event.message),
      suggestion:
        locale === "en"
          ? "Check resource paths, release versions, CORS policy, and CDN origin status."
          : "检查资源路径、发布版本、跨域策略和 CDN 回源状态。"
    });
  }

  return { metrics, issues, largeResources, slowResources, longTasks };
}

export function buildPerformancePrompt(context: PerformanceContext): string {
  const insights = getPerformanceInsights(context);
  return JSON.stringify(
    {
      task:
        context.locale === "en"
          ? "Use this DevLite performance diagnosis to locate and fix lag, slow loading, or large resource issues on the current page."
          : "请根据 DevLite 性能诊断结果定位并修复当前页面的卡顿、慢加载或大资源问题。",
      page: context.pageContext,
      metrics: insights.metrics,
      issues: insights.issues,
      largeResources: insights.largeResources.slice(0, 10).map(resourceToPromptItem),
      slowResources: insights.slowResources.slice(0, 10).map(resourceToPromptItem),
      longTasks: insights.longTasks.slice(0, 10).map((event) => ({
        duration: event.duration,
        timestamp: event.timestamp,
        metadata: event.metadata
      })),
      slowRequests: context.networkEvents
        .filter((event) => typeof event.duration === "number" && event.duration >= context.slowThreshold)
        .slice(0, 10)
        .map((event) => ({
          method: event.method,
          url: event.url,
          status: event.status,
          duration: event.duration,
          contentType: event.metadata?.contentType
        }))
    },
    null,
    2
  );
}

export function formatResourceTiming(resource: PerformanceResourceTiming, formatUrl: (value: string) => string): string {
  const url = formatUrl(resource.name);
  const size = formatBytes(Math.max(resource.transferSize, resource.encodedBodySize));
  return `${Math.round(resource.duration)}ms / ${size} / ${resource.initiatorType || "resource"} / ${url}`;
}

function buildPerformanceMetrics(nav: PerformanceNavigationTiming | undefined, resources: PerformanceResourceTiming[], longTasks: LiveDiagnosticEvent[], context: PerformanceContext): PerformanceInsights["metrics"] {
  const totalTransfer = resources.reduce((sum, resource) => sum + Math.max(0, resource.transferSize || resource.encodedBodySize || 0), 0);
  return [
    {
      label: "DOMContentLoaded",
      value: nav ? `${Math.round(nav.domContentLoadedEventEnd)}ms` : "-",
      note: context.text.domReadyTime
    },
    {
      label: "Load",
      value: nav ? `${Math.round(nav.loadEventEnd || nav.duration)}ms` : "-",
      note: context.text.pageLoadComplete
    },
    {
      label: context.text.resourceSize,
      value: formatBytes(totalTransfer),
      note: context.locale === "en" ? `${resources.length} resources` : `${resources.length} 个资源`
    },
    {
      label: context.text.longTasks,
      value: String(longTasks.length),
      note: context.text.over50ms
    }
  ];
}

function resourceToPromptItem(resource: PerformanceResourceTiming): Record<string, unknown> {
  return {
    url: resource.name,
    type: resource.initiatorType,
    duration: Math.round(resource.duration),
    transferSize: resource.transferSize,
    encodedBodySize: resource.encodedBodySize
  };
}
