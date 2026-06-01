// Structured client-side error reporting (formerly in firebase.ts, now
// Firebase-free). Logs the error with the signed-in identity for context and
// rethrows so callers can still handle it.

import { getIdentity } from "./auth";

// Operation label for client-side error reports. Kept as a small enum so log
// entries carry a machine-readable verb.
export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

export function reportClientError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const id = getIdentity();
  const report = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: id?.uid,
      username: id?.username,
      email: id?.email,
      role: id?.role,
    },
    operationType,
    path,
  };
  console.error("Client Error:", JSON.stringify(report));
  throw new Error(JSON.stringify(report));
}
