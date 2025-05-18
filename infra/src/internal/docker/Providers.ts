import * as Layer from "effect/Layer";
import * as Provider from "alchemy/Provider";
import { ConfigFile, ConfigFileProvider } from "./ConfigFile";
import { Container, ContainerProvider } from "./Container";
import { Context, ContextProvider } from "./Context";
import { DockerLive } from "./Docker";
import { Image, ImageProvider } from "./Image";
import { Network, NetworkProvider } from "./Network";
import { RemoteImage, RemoteImageProvider } from "./RemoteImage";
import { Service, ServiceProvider } from "./Service";
import { Swarm, SwarmProvider } from "./Swarm";
import { Volume, VolumeProvider } from "./Volume";

export class Providers extends Provider.ProviderCollection<Providers>()(
  "Docker",
) {}

export type ProviderRequirements = Layer.Services<ReturnType<typeof providers>>;

/**
 * Registers all Docker resource providers.
 *
 * Docker providers use the active Docker CLI context and are intentionally
 * separate from `Cloudflare.Container`.
 */
export const providers = () =>
  Layer.effect(
    Providers,
    Provider.collection([
      ConfigFile,
      Container,
      Image,
      Network,
      RemoteImage,
      Volume,
      Context,
      Service,
      Swarm,
    ]),
  ).pipe(
    Layer.provide(
      Layer.mergeAll(
        ConfigFileProvider(),
        ContainerProvider(),
        ImageProvider(),
        NetworkProvider(),
        RemoteImageProvider(),
        VolumeProvider(),
        ContextProvider(),
        ServiceProvider(),
        SwarmProvider(),
      ),
    ),
    Layer.provideMerge(DockerLive),
  );
