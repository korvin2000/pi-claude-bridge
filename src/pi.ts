// Pi entry point — `package.json#pi.extensions`.
//
// Everything the bridge does lives in ./index.ts; this file only says which
// host it is running on. See src/host.ts for what that changes.

import { createExtension } from "./index.js";
import { piHost } from "./host-pi.js";

export default createExtension(piHost);
