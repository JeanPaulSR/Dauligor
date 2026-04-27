import type { IncomingMessage } from "node:http";
import { handleR2MoveFolder } from "../_lib/r2-proxy";

export default async function handler(req: IncomingMessage & { body?: unknown }, res: any) {
  return handleR2MoveFolder(req, res);
}
