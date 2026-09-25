import { QueueDomainError } from "./types.js";

export interface CommandRequestIdentity {
  readonly commandId: string;
  readonly actorScope: string;
  readonly commandType: string;
  readonly requestFingerprint: string;
}

export interface CommandReceipt<TResult> extends CommandRequestIdentity {
  readonly result: TResult;
}

export type CommandReceiptResolution<TResult> =
  | { readonly kind: "execute" }
  | { readonly kind: "replay"; readonly result: TResult };

export function resolveCommandReceipt<TResult>(
  storedReceipt: CommandReceipt<TResult> | null,
  request: CommandRequestIdentity,
): CommandReceiptResolution<TResult> {
  if (storedReceipt === null) {
    return { kind: "execute" };
  }

  const isExactRetry =
    storedReceipt.commandId === request.commandId &&
    storedReceipt.actorScope === request.actorScope &&
    storedReceipt.commandType === request.commandType &&
    storedReceipt.requestFingerprint === request.requestFingerprint;

  if (!isExactRetry) {
    throw new QueueDomainError(
      "IDEMPOTENCY_CONFLICT",
      "The command ID was already used for a different command.",
    );
  }

  return { kind: "replay", result: storedReceipt.result };
}
