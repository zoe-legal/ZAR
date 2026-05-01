import type { RouteDefinition, RouteMatch, ZarConfig } from "../types/schema.js";

type CompiledRoute = {
  route: RouteDefinition;
  method: string;
  regex: RegExp;
  paramNames: string[];
  specificity: number;
};

export function compileRoutes(config: ZarConfig): CompiledRoute[] {
  const compiled: CompiledRoute[] = [];
  for (const route of config.routes) {
    for (const method of Object.keys(route.methods)) {
      const { regex, paramNames, specificity } = compileTemplate(route.path);
      compiled.push({
        route,
        method: method.toUpperCase(),
        regex,
        paramNames,
        specificity,
      });
    }
  }
  return compiled.sort((a, b) => b.specificity - a.specificity);
}

export function matchRoute(compiledRoutes: CompiledRoute[], method: string, path: string, ringId: number | null): RouteMatch | null {
  const upperMethod = method.toUpperCase();
  for (const compiled of compiledRoutes) {
    if (compiled.method !== upperMethod) continue;
    const match = compiled.regex.exec(path);
    if (!match) continue;
    const params: Record<string, string> = {};
    compiled.paramNames.forEach((name, index) => {
      params[name] = decodeURIComponent(match[index + 1] ?? "");
    });
    const methodDefinition = compiled.route.methods[compiled.method] ?? compiled.route.methods[upperMethod];
    const ringKey = ringId !== null && methodDefinition.rings[String(ringId)] ? String(ringId) : "default";
    const ringDefinition = methodDefinition.rings[ringKey];
    if (!ringDefinition) {
      return null;
    }
    return {
      route: compiled.route,
      method: upperMethod,
      methodDefinition,
      ringKey,
      ringDefinition,
      params,
    };
  }
  return null;
}

function compileTemplate(template: string): { regex: RegExp; paramNames: string[]; specificity: number } {
  const segments = template.split("/").filter(Boolean);
  const paramNames: string[] = [];
  let specificity = 0;
  const pattern = segments.map((segment) => {
    if (segment.startsWith("{") && segment.endsWith("}")) {
      const name = segment.slice(1, -1);
      paramNames.push(name);
      return "([^/]+)";
    }
    specificity += 10;
    return escapeRegex(segment);
  }).join("/");
  specificity += segments.length;
  return {
    regex: new RegExp(`^/${pattern}$`),
    paramNames,
    specificity,
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
