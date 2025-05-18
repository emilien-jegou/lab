// infra/src/gateway/ingress.ts

export const PublicEndpointBrand: unique symbol = Symbol.for("alchemy.ingress.public");

export interface EndpointHandle {
  readonly host: string;
  readonly port: number;
  readonly protocol?: "http" | "https";
}

export interface PublicEndpoint<T = unknown> {
  readonly [PublicEndpointBrand]: true;
  readonly ref: T;
  readonly endpoint: EndpointHandle;
}

export function makePublicEndpoint<T>(ref: T, endpoint: EndpointHandle): PublicEndpoint<T> {
  return {
    [PublicEndpointBrand]: true,
    ref,
    endpoint,
  };
}

export interface SecuredService {
  readonly _tag: "SecuredService";
  readonly name: string;
  readonly endpoint: EndpointHandle;
}

export type GatewayTarget = SecuredService | PublicEndpoint<unknown>;

export interface GatewayRoute {
  readonly host: string;
  readonly target: GatewayTarget;
}

export interface GatewayConfig {
  readonly domain?: string;
  readonly port?: number;
  readonly protocol?: "http" | "https";
}

/**
 * A typed public gateway entrypoint for a specific service.
 */
export interface Entrypoint {
  readonly name: string;
  readonly host: string;
  readonly origin: string;
  readonly protocol: "http" | "https";
  readonly port: number;
  /** Generates a fully qualified public URL for this entrypoint. */
  readonly url: (path?: string) => string;
  /** Generates an OAuth2/OIDC redirect callback URL. */
  readonly callbackUrl: (path?: string) => string;
  /** Binds this entrypoint to a target service for Pingora registration. */
  readonly toRoute: (target: GatewayTarget) => GatewayRoute;
}

export interface IngressGateway {
  readonly domain: string;
  readonly port: number;
  readonly protocol: "http" | "https";
  readonly origin: string;
  readonly entrypoint: (name: string) => Entrypoint;
}

export const Ingress = {
  /**
   * Defines the gateway domain and port as the single source of truth.
   */
  Gateway: (config: GatewayConfig = {}): IngressGateway => {
    const domain = config.domain ?? "localhost";
    const port = config.port ?? 8000;
    const protocol = config.protocol ?? "http";
    const portSuffix =
      (protocol === "http" && port === 80) || (protocol === "https" && port === 443)
        ? ""
        : `:${port}`;
    const origin = `${protocol}://${domain}${portSuffix}`;

    const entrypoint = (subdomain: string): Entrypoint => {
      const host = `${subdomain}.${domain}`;
      const epOrigin = `${protocol}://${host}${portSuffix}`;

      const url = (p: string = "") => {
        const cleanPath = p ? (p.startsWith("/") ? p : `/${p}`) : "";
        return `${epOrigin}${cleanPath}`;
      };

      const callbackUrl = (p: string = "/oauth2/callback") => url(p);

      return {
        name: subdomain,
        host,
        origin: epOrigin,
        protocol,
        port,
        url,
        callbackUrl,
        toRoute: (target: GatewayTarget): GatewayRoute => ({
          host,
          target,
        }),
      };
    };

    return {
      domain,
      port,
      protocol,
      origin,
      entrypoint,
    };
  },
};
