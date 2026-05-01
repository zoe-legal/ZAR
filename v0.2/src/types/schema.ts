export type DenialStatusCode = 403 | 404;

export type ZarConfig = {
  version: number;
  policy: {
    denial_behavior: {
      unconfigured_route: DenialStatusCode;
      ring_denied: DenialStatusCode;
      entitlement_denied: DenialStatusCode;
      unavailable_denied: DenialStatusCode;
    };
  };
  routes: RouteDefinition[];
};

export type RouteDefinition = {
  path: string;
  methods: Record<string, MethodDefinition>;
};

export type MethodDefinition = {
  rings: Record<string, RingRouteDefinition>;
};

export type RingRouteDefinition = {
  backend: {
    url: string;
    path: string;
  };
  require_available: boolean;
  entitlements: {
    all_of: string[];
    any_of: string[];
  };
};

export type RouteMatch = {
  route: RouteDefinition;
  method: string;
  methodDefinition: MethodDefinition;
  ringKey: string;
  ringDefinition: RingRouteDefinition;
  params: Record<string, string>;
};

