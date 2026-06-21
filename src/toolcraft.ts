import { createSDK } from "toolcraft/sdk";
import type { CreateSDKOptions } from "toolcraft/sdk";
import { DefaultBabyDaybookCommandService } from "./command-service.js";
import type { BabyDaybookCommandServices } from "./command-service.js";
import { babyDaybookCommands } from "./commands.js";

export { babyDaybookCommands } from "./commands.js";
export {
  DefaultBabyDaybookCommandService,
  defaultBabyDaybookAuthFile,
} from "./command-service.js";
export type {
  BabyDaybookCommandConnection,
  BabyDaybookCommandService,
  BabyDaybookCommandServices,
} from "./command-service.js";

export type BabyDaybookToolcraftSDKOptions = Omit<CreateSDKOptions<BabyDaybookCommandServices>, "services"> & {
  services?: Partial<BabyDaybookCommandServices>;
};

export function createBabyDaybookToolcraftSDK(options: BabyDaybookToolcraftSDKOptions = {}) {
  return createSDK(babyDaybookCommands, {
    ...options,
    services: {
      babyDaybook: options.services?.babyDaybook ?? new DefaultBabyDaybookCommandService(),
    },
  });
}
