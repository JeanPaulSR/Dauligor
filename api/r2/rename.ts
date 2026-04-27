import type { IncomingMessage } from "node:http";
import { handleR2Rename } from "../_lib/r2-proxy.js";

export default async function handler(req: IncomingMessage & { body?: unknown }, res: any) {
  return handleR2Rename(req, res);
}
