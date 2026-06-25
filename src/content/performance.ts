import { formatBytes } from "./utils";
import { getMemoryInfo, type MemoryInfo } from "./performanceMemory";
import type { LiveDiagnosticEvent, PerformanceInsights, PerformanceIssue, UiLocale } from "./types";
import type { PageContext } from "../shared/types";

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
  thresholds: PerformanceThresholds;
  revision: number;
  pageContext: PageContext;
  allEvents: LiveDiagnosticEvent[];
  networkEvents: LiveDiagnosticEvent[];
  text: PerformanceText;
  formatTime: (timestamp: number) => string;
  formatUrl: (value: string) => string;
};

type PerformanceThresholds = {
  ttfbWarning: number;
  ttfbError: number;
  domReadyWarning: number;
  loadWarning: number;
  loadError: number;
  resourceSizeWarning: number;
};

type WebVitals = {
  lcp?: number;
  cls?: number;
  inp?: number;
  fid?: number;
  fps?: number;
};

export function getPerformanceInsights(context: PerformanceContext): PerformanceInsights {
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  const { locale, slowThreshold } = context;
  const thresholds = context.thresholds;
  const webVitals = collectWebVitals(context.allEvents);
  const largeResources = resources
    .filter((resource) => resource.transferSize >= thresholds.resourceSizeWarning || resource.encodedBodySize >= thresholds.resourceSizeWarning)
    .sort((a, b) => Math.max(b.transferSize, b.encodedBodySize) - Math.max(a.transferSize, a.encodedBodySize));
  const slowResources = resources.filter((resource) => resource.duration >= Math.max(1200, slowThreshold)).sort((a, b) => b.duration - a.duration);
  const longTasks = context.allEvents
    .filter((event) => event.type === "performance" && event.metadata?.kind === "longtask")
    .sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0));
  const slowNetwork = context.networkEvents.filter((event) => typeof event.duration === "number" && event.duration >= slowThreshold);
  const resourceErrors = context.allEvents.filter((event) => event.type === "resource-error");
  const metrics = buildPerformanceMetrics(nav, resources, longTasks, webVitals, context);
  const issues: PerformanceIssue[] = [];
  const memory = getMemoryInfo();

  if (nav) {
    const ttfb = Math.round(nav.responseStart - nav.requestStart);
    const domReady = Math.round(nav.domContentLoadedEventEnd);
    const load = Math.round(nav.loadEventEnd || nav.duration);
    if (ttfb >= thresholds.ttfbWarning) {
      issues.push({
        title: locale === "en" ? "High TTFB" : "首包时间偏高",
        severity: ttfb >= thresholds.ttfbError ? "error" : "warning",
        detail: locale === "en" ? `TTFB is about ${ttfb}ms. The page may be slowed by server response or network latency.` : `TTFB 约 ${ttfb}ms，页面启动可能被服务端响应或网络链路拖慢。`,
        evidence: [`TTFB: ${ttfb}ms`, `${locale === "en" ? "Page" : "页面"}: ${location.href}`],
        suggestion:
          locale === "en"
            ? "Check the HTML document request, server rendering time, CDN cache hit rate, and gateway latency."
            : "检查 HTML 文档请求、服务端渲染耗时、CDN 缓存命中和接口网关延迟。"
      });
    }
    if (domReady >= thresholds.domReadyWarning || load >= thresholds.loadWarning) {
      issues.push({
        title: locale === "en" ? "Slow page load phase" : "页面加载阶段偏慢",
        severity: load >= thresholds.loadError ? "error" : "warning",
        detail: locale === "en" ? `DOMContentLoaded ${domReady}ms, Load ${load}ms.` : `DOMContentLoaded ${domReady}ms，Load ${load}ms。`,
        evidence: [`DOMContentLoaded: ${domReady}ms`, `Load: ${load}ms`],
        suggestion:
          locale === "en"
            ? "Check first-screen scripts, render-blocking styles, font loading, and key API calls that may block rendering serially."
            : "检查首屏脚本、阻塞样式、字体加载和关键接口是否串行阻塞渲染。"
      });
    }
  }

  pushWebVitalIssues(webVitals, issues, context);
  pushRuntimePerformanceIssues(webVitals, memory, issues, context);

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
      severity: largeResources.some((resource) => Math.max(resource.transferSize, resource.encodedBodySize) >= thresholds.resourceSizeWarning * 4) ? "error" : "warning",
      detail:
        locale === "en"
          ? `${largeResources.length} resources exceed ${formatBytes(thresholds.resourceSizeWarning)}.`
          : `${largeResources.length} 个资源超过 ${formatBytes(thresholds.resourceSizeWarning)}。`,
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
          ? "Use this performance diagnosis to locate and fix lag, slow loading, or large resource issues on the current page URL in the current project."
          : "请根据以下性能诊断结果，定位并修复当前项目中当前页面 URL 对应页面的卡顿、慢加载或大资源问题。",
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

function buildPerformanceMetrics(
  nav: PerformanceNavigationTiming | undefined,
  resources: PerformanceResourceTiming[],
  longTasks: LiveDiagnosticEvent[],
  webVitals: WebVitals,
  context: PerformanceContext
): PerformanceInsights["metrics"] {
  const totalTransfer = resources.reduce((sum, resource) => sum + Math.max(0, resource.transferSize || resource.encodedBodySize || 0), 0);
  const memory = getMemoryInfo();
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
    },
    {
      label: "LCP",
      value: typeof webVitals.lcp === "number" ? `${Math.round(webVitals.lcp)}ms` : "-",
      note: context.locale === "en" ? "Largest Contentful Paint" : "最大内容绘制"
    },
    {
      label: "CLS",
      value: typeof webVitals.cls === "number" ? webVitals.cls.toFixed(3) : "-",
      note: context.locale === "en" ? "Cumulative Layout Shift" : "累计布局偏移"
    },
    {
      label: "INP",
      value: typeof webVitals.inp === "number" ? `${Math.round(webVitals.inp)}ms` : "-",
      note: context.locale === "en" ? "Interaction latency" : "交互延迟"
    },
    {
      label: "FID",
      value: typeof webVitals.fid === "number" ? `${Math.round(webVitals.fid)}ms` : "-",
      note: context.locale === "en" ? "First input delay" : "首次输入延迟"
    },
    {
      label: "FPS",
      value: typeof webVitals.fps === "number" ? String(webVitals.fps) : "-",
      note: context.locale === "en" ? "Recent frame rate" : "近期帧率"
    },
    {
      label: "JS Heap",
      value: memory ? formatBytes(memory.usedJSHeapSize) : "-",
      note: memory ? `${Math.round((memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100)}%` : context.locale === "en" ? "Chrome only" : "仅 Chrome 支持"
    }
  ];
}

function collectWebVitals(events: LiveDiagnosticEvent[]): WebVitals {
  const vitals: WebVitals = {};
  for (const event of events) {
    if (event.type !== "performance") continue;
    const kind = event.metadata?.kind;
    const value = Number(event.metadata?.value ?? event.duration);
    if (!Number.isFinite(value)) continue;
    if (kind === "lcp") vitals.lcp = Math.max(vitals.lcp ?? 0, value);
    if (kind === "cls") vitals.cls = Math.max(vitals.cls ?? 0, value);
    if (kind === "inp") vitals.inp = Math.max(vitals.inp ?? 0, value);
    if (kind === "fid") vitals.fid = Math.max(vitals.fid ?? 0, value);
    if (kind === "fps") vitals.fps = value;
  }
  return vitals;
}

function pushWebVitalIssues(webVitals: WebVitals, issues: PerformanceIssue[], context: PerformanceContext): void {
  const { locale } = context;
  if (typeof webVitals.lcp === "number" && webVitals.lcp >= 2500) {
    issues.push({
      title: locale === "en" ? "LCP needs attention" : "LCP 需要关注",
      severity: webVitals.lcp >= 4000 ? "error" : "warning",
      detail: locale === "en" ? `LCP is about ${Math.round(webVitals.lcp)}ms.` : `LCP 约 ${Math.round(webVitals.lcp)}ms。`,
      evidence: [`LCP: ${Math.round(webVitals.lcp)}ms`],
      suggestion:
        locale === "en"
          ? "Optimize the largest above-the-fold image or text block, reduce render-blocking work, and improve document or API response time."
          : "优化首屏最大图片或文本块，减少阻塞渲染的资源，并检查文档或关键接口响应时间。"
    });
  }
  if (typeof webVitals.cls === "number" && webVitals.cls >= 0.1) {
    issues.push({
      title: locale === "en" ? "Layout shifts detected" : "存在布局偏移",
      severity: webVitals.cls >= 0.25 ? "error" : "warning",
      detail: locale === "en" ? `CLS is ${webVitals.cls.toFixed(3)}.` : `CLS 为 ${webVitals.cls.toFixed(3)}。`,
      evidence: [`CLS: ${webVitals.cls.toFixed(3)}`],
      suggestion:
        locale === "en"
          ? "Reserve image, ad, iframe, and async content dimensions, and avoid inserting content above existing viewport content."
          : "为图片、广告、iframe 和异步内容预留尺寸，避免在现有视口内容上方插入新内容。"
    });
  }
  if (typeof webVitals.inp === "number" && webVitals.inp >= 200) {
    issues.push({
      title: locale === "en" ? "Slow interaction response" : "交互响应偏慢",
      severity: webVitals.inp >= 500 ? "error" : "warning",
      detail: locale === "en" ? `INP is about ${Math.round(webVitals.inp)}ms.` : `INP 约 ${Math.round(webVitals.inp)}ms。`,
      evidence: [`INP: ${Math.round(webVitals.inp)}ms`],
      suggestion:
        locale === "en"
          ? "Split input handlers, defer non-critical synchronous work, and check large renders triggered by user actions."
          : "拆分输入处理逻辑、推迟非关键同步任务，并检查用户操作触发的大组件渲染。"
    });
  }
}

function pushRuntimePerformanceIssues(webVitals: WebVitals, memory: MemoryInfo | null, issues: PerformanceIssue[], context: PerformanceContext): void {
  const { locale } = context;
  if (typeof webVitals.fps === "number" && webVitals.fps < 40) {
    issues.push({
      title: locale === "en" ? "Low frame rate" : "帧率偏低",
      severity: webVitals.fps < 30 ? "error" : "warning",
      detail: locale === "en" ? `Recent FPS is ${webVitals.fps}.` : `近期 FPS 为 ${webVitals.fps}。`,
      evidence: [`FPS: ${webVitals.fps}`],
      suggestion:
        locale === "en"
          ? "Check animation, scroll, and input handlers for long synchronous work and reduce layout or paint pressure."
          : "检查动画、滚动和输入处理中的长同步任务，降低布局和绘制压力。"
    });
  }
  if (memory && memory.jsHeapSizeLimit > 0 && memory.usedJSHeapSize / memory.jsHeapSizeLimit >= 0.8) {
    issues.push({
      title: locale === "en" ? "High JS heap usage" : "JS 堆内存使用偏高",
      severity: "warning",
      detail:
        locale === "en"
          ? `JS heap uses ${formatBytes(memory.usedJSHeapSize)} of ${formatBytes(memory.jsHeapSizeLimit)}.`
          : `JS 堆内存使用 ${formatBytes(memory.usedJSHeapSize)} / ${formatBytes(memory.jsHeapSizeLimit)}。`,
      evidence: [`JS Heap: ${formatBytes(memory.usedJSHeapSize)} / ${formatBytes(memory.jsHeapSizeLimit)}`],
      suggestion:
        locale === "en"
          ? "Check retained component trees, large caches, repeated subscriptions, and detached DOM nodes."
          : "检查未释放的组件树、大缓存、重复订阅和游离 DOM 节点。"
    });
  }
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
