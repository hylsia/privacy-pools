// Internal TypeScript imports and deployment JSON are bundled during the build.
// Keep this entrypoint native ESM so Vercel never runs unbundled source modules.
import handler from "../dist/serverless/index.mjs";

process.env.NODE_ENV ??= "production";

export default handler;
