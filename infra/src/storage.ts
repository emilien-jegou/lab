import { Effect } from "effect";
import * as Docker from "./internal/docker";
import { resolveServiceDataPath } from "./paths";

export interface StorageVolumeConfig {
  readonly type: "volume";
  readonly name?: string;
  readonly driver?: string;
  readonly driverOpts?: Record<string, string>;
  readonly labels?: Record<string, string>;
}

export interface StorageTmpfsConfig {
  readonly type: "tmpfs";
  readonly size?: string | number;
  readonly mode?: string;
}

export interface StorageBindConfig {
  readonly type: "bind";
  readonly hostPath: string;
}

export type StorageInput =
  | string
  | Docker.Volume
  | StorageVolumeConfig
  | StorageTmpfsConfig
  | StorageBindConfig;

export interface ResolvedStorage {
  readonly volume?: Docker.Container.VolumeMapping;
  readonly mount?: string;
}

const isHostPath = (val: string): boolean =>
  val.startsWith("/") ||
  val.startsWith("./") ||
  val.startsWith("../") ||
  val.startsWith("~") ||
  /^[a-zA-Z]:[\\/]/.test(val);

export const resolveStorageMount = (
  serviceName: string,
  containerPath: string,
  input?: StorageInput,
  subPath?: string,
): Effect.Effect<ResolvedStorage, any, any> =>
  Effect.gen(function* () {
    // 1. Tmpfs Mount (RAM)
    if (typeof input === "object" && "type" in input && input.type === "tmpfs") {
      const sizeOpt = input.size ? `,size=${input.size}` : "";
      const modeOpt = input.mode ? `,mode=${input.mode}` : "";
      return {
        mount: `type=tmpfs,destination=${containerPath}${sizeOpt}${modeOpt}`,
      };
    }

    // 2. Declarative Named Volume with Driver & Opts
    if (typeof input === "object" && "type" in input && input.type === "volume") {
      const volName = input.name ?? `${serviceName}-data`;
      const vol = yield* Docker.Volume(volName, {
        name: volName,
        driver: input.driver ?? "local",
        driverOpts: input.driverOpts,
        labels: input.labels,
      });
      return {
        volume: {
          hostPath: vol.name as any,
          containerPath,
        },
      };
    }

    // 3. Explicit Bind Mount Object
    if (typeof input === "object" && "type" in input && input.type === "bind") {
      const hostPath = yield* resolveServiceDataPath(serviceName, input.hostPath, subPath);
      return {
        volume: { hostPath, containerPath },
      };
    }

    // 4. Managed Docker.Volume Resource
    if (typeof input === "object" && "name" in input && !("containerPath" in input)) {
      return {
        volume: {
          hostPath: (input as Docker.Volume).name as any,
          containerPath,
        },
      };
    }

    // 5. String (Host Path or Named Volume)
    if (typeof input === "string") {
      if (isHostPath(input)) {
        const hostPath = yield* resolveServiceDataPath(serviceName, input, subPath);
        return {
          volume: { hostPath, containerPath },
        };
      }
      return {
        volume: { hostPath: input, containerPath },
      };
    }

    // 6. Default (omitted): resolves to local directory `<DATA_DIR>/<serviceName>/<subPath>`
    const hostPath = yield* resolveServiceDataPath(serviceName, undefined, subPath);
    return {
      volume: { hostPath, containerPath },
    };
  });
