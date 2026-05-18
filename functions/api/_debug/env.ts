// Diagnostic endpoint for env-var visibility on Pages Functions.
// Returns booleans + key names only (never values) so the response is
// safe to share. Delete this file once the migration is settled.

export const onRequest = async (context: any): Promise<Response> => {
  const ctxEnv = (context?.env ?? {}) as Record<string, unknown>;
  const procEnv =
    ((globalThis as any).process?.env ?? {}) as Record<string, unknown>;

  const watch = [
    "R2_WORKER_URL",
    "R2_API_SECRET",
    "FIREBASE_SERVICE_ACCOUNT_JSON",
    "FIREBASE_PROJECT_ID",
  ];

  // Probe whether process.env is writable at runtime
  let writeWorked = false;
  let writeError: string | null = null;
  try {
    const target = (globalThis as any).process?.env;
    if (!target) throw new Error("process.env is undefined");
    target.__DAULIGOR_PROBE = "probe-value-7c41";
    writeWorked = target.__DAULIGOR_PROBE === "probe-value-7c41";
    delete target.__DAULIGOR_PROBE;
  } catch (err: any) {
    writeError = err?.message ?? String(err);
  }

  const result = {
    contextEnvKeyCount: Object.keys(ctxEnv).length,
    contextEnvKeys: Object.keys(ctxEnv),
    processEnvKeyCount: Object.keys(procEnv).length,
    processEnvSampleKeys: Object.keys(procEnv).slice(0, 30),
    perKeyPresence: Object.fromEntries(
      watch.map((k) => [
        k,
        {
          inContextEnv: typeof ctxEnv[k] === "string",
          inProcessEnv: typeof procEnv[k] === "string",
        },
      ]),
    ),
    processEnvWriteWorks: writeWorked,
    processEnvWriteError: writeError,
  };

  return new Response(JSON.stringify(result, null, 2), {
    headers: { "content-type": "application/json" },
  });
};
