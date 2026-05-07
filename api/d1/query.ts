import type { IncomingMessage } from "node:http";
import { handleD1Query } from "../_lib/d1-proxy.js";

export default async function handler(req: IncomingMessage, res: any) {
  return handleD1Query(req as any, res);
}
