import { truncateText } from "./utils";
import { composedParent, elementText, isElement, isInspectableElement, rootOf, shadowRootOf, type DomRoot, type InspectableElement } from "./domContext";
import { localSelector } from "./elementAddress";
import type { ElementAncestor, ElementLocator, MatchedCssRule } from "./types";

export function resolveInspectableTarget(target: EventTarget | null): InspectableElement | null {
  return isInspectableElement(target) ? target : null;
}

export const buildSelector = localSelector;

export function buildDomPath(element: InspectableElement): string {
  const parts: string[] = [];
  let node: Element | null = element;
  while (node && node !== document.documentElement && parts.length < 8) {
    parts.unshift(`${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ""}`);
    node = composedParent(node);
  }
  return parts.join(" > ");
}

export function buildElementLocator(element: InspectableElement, selector: string, domPath: string): ElementLocator {
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

export function labelElement(element: InspectableElement): string {
  const className = Array.from(element.classList).slice(0, 2).join(".");
  return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${className ? `.${className}` : ""}`;
}

export function textSnippet(element: InspectableElement): string {
  return elementText(element).replace(/\s+/g, " ").trim().slice(0, 140);
}

function collectLocatorAttributes(element: InspectableElement): Record<string, string> {
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

function buildOpeningTag(element: InspectableElement): string {
  const attrs = Array.from(element.attributes)
    .filter((attr) => attr.name !== "style")
    .slice(0, 16)
    .map((attr) => `${attr.name}="${truncateText(attr.value, 180)}"`)
    .join(" ");
  return `<${element.tagName.toLowerCase()}${attrs ? ` ${attrs}` : ""}>`;
}

function buildParentChain(element: InspectableElement): ElementAncestor[] {
  const chain: ElementAncestor[] = [];
  let node = composedParent(element);
  while (node && node !== document.documentElement && chain.length < 6) {
    chain.push({
      tagName: node.tagName.toLowerCase(),
      id: node.id || "",
      classList: Array.from(node.classList),
      selector: compactElementSelector(node)
    });
    node = composedParent(node);
  }
  return chain;
}

function compactElementSelector(element: Element): string {
  const classList = Array.from(element.classList).slice(0, 4);
  return `${element.tagName.toLowerCase()}${element.id ? `#${CSS.escape(element.id)}` : ""}${classList.length ? `.${classList.map((name) => CSS.escape(name)).join(".")}` : ""}`;
}

function collectMatchedCssRules(element: InspectableElement): MatchedCssRule[] {
  const matches: MatchedCssRule[] = [];
  const ancestors: InspectableElement[] = [];
  for (let node = composedParent(element); node && ancestors.length < 6; node = composedParent(node)) if (isInspectableElement(node)) ancestors.push(node);
  const inheritedProperty = /^(--|color$|font|line-height$|letter-spacing$|word-spacing$|text-align$|text-transform$|white-space$|visibility$|cursor$|direction$)/;
  let scopes: Set<DomRoot>;
  let visitedRules = 0;
  const visitRules = (rules: CSSRuleList, source: string, condition?: string) => {
    for (const rule of Array.from(rules)) {
      if (matches.length >= 16) return;
      if (visitedRules >= 2500) return;
      visitedRules += 1;
      if (rule.type === 1 && "selectorText" in rule) {
        const styleRule = rule as CSSStyleRule;
        const direct = scopes.has(rootOf(element)) && safeMatches(element, styleRule.selectorText);
        const context = contextualMatches(element, styleRule.selectorText);
        const inherited = ancestors.find((ancestor) => scopes.has(rootOf(ancestor)) && safeMatches(ancestor, styleRule.selectorText));
        const inheritedStyle = inherited ? Array.from(styleRule.style).filter((name) => inheritedProperty.test(name)).map((name) => `${name}: ${styleRule.style.getPropertyValue(name)}${styleRule.style.getPropertyPriority(name) ? ' !important' : ''};`).join(" ") : "";
        if (direct || context || inheritedStyle) {
          matches.push({
            selectorText: styleRule.selectorText,
            style: truncateText(direct || context ? styleRule.style.cssText : inheritedStyle, 520),
            source,
            condition,
            match: direct ? "candidate" : "context",
            inheritedFrom: !direct && !context && inherited ? compactElementSelector(inherited) : undefined
          });
        }
        continue;
      }
      if ("cssRules" in rule) {
        const nested = rule as CSSMediaRule | CSSSupportsRule;
        const header = rule.cssText.split("{")[0].trim();
        const nextCondition = [condition, header].filter(Boolean).join(" / ");
        try { visitRules(nested.cssRules, source, nextCondition); } catch { /* Inaccessible imported rules. */ }
      }
    }
  };

  const root = rootOf(element);
  const sheets = new Map<CSSStyleSheet, Set<DomRoot>>();
  const include = (scope: DomRoot) => {
    for (const sheet of [...Array.from(scope.styleSheets), ...Array.from(scope.adoptedStyleSheets ?? [])]) {
      const roots = sheets.get(sheet) ?? new Set<DomRoot>(); roots.add(scope); sheets.set(sheet, roots);
    }
  };
  include(root);
  // Include rules on a host and assigned slot as contextual candidates, without treating them as winning declarations.
  const ownShadow = shadowRootOf(element);
  if (ownShadow) include(ownShadow);
  if (element.assignedSlot) {
    const slotRoot = rootOf(element.assignedSlot);
    include(slotRoot);
  }
  for (const ancestor of ancestors) include(rootOf(ancestor));
  for (const [sheet, sheetScopes] of sheets) {
    scopes = sheetScopes;
    if (matches.length >= 16) break;
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      matches.push({ selectorText: "", style: "", source: stylesheetSource(sheet), match: "context", accessible: false });
      continue;
    }
    visitRules(rules, stylesheetSource(sheet));
  }
  return matches;
}

function safeMatches(element: InspectableElement, selectorText: string): boolean {
  try {
    return element.matches(selectorText);
  } catch {
    return false;
  }
}

function stylesheetSource(sheet: CSSStyleSheet): string {
  if (sheet.href) return sheet.href;
  const owner = isElement(sheet.ownerNode) ? sheet.ownerNode : null;
  if (!owner) return "inline stylesheet";
  const id = owner.id ? `#${owner.id}` : "";
  const dataAttrs = Array.from(owner.attributes)
    .filter((attr) => attr.name.startsWith("data-"))
    .slice(0, 2)
    .map((attr) => `[${attr.name}="${truncateText(attr.value, 80)}"]`)
    .join("");
  return `${owner.tagName.toLowerCase()}${id}${dataAttrs}`;
}

function contextualMatches(element: Element, selector: string): boolean {
  if (selector.includes(":host") && shadowRootOf(element)) return true;
  if (selector.includes("::slotted(") && element.assignedSlot) return true;
  if (selector.includes("::part(") && element.hasAttribute("part")) return true;
  return false;
}
