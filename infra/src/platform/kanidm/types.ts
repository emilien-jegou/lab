// Public types and handles exposed by the Kanidm identity provider.
import type { Effect, Redacted } from "effect";

import type { EndpointHandle, PublicEndpoint, Entrypoint } from "../../gateway/ingress";

export interface KanidmProps {
  /** The public gateway entrypoint assigned to the IAM portal. */
  readonly entrypoint: Entrypoint;
  readonly dataDir?: string;
  readonly developerPassword?: string | Redacted.Redacted<string>;
}

export interface KanidmClientProps {
  readonly id: string;
  readonly name: string;
  readonly origin: string;
  readonly redirectUri: string;
}

export interface KanidmClientHandle {
  readonly clientId: string;
  readonly clientSecret: Redacted.Redacted<any>;
  readonly issuerUrl: string;
  readonly internalUrl: string;
  readonly provisionHash?: any;
}

export interface KanidmHandle {
  readonly _tag: "OidcProvider";
  readonly domain: string;
  readonly issuerUrl: string;
  readonly internalUrl: string;
  readonly endpoint: EndpointHandle;
  readonly PublicEndpoint: PublicEndpoint<KanidmHandle>;
  readonly idmAdminPassword: Redacted.Redacted<any>;
  readonly Client: (props: KanidmClientProps) => Effect.Effect<KanidmClientHandle, any, any>;
}
