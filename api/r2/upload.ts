import type { IncomingMessage } from "node:http";
import { handleR2Upload } from "../_lib/r2-proxy.js";

export default async function handler(req: IncomingMessage, res: any) {
  return handleR2Upload(req, res);
}
