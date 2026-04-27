import type { IncomingMessage } from "node:http";
import { handleR2List } from "../_lib/r2-proxy.js";

export default async function handler(req: IncomingMessage & { query?: Record<string, unknown> }, res: any) {
  return handleR2List(req, res);
}
