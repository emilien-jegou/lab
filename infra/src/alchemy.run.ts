// infra/src/alchemy.run.ts
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Redacted } from "effect";
import * as Docker from "./internal/docker";
import { scriptProviders } from "./internal/script/Script";
import { SecretStoreLive } from "./internal/secrets/SecretStore";
import { Ingress } from "./gateway/ingress";
import { Infra, Services, Gateway } from "./catalog";
import { HomeLabConfig } from "./config";
import { getStackNetwork } from "./link";
import { resolveProjectPath } from "./paths";

export default Alchemy.Stack(
  "HomeLabStack",
  {
    providers: Layer.mergeAll(
      Docker.providers(),
      scriptProviders(),
      SecretStoreLive(),
    ),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const config = yield* HomeLabConfig;

    // Shared stack bridge network — declared once here, referenced idempotently
    // by every component via `getStackNetwork()` (Alchemy dedupes by FQN).
    yield* getStackNetwork();

    // 0. Public Gateway Ingress
    const IngressGateway = Ingress.Gateway({
      domain: "localhost",
      port: 8000,
    });

    const idmEp = IngressGateway.entrypoint("idm");
    const oxicloudEp = IngressGateway.entrypoint("oxicloud");
    const openobserveEp = IngressGateway.entrypoint("openobserve");
    const surrealistEp = IngressGateway.entrypoint("surrealist");
    const materialiousEp = IngressGateway.entrypoint("materialious");
    const labEp = IngressGateway.entrypoint("lab");
    const imgproxyEp = IngressGateway.entrypoint("imgproxy");

    // 1. Identity Provider
    const Identity = yield* Infra.Kanidm("kanidm", {
      entrypoint: idmEp,
    });

    // 2. Storage Engine & Auto-Provisioned S3 Bucket
    const S3Engine = yield* Infra.S3.Engine("garage");
    const Storage = yield* Infra.S3.Bucket("photos", {
      engine: S3Engine,
    });
    const MediaResizer = yield* Infra.ImgProxy("imgproxy", { storage: Storage });

    // 3. Cache, Streaming Queue & Databases (Clean zero-config)
    const Cache = yield* Infra.Valkey("valkey");
    const Events = yield* Infra.Iggy("iggy");
    const PrimaryDB = yield* Infra.SurrealDB("surrealdb");
    const LabDB = yield* Infra.SurrealDB.Database("app-db", {
      server: PrimaryDB,
      namespace: "app",
      database: "app",
    });

    // 4. Observability Hub
    const OpenObserveApp = yield* Infra.OpenObserve("openobserve", {
      rootEmail: config.openobserve.rootEmail,
      rootPassword: config.openobserve.rootPassword,
    });

    const Telemetry = yield* Infra.Vector("vector", {
      sink: OpenObserveApp,
    });

    const Observability = yield* Effect.succeed(OpenObserveApp).pipe(
      Services.withOidcAuth({
        provider: Identity,
        clientId: "openobserve",
        entrypoint: openobserveEp,
      })
    );

    // 5. Backend Applications
    const OxiCloud = yield* Services.OxiCloud("oxicloud", {
      entrypoint: oxicloudEp,
      storage: Storage,
      oidc: Identity,
    });

    const Lab = yield* Services.Lab("lab", {
      appDir: resolveProjectPath("lab"),
      storage: Storage,
      cache: Cache,
      events: Events,
      db: LabDB,
      media: MediaResizer,
      telemetry: Telemetry,
      cloud: OxiCloud,
      observability: OpenObserveApp,
    });

    // 6. Secured UIs
    const SurrealistUI = yield* Services.Surrealist("surrealist", {
      database: PrimaryDB,
    }).pipe(
      Services.withOidcAuth({
        provider: Identity,
        clientId: "surrealist_proxy",
        entrypoint: surrealistEp,
      })
    );

    const Materialious = yield* Services.Materialious("materialious").pipe(
      Services.withOidcAuth({
        provider: Identity,
        clientId: "materialious_proxy",
        entrypoint: materialiousEp,
      })
    );

    // 7. Ingress Gateway
    const Portal = yield* Gateway.Pingora("pingora", {
      gateway: IngressGateway,
      routes: [
        idmEp.toRoute(Identity.PublicEndpoint),
        labEp.toRoute(Lab.PublicEndpoint),
        oxicloudEp.toRoute(OxiCloud),
        openobserveEp.toRoute(Observability),
        surrealistEp.toRoute(SurrealistUI),
        materialiousEp.toRoute(Materialious),
        imgproxyEp.toRoute(MediaResizer.PublicEndpoint),
      ],
    });

    return {
      portal: Portal.endpoint,
      idmAdminPassword: Redacted.value(Identity.idmAdminPassword),
      database: {
        oxicloudPostgres: Redacted.value(OxiCloud.database.password),
        surrealdb: Redacted.value(PrimaryDB.rootPassword),
        labDbPassword: Redacted.value(LabDB.password),
      },
      storage: {
        photos: {
          accessKey: Storage.accessKey,
          secretKey: Redacted.value(Storage.secretKey),
        },
      },
      cache: {
        valkey: Redacted.value(Cache.password),
      },
      streaming: {
        iggy: Redacted.value(Events.pass),
      },
    };
  })
);
