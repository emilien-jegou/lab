// infra/src/gateway/pingora/index.ts
import * as Docker from "../../internal/docker";
import { Effect } from "effect";
import { GatewayRoute, PublicEndpointBrand, IngressGateway } from "../ingress";
import { getStackNetwork } from "../../link";

export interface PingoraProps {
  readonly gateway: IngressGateway;
  readonly routes: ReadonlyArray<GatewayRoute>;
  readonly dataDir?: string;
}

export const Pingora = (name: string, props: PingoraProps) =>
  Effect.gen(function* () {
    const net = yield* getStackNetwork();

    const upstreamEntries: string[] = [];
    const locationEntries: string[] = [];
    const locationNames: string[] = [];

    // Synthesize upstream and location blocks from routes
    props.routes.forEach((r, idx) => {
      const ep = PublicEndpointBrand in r.target ? r.target.endpoint : r.target.endpoint;
      const upstreamName = `upstream_${idx}`;
      const locationName = `loc_${idx}`;
      const isHttps = ep.protocol === "https" || ep.port === 8443;

      upstreamEntries.push(`
[upstreams.${upstreamName}]
addrs = ["${ep.host}:${ep.port}"]
discovery = "dns"
update_frequency = "10s"
${isHttps ? `sni = "${r.host}"\nverify_cert = false` : ""}
`);

      locationEntries.push(`
[locations.${locationName}]
upstream = "${upstreamName}"
host = "${r.host},${r.host}:${props.gateway.port}"
path = "/"
`);

      locationNames.push(`"${locationName}"`);
    });

    locationNames.push('"default_loc"');

    const idmRedirectUrl = props.gateway.entrypoint("idm").url();

    const generatedToml = `
# Generated dynamically by Alchemy for Pingora / PingAP
[plugins.redirect_to_idm]
category = "mock"
status = 302
headers = [
  "Location: ${idmRedirectUrl}"
]

${upstreamEntries.join("\n")}
${locationEntries.join("\n")}

[locations.default_loc]
plugins = ["redirect_to_idm"]
path = "/"

[servers.portal]
addr = "0.0.0.0:${props.gateway.port}"
locations = [
  ${locationNames.join(",\n  ")}
]
`.trim();

    const routeAliases = props.routes.map((r) => r.host);
    const dataVolume = `${name}-data`;

    yield* Docker.Container(name, {
      image: "docker.io/vicanso/pingap:latest",
      name,
      restart: "unless-stopped",
      networks: [
        {
          name: net.name,
          aliases: [
            "pingora",
            "pingora-portal",
            name.toLowerCase(),
            name,
            ...routeAliases,
          ],
        },
      ],
      start: true,
      environment: {
        PINGAP_CONFIG: generatedToml,
      },
      entrypoint: ["/bin/sh", "-c"],
      command: [
        `mkdir -p /etc/pingap/conf && printf "%s\n" "$PINGAP_CONFIG" > /etc/pingap/conf/pingap.toml && exec pingap -c /etc/pingap/conf/pingap.toml --autoreload --admin=cGluZ2FwOjEyMzEyMw==@0.0.0.0:3018`,
      ],
      ports: [
        { external: props.gateway.port, internal: props.gateway.port },
        { external: 3018, internal: 3018 },
      ],
      volumes: [
        { hostPath: dataVolume, containerPath: "/opt/pingap" },
      ],
    });

    return {
      endpoint: props.gateway.origin,
    };
  });
