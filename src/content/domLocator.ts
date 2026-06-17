import { cssAttrEscape, truncateText } from "./utils";
import type { ElementAncestor, ElementLocator, MatchedCssRule } from "./types";

export function resolveInspectableTarget(target: EventTarget | null): HTMLElement | null {
  if (target instanceof HTMLElement) return target;
  if (target instanceof SVGElement) {
    const svg = target.closest("svg");
    if (svg?.parentElement instanceof HTMLElement) return svg.parentElement;
  }
  return null;
}

export function buildSelector(element: HTMLElement): string {
  if (element.id && /^[A-Za-z][\w-]*$/.test(element.id)) {
    return `#${CSS.escape(element.id)}`;
  }

  const dataSelector = ["data-testid", "data-test", "data-cy", "name", "aria-label"]
    .map((attr) => {
      const value = element.getAttribute(attr);
      return value ? `[${attr}="${cssAttrEscape(value)}"]` : "";
    })
    .find(Boolean);
  if (dataSelector) return `${element.tagName.toLowerCase()}${dataSelector}`;

  const parts: string[] = [];
  let node: HTMLElement | null = element;
  while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.body && parts.length < 5) {
    let part = node.tagName.toLowerCase();
    const classNames = Array.from(node.classList)
      .filter((name) => !/^(hover|focus|active|selected|open|ng-|v-|css-|__[a-z0-9])/i.test(name))
      .slice(0, 2);
    if (classNames.length > 0) {
      part += `.${classNames.map((name) => CSS.escape(name)).join(".")}`;
    } else {
      const index = nthOfType(node);
      if (index > 1) {
        part += `:nth-of-type(${index})`;
      }
    }
    parts.unshift(part);
    node = node.parentElement;
  }
  return parts.join(" > ");
}

export function buildDomPath(element: HTMLElement): string {
  const parts: string[] = [];
  let node: HTMLElement | null = element;
  while (node && node !== document.documentElement && parts.length < 8) {
    parts.unshift(`${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ""}`);
    node = node.parentElement;
  }
  return parts.join(" > ");
}

export function buildElementLocator(element: HTMLElement, selector: string, domPath: string): ElementLocator {
  return {
    tagName: element.tagName.toLowerCase(),
    id: element.id || "",
    classList: Array.from(element.classList),
    attributes: collectLocatorAttributes(element),
    openingTag: buildOpeningTag(element),
    outerHTMLSnippet: truncateText(element.outerHTML.replace(/\s+/g, " "), 900),
    selector,
    domPath,
    parentChain: buildParentChain(element),
    matchedCssRules: collectMatchedCssRules(element)
  };
}

export function labelElement(element: HTMLElement): string {
  const className = Array.from(element.classList).slice(0, 2).join(".");
  return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${className ? `.${className}` : ""}`;
}

export function textSnippet(element: HTMLElement): string {
  return (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 140);
}

function collectLocatorAttributes(element: HTMLElement): Record<string, string> {
  const priority = new Set([
    "id",
    "class",
    "role",
    "aria-label",
    "aria-labelledby",
    "aria-describedby",
    "data-testid",
    "data-test",
    "data-cy",
    "name",
    "type",
    "href",
    "src",
    "alt",
    "title",
    "placeholder"
  ]);
  const attributes: Record<string, string> = {};
  for (const attr of Array.from(element.attributes)) {
    if (!priority.has(attr.name) && !attr.name.startsWith("data-")) continue;
    attributes[attr.name] = truncateText(attr.value, 220);
    if (Object.keys(attributes).length >= 24) break;
  }
  return attributes;
}

function buildOpeningTag(element: HTMLElement): string {
  const attrs = Array.from(element.attributes)
    .filter((attr) => attr.name !== "style")
    .slice(0, 16)
    .map((attr) => `${attr.name}="${truncateText(attr.value, 180)}"`)
    .join(" ");
  return `<${element.tagName.toLowerCase()}${attrs ? ` ${attrs}` : ""}>`;
}

function buildParentChain(element: HTMLElement): ElementAncestor[] {
  const chain: ElementAncestor[] = [];
  let node = element.parentElement;
  while (node && node !== document.documentElement && chain.length < 6) {
    chain.push({
      tagName: node.tagName.toLowerCase(),
      id: node.id || "",
      classList: Array.from(node.classList),
      selector: compactElementSelector(node)
    });
    node = node.parentElement;
  }
  return chain;
}

function compactElementSelector(element: HTMLElement): string {
  const classList = Array.from(element.classList).slice(0, 4);
  return `${element.tagName.toLowerCase()}${element.id ? `#${CSS.escape(element.id)}` : ""}${classList.length ? `.${classList.map((name) => CSS.escape(name)).join(".")}` : ""}`;
}

function collectMatchedCssRules(element: HTMLElement): MatchedCssRule[] {
  const matches: MatchedCssRule[] = [];
  const visitRules = (rules: CSSRuleList, source: string, condition?: string) => {
    for (const rule of Array.from(rules)) {
      if (matches.length >= 16) return;
      if (rule instanceof CSSStyleRule) {
        if (safeMatches(element, rule.selectorText)) {
          matches.push({
            selectorText: rule.selectorText,
            style: truncateText(rule.style.cssText, 520),
            source,
            condition
          });
        }
        continue;
      }
      if ("cssRules" in rule) {
        const nested = rule as CSSMediaRule | CSSSupportsRule;
        const nextCondition = "conditionText" in nested ? nested.conditionText : condition;
        visitRules(nested.cssRules, source, nextCondition || condition);
      }
    }
  };

  for (const sheet of Array.from(document.styleSheets)) {
    if (matches.length >= 16) break;
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    visitRules(rules, stylesheetSource(sheet));
  }
  return matches;
}

function safeMatches(element: HTMLElement, selectorText: string): boolean {
  try {
    return element.matches(selectorText);
  } catch {
    return false;
  }
}

function stylesheetSource(sheet: CSSStyleSheet): string {
  if (sheet.href) return sheet.href;
  const owner = sheet.ownerNode instanceof Element ? sheet.ownerNode : null;
  if (!owner) return "inline stylesheet";
  const id = owner.id ? `#${owner.id}` : "";
  const dataAttrs = Array.from(owner.attributes)
    .filter((attr) => attr.name.startsWith("data-"))
    .slice(0, 2)
    .map((attr) => `[${attr.name}="${truncateText(attr.value, 80)}"]`)
    .join("");
  return `${owner.tagName.toLowerCase()}${id}${dataAttrs}`;
}

function nthOfType(element: HTMLElement): number {
  let index = 1;
  let sibling = element.previousElementSibling;
  while (sibling) {
    if (sibling.tagName === element.tagName) index += 1;
    sibling = sibling.previousElementSibling;
  }
  return index;
}
