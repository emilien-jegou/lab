// Application entrypoint: launches the composed layer.
import { BunRuntime } from '@effect/platform-bun';
import { Layer } from 'effect';

import { MainLayer } from './layers';

BunRuntime.runMain(Layer.launch(MainLayer));
