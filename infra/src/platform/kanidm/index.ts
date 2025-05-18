// Kanidm identity provider: server container, TLS, account bootstrap, OIDC clients.
import * as Docker from "../../internal/docker";
import { Effect, Redacted } from "effect";
import * as path from "node:path";
import { makePublicEndpoint, type EndpointHandle } from "../../gateway/ingress";
import { resolveServiceDataPath } from "../../paths";
import { getStackNetwork } from "../../link";
import { SecretStore, Secret } from "../../internal/secrets/SecretStore";

import { bootstrapAccounts } from "./bootstrap";
import { provisionCerts } from "./certs";
import { provisionClient } from "./client";
import { renderServerToml } from "./server-config";
import type {
  KanidmClientHandle,
  KanidmClientProps,
  KanidmHandle,
  KanidmProps,
} from "./types";

export * from "./types";

export const Kanidm = (name: string, props: KanidmProps) =>
  Effect.gen(function* () {
    const net = yield* getStackNetwork();
    const secrets = yield* SecretStore;
    const certsDir = yield* resolveServiceDataPath(name, props.dataDir, "certs");
    const confDir = yield* resolveServiceDataPath(name, props.dataDir, "conf");

    const domain = props.entrypoint.host;
    const origin = props.entrypoint.origin;

    const chainPath = path.join(certsDir, "chain.pem");
    const keyPath = path.join(certsDir, "key.pem");
    const configFilePath = path.join(confDir, "server.toml");

    // 1. Declarative TLS generation resource
    yield* provisionCerts(name, { certsDir, domain, chainPath, keyPath });

    // 2. Synthesize server.toml
    const generatedToml = renderServerToml(domain, origin);

    const dataVolume = `${name}-data`;

    // 3a. Materialize server.toml as a tracked resource
    const serverConfig = yield* Docker.ConfigFile(`${name}-server-toml`, {
      path: configFilePath,
      content: generatedToml,
    });

    // 3. Register Kanidm Server container
    const container = yield* Docker.Container(name, {
      image: "docker.io/kanidm/server:latest",
      name,
      networks: [{ name: net.name, aliases: ["kanidm", "identity", name.toLowerCase(), name] }],
      start: true,
      restart: "unless-stopped",
      command: ["kanidmd", "server", "-c", "/etc/kanidm/server.toml"],
      environment: {
        KANIDM_CONFIG: "/etc/kanidm/server.toml",
      },
      labels: {
        // Replaces this container whenever the rendered server.toml changes.
        "homelab.config-hash.server-toml": serverConfig.hash,
      },
      volumes: [
        {
          hostPath: serverConfig.path,
          containerPath: "/etc/kanidm/server.toml",
        },
        { hostPath: certsDir, containerPath: "/certs" },
        { hostPath: dataVolume, containerPath: "/data" },
      ],
    });

    const devPassword = yield* Secret.fromNullable(
      props.developerPassword,
      secrets.get("kanidm", "developer_password"),
    );

    // 4. Recover real idm_admin password ONCE and create developer user
    const accountBootstrap = yield* bootstrapAccounts(
      name,
      {
        containerId: container.id,
        containerName: name,
        network: net.name,
        devPass: devPassword.value,
      },
      secrets,
    );

    const endpoint: EndpointHandle = {
      host: "kanidm",
      port: 8443,
      protocol: "https",
    };

    const issuerUrl = origin;
    const internalUrl = `https://kanidm:8443`;

    // 5. Dynamic Client Provisioning Subresource
    const Client = (clientProps: KanidmClientProps) =>
      Effect.gen(function* () {
        const clientProvisionScript = yield* provisionClient(
          name,
          {
            containerId: container.id,
            containerName: name,
            network: net.name,
            client: clientProps,
          },
          [accountBootstrap.hash],
          secrets,
        );

        return {
          clientId: clientProps.id,
          clientSecret: Redacted.make(clientProvisionScript.result as any),
          issuerUrl,
          internalUrl,
          provisionHash: clientProvisionScript.hash,
        } satisfies KanidmClientHandle;
      });

    const handle: KanidmHandle = {
      _tag: "OidcProvider",
      domain,
      issuerUrl,
      internalUrl,
      endpoint,
      // Stack outputs bound directly to the bootstrap script result
      idmAdminPassword: Redacted.make(accountBootstrap.result as any),
      Client,
      get PublicEndpoint() {
        return makePublicEndpoint(handle, endpoint);
      },
    };

    return handle;
  });
