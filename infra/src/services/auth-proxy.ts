// infra/src/services/auth-proxy.ts
import * as Docker from "../internal/docker";
import { Effect, Redacted } from "effect";
import { EndpointHandle, SecuredService, Entrypoint } from "../gateway/ingress";
import { KanidmHandle } from "../platform/kanidm";
import { getStackNetwork } from "../link";
import { SecretStore, Secret } from "../internal/secrets/SecretStore";

export interface PrivateServiceHandle {
  readonly name: string;
  readonly endpoint: EndpointHandle;
}

export interface WithOidcAuthOptions {
  readonly provider: KanidmHandle;
  readonly clientId: string;
  /** The public entrypoint assigned to this protected service. */
  readonly entrypoint: Entrypoint;
  readonly cookieSecret?: string | Redacted.Redacted<string>;
}

export const withOidcAuth =
  (opts: WithOidcAuthOptions) =>
  <S extends PrivateServiceHandle>(
    self: Effect.Effect<S, any, any>
  ): Effect.Effect<SecuredService, any, any> =>
    Effect.gen(function* () {
      const net = yield* getStackNetwork();
      const secrets = yield* SecretStore;
      const upstream = yield* self;
      const proxyName = `${upstream.name.toLowerCase()}-auth-proxy`;

      // Auto-register on Kanidm using entrypoint URLs:
      const oidcClient = yield* opts.provider.Client({
        id: opts.clientId,
        name: opts.clientId,
        origin: opts.entrypoint.origin,
        redirectUri: opts.entrypoint.callbackUrl(),
      });

      const cookieSecret = yield* Secret.fromNullable(
        opts.cookieSecret,
        secrets.get(`oauth2-proxy/${proxyName}`, "cookie_secret", {
          bytes: 32,
          encoding: "base64url",
        }),
      );

      yield* Docker.Container(proxyName, {
        image: "quay.io/oauth2-proxy/oauth2-proxy:v7.6.0",
        name: proxyName,
        networks: [{ name: net.name, aliases: [proxyName, proxyName.toLowerCase()] }],
        start: true,
        restart: "unless-stopped",
        environment: {
          OAUTH2_PROXY_HTTP_ADDRESS: "0.0.0.0:4180",
          OAUTH2_PROXY_REVERSE_PROXY: "true",
          OAUTH2_PROXY_UPSTREAMS: `http://${upstream.endpoint.host}:${upstream.endpoint.port}/`,
          OAUTH2_PROXY_PROVIDER: "oidc",
          OAUTH2_PROXY_SKIP_OIDC_DISCOVERY: "true",
          OAUTH2_PROXY_OIDC_ISSUER_URL: `${opts.provider.issuerUrl}/oauth2/openid/${opts.clientId}`,
          OAUTH2_PROXY_LOGIN_URL: `${opts.provider.issuerUrl}/ui/oauth2`,
          OAUTH2_PROXY_REDEEM_URL: `${opts.provider.internalUrl}/oauth2/token`,
          OAUTH2_PROXY_OIDC_JWKS_URL: `${opts.provider.internalUrl}/oauth2/openid/${opts.clientId}/public_key.jwk`,
          OAUTH2_PROXY_CLIENT_ID: opts.clientId,
          // Unwrapping to the raw Script `result` Output (rather than keeping it
          // inside `Redacted`, which Alchemy treats as an opaque leaf) surfaces the
          // provisioning dependency into `environment`, so the proxy is created only
          // after the Kanidm client-provision script resolves the secret.
          OAUTH2_PROXY_CLIENT_SECRET: Redacted.value(oidcClient.clientSecret),
          OAUTH2_PROXY_REDIRECT_URL: opts.entrypoint.callbackUrl(),
          OAUTH2_PROXY_SCOPE: "openid email profile",
          OAUTH2_PROXY_COOKIE_NAME: `_oauth2_proxy_${opts.clientId}`,
          OAUTH2_PROXY_COOKIE_SECRET: cookieSecret.redacted,
          OAUTH2_PROXY_COOKIE_SECURE: "false",
          OAUTH2_PROXY_COOKIE_SAMESITE: "lax",
          OAUTH2_PROXY_EMAIL_DOMAINS: "*",
          OAUTH2_PROXY_SKIP_PROVIDER_BUTTON: "true",
          OAUTH2_PROXY_SSL_INSECURE_SKIP_VERIFY: "true",
          OAUTH2_PROXY_OIDC_EMAIL_CLAIM: "preferred_username",
        },
      });

      return {
        _tag: "SecuredService",
        name: proxyName,
        endpoint: { host: proxyName, port: 4180 },
      } satisfies SecuredService;
    });
