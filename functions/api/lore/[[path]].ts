import { runVercelHandler } from "../../../api/_lib/pages-adapter.js";
import handler from "../../../api/lore.js";

export const onRequest = async (context: any): Promise<Response> => {
  return runVercelHandler(context.request, context.env, handler);
};
