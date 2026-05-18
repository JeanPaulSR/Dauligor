import { runVercelHandler } from "../../../api/_lib/pages-adapter.js";
import handler from "../../../api/characters/[id].js";

export const onRequest = async (context: any): Promise<Response> => {
  return runVercelHandler(context.request, context.env, handler);
};
