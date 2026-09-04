// Oh My Pi entry point — `package.json#omp.extensions`.
//
// Everything the bridge does lives in ./index.ts, which OMP loads through its
// legacy-Pi compatibility layer unchanged; this file only says which host it is
// running on and pulls in the OMP half of the adapter. Keeping it a separate
// entry is what keeps ./host-pi.ts — and the Pi-only exports it imports by name,
// which would fail Bun's static export check here — out of OMP's module graph
// entirely. See src/host.ts.

import { createExtension } from "./index.js";
import { ompHost } from "./host-omp.js";

export default createExtension(ompHost);
