import {
  CallNextErrorResponseSchema,
  CallNextRequestSchema,
  CallNextResponseSchema,
  JoinQueueRequestSchema,
  JoinQueueResponseSchema,
  LifecycleStatusSchema,
  OpenQueueSessionRequestSchema,
  OpenQueueSessionResponseSchema,
  QueueSessionConfigSnapshotSchema,
  type JoinQueueResponse,
} from "@queuenow/contracts";
import {
  advanceQueueRevision,
  calculateNextSequenceAllocation,
  estimateReturnWindow,
  estimateServiceDurationSeconds,
  formatDisplayNumber,
  QueueDomainError,
  resolveCommandReceipt,
  transitionLifecycle,
} from "@queuenow/queue-core";
import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import {
  decryptJoinCapabilityEnvelope,
  encryptJoinCapabilityEnvelope,
  generateTicketCapability,
  JoinRecoveryInvalidError,
} from "./join-recovery.js";

const CURRENT_SCHEMA_VERSION = 3;
const OPEN_SESSION_COMMAND_TYPE = "OPEN_QUEUE_SESSION";
const CALL_NEXT_COMMAND_TYPE = "CALL_NEXT";
const COMMAND_RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;
// Keep generated deadlines within the four-digit year range accepted by the shared ISO schema.
const MAX_CONTRACT_DATETIME_MILLISECONDS = Date.parse("9999-12-31T23:59:59.999Z");

const InternalOpenQueueSessionIdentitySchema = OpenQueueSessionRequestSchema.extend({
  actorScope: z.string().min(1).max(128),
  queueId: z.string().min(1).max(128),
}).passthrough();

const InternalOpenQueueSessionCommandSchema = InternalOpenQueueSessionIdentitySchema.extend({
  configSnapshot: QueueSessionConfigSnapshotSchema,
}).strict();

const InternalJoinQueueCommandSchema = JoinQueueRequestSchema.extend({
  queueId: z.string().min(1).max(128),
}).strict();

const InternalCallNextCommandSchema = CallNextRequestSchema.extend({
  actorScope: z.string().min(1).max(128),
  queueId: z.string().min(1).max(128),
}).strict();

const StoredJoinResultSchema = JoinQueueResponseSchema.pick({ ticket: true }).strict();

const OpenSessionErrorSchema = z
  .object({
    error: z
      .object({
        code: z.enum(["QUEUE_SESSION_ACTIVE"]),
        message: z.string(),
      })
      .strict(),
  })
  .strict();

const StoredOpenSessionResultSchema = z
  .object({
    status: z.number().int().min(200).max(599),
    body: z.union([OpenQueueSessionResponseSchema, OpenSessionErrorSchema]),
  })
  .strict();

const StoredCallNextResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal(200), body: CallNextResponseSchema }).strict(),
  z.object({ status: z.literal(409), body: CallNextErrorResponseSchema }).strict(),
]);

type StoredOpenSessionResult = z.infer<typeof StoredOpenSessionResultSchema>;
type StoredCallNextResult = z.infer<typeof StoredCallNextResultSchema>;
type StoredCommandResult = StoredOpenSessionResult | StoredCallNextResult;
type StoredJoinResult = z.infer<typeof StoredJoinResultSchema>;
type InternalJoinQueueCommand = z.infer<typeof InternalJoinQueueCommandSchema>;
type InternalQueueApiErrorCode =
  | "IDEMPOTENCY_CONFLICT"
  | "INTERNAL_ERROR"
  | "INVALID_REQUEST"
  | "INVALID_SERVICE"
  | "JOIN_RECOVERY_INVALID"
  | "QUEUE_CALL_COUNT_EXHAUSTED"
  | "QUEUE_CLOSED"
  | "QUEUE_CONFIG_INVALID"
  | "QUEUE_CONFIG_REQUIRED"
  | "QUEUE_ID_MISMATCH"
  | "QUEUE_PAUSED"
  | "QUEUE_REVISION_EXHAUSTED"
  | "QUEUE_SEQUENCE_EXHAUSTED"
  | "QUEUE_STATE_CHANGED";
type OpenSessionOutcome =
  | { readonly kind: "result"; readonly result: StoredOpenSessionResult }
  | { readonly kind: "idempotency-conflict" }
  | { readonly kind: "queue-id-mismatch" }
  | { readonly kind: "queue-config-required" }
  | { readonly kind: "invalid-request" }
  | { readonly kind: "invalid-receipt" };
type CallNextOutcome =
  | { readonly kind: "result"; readonly result: StoredCallNextResult }
  | { readonly kind: "idempotency-conflict" }
  | { readonly kind: "queue-id-mismatch" }
  | { readonly kind: "invalid-receipt" }
  | { readonly kind: "queue-config-invalid" }
  | { readonly kind: "call-count-exhausted" };
type JoinQueueOutcome =
  | { readonly kind: "accepted"; readonly response: JoinQueueResponse }
  | { readonly kind: "receipt-exists" }
  | { readonly kind: "queue-id-mismatch" }
  | { readonly kind: "queue-closed" }
  | { readonly kind: "queue-paused" }
  | { readonly kind: "invalid-service" }
  | { readonly kind: "session-changed" };
type JoinReceiptReplay =
  | { readonly kind: "missing" }
  | { readonly kind: "response"; readonly response: Response };

interface ActiveQueueSessionRow {
  readonly [column: string]: string | number;
  readonly session_id: string;
  readonly queue_id: string;
  readonly status: string;
  readonly next_sequence: number;
  readonly prefix: string;
  readonly service_capacity: number;
  readonly queue_revision: number;
  readonly config_snapshot_json: string;
}

export class QueueDurableObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.migrate();
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/_internal/health") {
      const schema = this.ctx.storage.sql
        .exec<{ version: number | null }>("SELECT MAX(version) AS version FROM schema_migrations")
        .one();
      const sessions = this.ctx.storage.sql
        .exec<{ count: number }>("SELECT COUNT(*) AS count FROM queue_session")
        .one();

      return jsonResponse({
        status: "ok",
        schemaVersion: schema.version ?? 0,
        sessionCount: sessions.count,
      });
    }

    // The public Worker must resolve the queue and keep this internal command path private.
    if (request.method === "POST" && url.pathname === "/_internal/tickets/join") {
      return this.joinQueue(request);
    }

    // The public Worker must authenticate and authorize before forwarding this internal command.
    if (request.method === "POST" && url.pathname === "/_internal/sessions/open") {
      return this.openQueueSession(request);
    }

    // The public Worker must authenticate and authorize before forwarding this internal command.
    if (request.method === "POST" && url.pathname === "/_internal/queue/call-next") {
      return this.callNext(request);
    }

    return jsonResponse({ error: "Not found" }, 404);
  }

  private async openQueueSession(request: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiErrorResponse("INVALID_REQUEST", "The request body must be valid JSON.", 400);
    }

    const identity = InternalOpenQueueSessionIdentitySchema.safeParse(body);
    if (!identity.success) {
      return apiErrorResponse("INVALID_REQUEST", "The queue session command is invalid.", 400);
    }

    const [actorScopeHash, requestFingerprint] = await Promise.all([
      sha256Hex(identity.data.actorScope),
      sha256Hex(JSON.stringify({ queueId: identity.data.queueId })),
    ]);
    const now = new Date();
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + COMMAND_RECEIPT_TTL_MS).toISOString();
    const sql = this.ctx.storage.sql;

    const outcome: OpenSessionOutcome = this.ctx.storage.transactionSync(() => {
      sql.exec("DELETE FROM command_receipts WHERE expires_at <= ?", createdAt);

      const storedRow = sql
        .exec<{
          command_id: string;
          actor_scope_hash: string;
          command_type: string;
          request_fingerprint: string;
          result_json: string;
        }>(
          `SELECT command_id, actor_scope_hash, command_type, request_fingerprint, result_json
           FROM command_receipts WHERE command_id = ?`,
          identity.data.commandId,
        )
        .toArray()[0];

      if (storedRow) {
        let resolution: ReturnType<typeof resolveCommandReceipt<null>>;
        try {
          resolution = resolveCommandReceipt(
            {
              commandId: storedRow.command_id,
              actorScope: storedRow.actor_scope_hash,
              commandType: storedRow.command_type,
              requestFingerprint: storedRow.request_fingerprint,
              result: null,
            },
            {
              commandId: identity.data.commandId,
              actorScope: actorScopeHash,
              commandType: OPEN_SESSION_COMMAND_TYPE,
              requestFingerprint,
            },
          );
        } catch (error) {
          if (error instanceof QueueDomainError && error.code === "IDEMPOTENCY_CONFLICT") {
            return { kind: "idempotency-conflict" };
          }
          throw error;
        }
        if (resolution.kind !== "replay") {
          return { kind: "invalid-receipt" };
        }
        try {
          return {
            kind: "result",
            result: StoredOpenSessionResultSchema.parse(JSON.parse(storedRow.result_json)),
          };
        } catch {
          return { kind: "invalid-receipt" };
        }
      }

      const existingQueue = sql
        .exec<{ queue_id: string }>("SELECT queue_id FROM queue_session LIMIT 1")
        .toArray()[0];
      if (existingQueue && existingQueue.queue_id !== identity.data.queueId) {
        return { kind: "queue-id-mismatch" };
      }

      const currentSession = sql
        .exec<{ queue_revision: number }>(
          "SELECT queue_revision FROM queue_session WHERE is_current = 1",
        )
        .toArray()[0];
      if (currentSession) {
        const result = StoredOpenSessionResultSchema.parse({
          status: 409,
          body: {
            error: {
              code: "QUEUE_SESSION_ACTIVE",
              message:
                "The active queue session must be resumed or closed before creating another.",
            },
          },
        });
        insertCommandReceipt(
          sql,
          identity.data.commandId,
          actorScopeHash,
          OPEN_SESSION_COMMAND_TYPE,
          requestFingerprint,
          result,
          currentSession.queue_revision,
          createdAt,
          expiresAt,
        );
        return { kind: "result", result };
      }

      const parsedCommand = InternalOpenQueueSessionCommandSchema.safeParse(body);
      if (!parsedCommand.success) {
        const hasConfigSnapshot =
          typeof body === "object" && body !== null && "configSnapshot" in body;
        return { kind: hasConfigSnapshot ? "invalid-request" : "queue-config-required" };
      }
      const command = parsedCommand.data;
      const configSnapshotJson = JSON.stringify(command.configSnapshot);

      const sessionId = crypto.randomUUID();
      const response = OpenQueueSessionResponseSchema.parse({
        sessionId,
        queueId: command.queueId,
        status: "OPEN",
        openedAt: createdAt,
        queueRevision: 0,
      });
      const result = StoredOpenSessionResultSchema.parse({ status: 201, body: response });

      sql.exec(
        `INSERT INTO queue_session (
          session_id, queue_id, status, opened_at, closed_at, prefix, next_sequence,
          grace_period_seconds, service_capacity, config_snapshot_json, queue_revision, is_current
        ) VALUES (?, ?, 'OPEN', ?, NULL, ?, ?, ?, ?, ?, 0, 1)`,
        sessionId,
        command.queueId,
        createdAt,
        command.configSnapshot.prefix,
        command.configSnapshot.startSequence,
        command.configSnapshot.gracePeriodSeconds,
        command.configSnapshot.serviceCapacity,
        configSnapshotJson,
      );
      insertCommandReceipt(
        sql,
        command.commandId,
        actorScopeHash,
        OPEN_SESSION_COMMAND_TYPE,
        requestFingerprint,
        result,
        0,
        createdAt,
        expiresAt,
      );

      return { kind: "result", result };
    });

    if (outcome.kind === "idempotency-conflict") {
      return apiErrorResponse(
        "IDEMPOTENCY_CONFLICT",
        "The command ID was already used for a different command.",
        409,
      );
    }
    if (outcome.kind === "queue-id-mismatch") {
      return apiErrorResponse(
        "QUEUE_ID_MISMATCH",
        "The Durable Object is already assigned to a different queue.",
        409,
      );
    }
    if (outcome.kind === "queue-config-required") {
      return apiErrorResponse(
        "QUEUE_CONFIG_REQUIRED",
        "A validated queue configuration snapshot is required to create a session.",
        400,
      );
    }
    if (outcome.kind === "invalid-request") {
      return apiErrorResponse("INVALID_REQUEST", "The queue session command is invalid.", 400);
    }
    if (outcome.kind === "invalid-receipt") {
      return apiErrorResponse("INTERNAL_ERROR", "The stored command result is unavailable.", 500);
    }

    return jsonResponse(outcome.result.body, outcome.result.status);
  }

  private async callNext(request: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiErrorResponse("INVALID_REQUEST", "The request body must be valid JSON.", 400);
    }

    const parsedCommand = InternalCallNextCommandSchema.safeParse(body);
    if (!parsedCommand.success) {
      return apiErrorResponse("INVALID_REQUEST", "The Call Next command is invalid.", 400);
    }
    const command = parsedCommand.data;
    const [actorScopeHash, requestFingerprint] = await Promise.all([
      sha256Hex(command.actorScope),
      sha256Hex(JSON.stringify({ queueId: command.queueId })),
    ]);
    const acceptedAt = new Date();
    const acceptedAtIso = acceptedAt.toISOString();
    const expiresAt = new Date(acceptedAt.getTime() + COMMAND_RECEIPT_TTL_MS).toISOString();
    const sql = this.ctx.storage.sql;
    const storeResult = (result: StoredCallNextResult, resultRevision: number): CallNextOutcome => {
      insertCommandReceipt(
        sql,
        command.commandId,
        actorScopeHash,
        CALL_NEXT_COMMAND_TYPE,
        requestFingerprint,
        result,
        resultRevision,
        acceptedAtIso,
        expiresAt,
      );
      return { kind: "result", result };
    };

    let outcome: CallNextOutcome;
    try {
      outcome = this.ctx.storage.transactionSync(() => {
        sql.exec("DELETE FROM command_receipts WHERE expires_at <= ?", acceptedAtIso);

        const storedRow = sql
          .exec<{
            command_id: string;
            actor_scope_hash: string;
            command_type: string;
            request_fingerprint: string;
            result_json: string;
          }>(
            `SELECT command_id, actor_scope_hash, command_type, request_fingerprint, result_json
             FROM command_receipts WHERE command_id = ?`,
            command.commandId,
          )
          .toArray()[0];
        if (storedRow) {
          let isExactRetry = false;
          try {
            const resolution = resolveCommandReceipt(
              {
                commandId: storedRow.command_id,
                actorScope: storedRow.actor_scope_hash,
                commandType: storedRow.command_type,
                requestFingerprint: storedRow.request_fingerprint,
                result: null,
              },
              {
                commandId: command.commandId,
                actorScope: actorScopeHash,
                commandType: CALL_NEXT_COMMAND_TYPE,
                requestFingerprint,
              },
            );
            isExactRetry = resolution.kind === "replay";
          } catch (error) {
            if (error instanceof QueueDomainError && error.code === "IDEMPOTENCY_CONFLICT") {
              return { kind: "idempotency-conflict" };
            }
            throw error;
          }
          if (!isExactRetry) {
            return { kind: "invalid-receipt" };
          }
          try {
            return {
              kind: "result",
              result: StoredCallNextResultSchema.parse(JSON.parse(storedRow.result_json)),
            };
          } catch {
            return { kind: "invalid-receipt" };
          }
        }

        const existingQueue = sql
          .exec<{ queue_id: string }>("SELECT queue_id FROM queue_session LIMIT 1")
          .toArray()[0];
        if (existingQueue && existingQueue.queue_id !== command.queueId) {
          return { kind: "queue-id-mismatch" };
        }

        const currentSession = sql
          .exec<{
            session_id: string;
            queue_id: string;
            status: string;
            grace_period_seconds: number;
            queue_revision: number;
          }>(
            `SELECT session_id, queue_id, status, grace_period_seconds, queue_revision
             FROM queue_session WHERE is_current = 1`,
          )
          .toArray()[0];
        if (!currentSession) {
          const lastRevision = sql
            .exec<{ queue_revision: number }>(
              "SELECT queue_revision FROM queue_session ORDER BY rowid DESC LIMIT 1",
            )
            .toArray()[0]?.queue_revision;
          const result = createCallNextErrorResult("QUEUE_CLOSED", "The queue is not open.");
          return storeResult(result, lastRevision ?? 0);
        }
        if (currentSession.queue_id !== command.queueId) {
          return { kind: "queue-id-mismatch" };
        }
        if (currentSession.status !== "OPEN" && currentSession.status !== "PAUSED") {
          const result = createCallNextErrorResult("QUEUE_CLOSED", "The queue is not open.");
          return storeResult(result, currentSession.queue_revision);
        }

        const candidate = sql
          .exec<{
            ticket_id: string;
            display_number: string;
            service_id: string;
            lifecycle_status: string;
            call_count: number;
          }>(
            `SELECT ticket_id, display_number, service_id, lifecycle_status, call_count
             FROM tickets
             WHERE session_id = ? AND lifecycle_status = 'WAITING'
             ORDER BY sequence_number ASC
             LIMIT 1`,
            currentSession.session_id,
          )
          .toArray()[0];
        if (!candidate) {
          const result = createCallNextErrorResult(
            "NO_WAITING_TICKETS",
            "No waiting tickets are available.",
          );
          return storeResult(result, currentSession.queue_revision);
        }

        if (
          !Number.isSafeInteger(candidate.call_count) ||
          candidate.call_count < 0 ||
          candidate.call_count >= Number.MAX_SAFE_INTEGER
        ) {
          return { kind: "call-count-exhausted" };
        }
        const graceDeadlineMilliseconds =
          acceptedAt.getTime() + currentSession.grace_period_seconds * 1000;
        if (
          !Number.isSafeInteger(currentSession.grace_period_seconds) ||
          currentSession.grace_period_seconds < 0 ||
          !Number.isSafeInteger(graceDeadlineMilliseconds) ||
          graceDeadlineMilliseconds > MAX_CONTRACT_DATETIME_MILLISECONDS
        ) {
          return { kind: "queue-config-invalid" };
        }

        const currentLifecycle = LifecycleStatusSchema.parse(candidate.lifecycle_status);
        const nextLifecycle = transitionLifecycle(currentLifecycle, "CALL", "STAFF");
        if (nextLifecycle !== "CALLED") {
          throw new Error("The Call Next transition did not produce CALLED state.");
        }
        const nextRevision = advanceQueueRevision(currentSession.queue_revision);
        const callCount = candidate.call_count + 1;
        const calledAt = acceptedAtIso;
        const graceDeadline = new Date(graceDeadlineMilliseconds).toISOString();
        const response = CallNextResponseSchema.parse({
          sessionId: currentSession.session_id,
          ticket: {
            ticketId: candidate.ticket_id,
            displayNumber: candidate.display_number,
            serviceId: candidate.service_id,
            lifecycleStatus: nextLifecycle,
            callCount,
            calledAt,
            graceDeadline,
          },
          queueRevision: nextRevision,
        });
        const result = StoredCallNextResultSchema.parse({ status: 200, body: response });

        sql.exec(
          `UPDATE tickets SET lifecycle_status = ?, called_at = ?, grace_deadline = ?,
                               call_count = ?, last_mutation_revision = ?
           WHERE ticket_id = ? AND session_id = ? AND lifecycle_status = 'WAITING'`,
          nextLifecycle,
          calledAt,
          graceDeadline,
          callCount,
          nextRevision,
          candidate.ticket_id,
          currentSession.session_id,
        );
        sql.exec(
          "UPDATE queue_session SET queue_revision = ? WHERE session_id = ? AND is_current = 1",
          nextRevision,
          currentSession.session_id,
        );
        sql.exec(
          `INSERT INTO events (
            event_id, session_id, queue_revision, event_type, ticket_id, actor_type,
            actor_id, occurred_at, safe_payload_json
          ) VALUES (?, ?, ?, 'TICKET_CALLED', ?, 'MERCHANT', ?, ?, ?)`,
          crypto.randomUUID(),
          currentSession.session_id,
          nextRevision,
          candidate.ticket_id,
          command.actorScope,
          calledAt,
          JSON.stringify({ displayNumber: candidate.display_number }),
        );
        return storeResult(result, nextRevision);
      });
    } catch (error) {
      if (error instanceof QueueDomainError && error.code === "INVALID_REVISION") {
        return apiErrorResponse(
          "QUEUE_REVISION_EXHAUSTED",
          "The queue cannot advance its revision safely.",
          409,
        );
      }
      throw error;
    }

    if (outcome.kind === "idempotency-conflict") {
      return apiErrorResponse(
        "IDEMPOTENCY_CONFLICT",
        "The command ID was already used for a different command.",
        409,
      );
    }
    if (outcome.kind === "queue-id-mismatch") {
      return apiErrorResponse(
        "QUEUE_ID_MISMATCH",
        "The Durable Object is already assigned to a different queue.",
        409,
      );
    }
    if (outcome.kind === "invalid-receipt") {
      return apiErrorResponse("INTERNAL_ERROR", "The stored command result is unavailable.", 500);
    }
    if (outcome.kind === "queue-config-invalid") {
      return apiErrorResponse("QUEUE_CONFIG_INVALID", "The queue grace period is invalid.", 500);
    }
    if (outcome.kind === "call-count-exhausted") {
      return apiErrorResponse(
        "QUEUE_CALL_COUNT_EXHAUSTED",
        "The ticket call counter cannot advance safely.",
        409,
      );
    }

    return jsonResponse(outcome.result.body, outcome.result.status);
  }

  private async joinQueue(request: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiErrorResponse("INVALID_REQUEST", "The request body must be valid JSON.", 400);
    }

    const parsedCommand = InternalJoinQueueCommandSchema.safeParse(body);
    if (!parsedCommand.success) {
      return apiErrorResponse("INVALID_REQUEST", "The queue join request is invalid.", 400);
    }
    const command = parsedCommand.data;

    const priorReceipt = await this.replayJoinReceipt(command);
    if (priorReceipt.kind === "response") {
      return priorReceipt.response;
    }

    const sql = this.ctx.storage.sql;
    const preparedSession = sql
      .exec<ActiveQueueSessionRow>(
        `SELECT session_id, queue_id, status, next_sequence, prefix, service_capacity,
                queue_revision, config_snapshot_json
         FROM queue_session WHERE is_current = 1`,
      )
      .toArray()[0];
    if (!preparedSession) {
      return apiErrorResponse("QUEUE_CLOSED", "The queue is not open.", 409);
    }
    if (preparedSession.queue_id !== command.queueId) {
      return apiErrorResponse(
        "QUEUE_ID_MISMATCH",
        "The Durable Object is already assigned to a different queue.",
        409,
      );
    }
    if (preparedSession.status === "PAUSED") {
      return apiErrorResponse("QUEUE_PAUSED", "The queue is paused.", 409);
    }
    if (preparedSession.status !== "OPEN") {
      return apiErrorResponse("QUEUE_CLOSED", "The queue is not open.", 409);
    }

    const preparedConfig = QueueSessionConfigSnapshotSchema.parse(
      JSON.parse(preparedSession.config_snapshot_json),
    );
    if (!preparedConfig.services.some((service) => service.serviceId === command.serviceId)) {
      return apiErrorResponse("INVALID_SERVICE", "The selected service is not available.", 400);
    }

    const ticketId = crypto.randomUUID();
    const ticketCapability = generateTicketCapability();
    const recoveryContext = {
      queueId: command.queueId,
      sessionId: preparedSession.session_id,
      joinRequestId: command.joinRequestId,
      serviceId: command.serviceId,
      ticketId,
    };
    const [requestFingerprint, capabilityHash, capabilityEnvelope] = await Promise.all([
      sha256Hex(JSON.stringify([command.queueId, preparedSession.session_id, command.serviceId])),
      sha256Hex(ticketCapability),
      encryptJoinCapabilityEnvelope(command.joinRecoverySecret, ticketCapability, recoveryContext),
    ]);
    const acceptedAt = new Date();
    const acceptedAtIso = acceptedAt.toISOString();
    const expiresAt = new Date(acceptedAt.getTime() + COMMAND_RECEIPT_TTL_MS).toISOString();

    let outcome: JoinQueueOutcome;
    try {
      outcome = this.ctx.storage.transactionSync(() => {
        sql.exec("DELETE FROM join_receipts WHERE expires_at <= ?", acceptedAtIso);

        const duplicateReceipt = sql
          .exec<{ join_request_id: string }>(
            "SELECT join_request_id FROM join_receipts WHERE join_request_id = ?",
            command.joinRequestId,
          )
          .toArray()[0];
        if (duplicateReceipt) {
          return { kind: "receipt-exists" };
        }

        const currentSession = sql
          .exec<ActiveQueueSessionRow>(
            `SELECT session_id, queue_id, status, next_sequence, prefix, service_capacity,
                    queue_revision, config_snapshot_json
             FROM queue_session WHERE is_current = 1`,
          )
          .toArray()[0];
        if (!currentSession) {
          return { kind: "queue-closed" };
        }
        if (currentSession.queue_id !== command.queueId) {
          return { kind: "queue-id-mismatch" };
        }
        if (currentSession.session_id !== preparedSession.session_id) {
          return { kind: "session-changed" };
        }
        if (currentSession.status === "PAUSED") {
          return { kind: "queue-paused" };
        }
        if (currentSession.status !== "OPEN") {
          return { kind: "queue-closed" };
        }

        const config = QueueSessionConfigSnapshotSchema.parse(
          JSON.parse(currentSession.config_snapshot_json),
        );
        const selectedService = config.services.find(
          (service) => service.serviceId === command.serviceId,
        );
        if (!selectedService) {
          return { kind: "invalid-service" };
        }

        const allocation = calculateNextSequenceAllocation(currentSession.next_sequence);
        const nextRevision = advanceQueueRevision(currentSession.queue_revision);
        const peopleAhead = sql
          .exec<{ count: number }>(
            `SELECT COUNT(*) AS count FROM tickets
             WHERE session_id = ? AND sequence_number < ?
               AND lifecycle_status IN ('WAITING', 'CALLED', 'SERVING')`,
            currentSession.session_id,
            allocation.sequenceNumber,
          )
          .one().count;
        const activeServiceRows = sql
          .exec<{ service_id: string; service_started_at: string | null }>(
            `SELECT service_id, service_started_at FROM tickets
             WHERE session_id = ? AND lifecycle_status = 'SERVING'
             ORDER BY sequence_number ASC`,
            currentSession.session_id,
          )
          .toArray();
        const waitingAheadRows = sql
          .exec<{ service_id: string }>(
            `SELECT service_id FROM tickets
             WHERE session_id = ? AND sequence_number < ?
               AND lifecycle_status IN ('WAITING', 'CALLED')
             ORDER BY sequence_number ASC`,
            currentSession.session_id,
            allocation.sequenceNumber,
          )
          .toArray();
        const defaultDuration = (serviceId: string): number => {
          const service = config.services.find((candidate) => candidate.serviceId === serviceId);
          if (!service) {
            throw new Error(
              "A live ticket references a service missing from its session snapshot.",
            );
          }
          return estimateServiceDurationSeconds(service.defaultDurationSeconds, []).durationSeconds;
        };
        const activeServices = activeServiceRows.map((activeService) => {
          if (!activeService.service_started_at) {
            throw new Error("A serving ticket has no service start time.");
          }
          const startedAt = Date.parse(activeService.service_started_at);
          const elapsedMilliseconds = acceptedAt.getTime() - startedAt;
          if (!Number.isSafeInteger(startedAt) || elapsedMilliseconds < 0) {
            throw new Error("A serving ticket has an invalid service start time.");
          }
          return {
            expectedDurationSeconds: defaultDuration(activeService.service_id),
            elapsedMilliseconds,
          };
        });
        const estimate = estimateReturnWindow({
          nowMilliseconds: acceptedAt.getTime(),
          serviceCapacity: currentSession.service_capacity,
          activeServices,
          waitingAheadDurationsSeconds: waitingAheadRows.map((ticket) =>
            defaultDuration(ticket.service_id),
          ),
          uncertaintyBufferSeconds: config.returnWindowBufferSeconds,
        });
        const displayNumber = formatDisplayNumber(currentSession.prefix, allocation.sequenceNumber);
        const response = JoinQueueResponseSchema.parse({
          ticket: {
            ticketId,
            displayNumber,
            lifecycleStatus: "WAITING",
            presenceStatus: "UNKNOWN",
            peopleAhead,
            returnWindow: {
              from: new Date(estimate.earliestReturnAtMilliseconds).toISOString(),
              to: new Date(estimate.latestReturnAtMilliseconds).toISOString(),
            },
            queueRevision: nextRevision,
          },
          ticketCapability,
        });
        const safeResult = StoredJoinResultSchema.parse({ ticket: response.ticket });

        sql.exec(
          `UPDATE queue_session SET next_sequence = ?, queue_revision = ?
           WHERE session_id = ? AND is_current = 1 AND status = 'OPEN'`,
          allocation.nextSequence,
          nextRevision,
          currentSession.session_id,
        );
        sql.exec(
          `INSERT INTO tickets (
            ticket_id, session_id, sequence_number, display_number, service_id,
            lifecycle_status, presence_status, joined_at, called_at, grace_deadline,
            service_started_at, completed_at, cancelled_at, skipped_at, expired_at,
            call_count, capability_hash, last_mutation_revision
          ) VALUES (?, ?, ?, ?, ?, 'WAITING', 'UNKNOWN', ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, ?, ?)`,
          ticketId,
          currentSession.session_id,
          allocation.sequenceNumber,
          displayNumber,
          command.serviceId,
          acceptedAtIso,
          capabilityHash,
          nextRevision,
        );
        sql.exec(
          `INSERT INTO events (
            event_id, session_id, queue_revision, event_type, ticket_id, actor_type,
            actor_id, occurred_at, safe_payload_json
          ) VALUES (?, ?, ?, 'TICKET_JOINED', ?, 'CUSTOMER', NULL, ?, ?)`,
          crypto.randomUUID(),
          currentSession.session_id,
          nextRevision,
          ticketId,
          acceptedAtIso,
          JSON.stringify({ displayNumber }),
        );
        sql.exec(
          `INSERT INTO join_receipts (
            join_request_id, session_id, request_fingerprint, ticket_id, safe_result_json,
            ticket_capability_envelope_json, created_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          command.joinRequestId,
          currentSession.session_id,
          requestFingerprint,
          ticketId,
          JSON.stringify(safeResult),
          JSON.stringify(capabilityEnvelope),
          acceptedAtIso,
          expiresAt,
        );

        return { kind: "accepted", response };
      });
    } catch (error) {
      if (error instanceof QueueDomainError && error.code === "INVALID_SEQUENCE") {
        return apiErrorResponse(
          "QUEUE_SEQUENCE_EXHAUSTED",
          "The queue cannot allocate another ticket number.",
          409,
        );
      }
      if (error instanceof QueueDomainError && error.code === "INVALID_REVISION") {
        return apiErrorResponse(
          "QUEUE_REVISION_EXHAUSTED",
          "The queue cannot advance its revision safely.",
          409,
        );
      }
      throw error;
    }

    if (outcome.kind === "receipt-exists") {
      const racedReceipt = await this.replayJoinReceipt(command);
      if (racedReceipt.kind === "response") {
        return racedReceipt.response;
      }
      return apiErrorResponse(
        "QUEUE_STATE_CHANGED",
        "The queue changed while the join was being processed. Retry explicitly while online.",
        409,
      );
    }
    if (outcome.kind === "queue-id-mismatch") {
      return apiErrorResponse(
        "QUEUE_ID_MISMATCH",
        "The Durable Object is already assigned to a different queue.",
        409,
      );
    }
    if (outcome.kind === "queue-closed") {
      return apiErrorResponse("QUEUE_CLOSED", "The queue is not open.", 409);
    }
    if (outcome.kind === "queue-paused") {
      return apiErrorResponse("QUEUE_PAUSED", "The queue is paused.", 409);
    }
    if (outcome.kind === "invalid-service") {
      return apiErrorResponse("INVALID_SERVICE", "The selected service is not available.", 400);
    }
    if (outcome.kind === "session-changed") {
      return apiErrorResponse(
        "QUEUE_STATE_CHANGED",
        "The queue session changed while the join was being processed. Retry explicitly while online.",
        409,
      );
    }

    return jsonResponse(outcome.response, 201);
  }

  private async replayJoinReceipt(command: InternalJoinQueueCommand): Promise<JoinReceiptReplay> {
    const row = this.ctx.storage.sql
      .exec<{
        session_id: string;
        request_fingerprint: string;
        ticket_id: string;
        safe_result_json: string;
        ticket_capability_envelope_json: string;
        expires_at: string;
      }>(
        `SELECT session_id, request_fingerprint, ticket_id, safe_result_json,
                ticket_capability_envelope_json, expires_at
         FROM join_receipts WHERE join_request_id = ?`,
        command.joinRequestId,
      )
      .toArray()[0];
    if (!row || row.expires_at <= new Date().toISOString()) {
      return { kind: "missing" };
    }

    const requestFingerprint = await sha256Hex(
      JSON.stringify([command.queueId, row.session_id, command.serviceId]),
    );
    if (requestFingerprint !== row.request_fingerprint) {
      return {
        kind: "response",
        response: apiErrorResponse(
          "IDEMPOTENCY_CONFLICT",
          "The join request ID was already used for a different queue, session, or service.",
          409,
        ),
      };
    }

    let safeResult: StoredJoinResult;
    let envelope: unknown;
    try {
      safeResult = StoredJoinResultSchema.parse(JSON.parse(row.safe_result_json));
      envelope = JSON.parse(row.ticket_capability_envelope_json);
    } catch {
      return {
        kind: "response",
        response: apiErrorResponse("INTERNAL_ERROR", "The stored join result is unavailable.", 500),
      };
    }

    if (safeResult.ticket.ticketId !== row.ticket_id) {
      return {
        kind: "response",
        response: apiErrorResponse("INTERNAL_ERROR", "The stored join result is unavailable.", 500),
      };
    }

    const ticket = this.ctx.storage.sql
      .exec<{ session_id: string; capability_hash: string }>(
        "SELECT session_id, capability_hash FROM tickets WHERE ticket_id = ?",
        row.ticket_id,
      )
      .toArray()[0];
    if (!ticket || ticket.session_id !== row.session_id) {
      return {
        kind: "response",
        response: apiErrorResponse("INTERNAL_ERROR", "The stored join result is unavailable.", 500),
      };
    }

    let ticketCapability: string;
    try {
      ticketCapability = await decryptJoinCapabilityEnvelope(command.joinRecoverySecret, envelope, {
        queueId: command.queueId,
        sessionId: row.session_id,
        joinRequestId: command.joinRequestId,
        serviceId: command.serviceId,
        ticketId: row.ticket_id,
      });
    } catch (error) {
      if (error instanceof JoinRecoveryInvalidError) {
        return {
          kind: "response",
          response: apiErrorResponse(
            "JOIN_RECOVERY_INVALID",
            "The join recovery proof is invalid.",
            403,
          ),
        };
      }
      throw error;
    }

    const capabilityHash = await sha256Hex(ticketCapability);
    if (!equalHexDigest(capabilityHash, ticket.capability_hash)) {
      return {
        kind: "response",
        response: apiErrorResponse("INTERNAL_ERROR", "The stored join result is unavailable.", 500),
      };
    }
    const response = JoinQueueResponseSchema.parse({
      ...safeResult,
      ticketCapability,
    });
    return { kind: "response", response: jsonResponse(response, 201) };
  }

  private migrate(): void {
    const sql = this.ctx.storage.sql;
    this.ctx.storage.transactionSync(() => {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL
        );
      `);

      const row = sql
        .exec<{ version: number | null }>("SELECT MAX(version) AS version FROM schema_migrations")
        .one();
      const currentVersion = row.version ?? 0;
      if (currentVersion > CURRENT_SCHEMA_VERSION) {
        throw new Error(`Unsupported queue database schema version: ${currentVersion}`);
      }

      if (currentVersion < 1) {
        sql.exec(`
          CREATE TABLE IF NOT EXISTS queue_session (
            session_id TEXT PRIMARY KEY,
            queue_id TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('OPEN', 'PAUSED', 'CLOSED')),
            opened_at TEXT NOT NULL,
            closed_at TEXT,
            prefix TEXT NOT NULL,
            next_sequence INTEGER NOT NULL CHECK (next_sequence > 0),
            grace_period_seconds INTEGER NOT NULL CHECK (grace_period_seconds >= 0),
            service_capacity INTEGER NOT NULL CHECK (service_capacity > 0),
            config_snapshot_json TEXT NOT NULL,
            queue_revision INTEGER NOT NULL DEFAULT 0 CHECK (queue_revision >= 0),
            is_current INTEGER NOT NULL CHECK (is_current IN (0, 1)),
            CHECK (
              (status = 'CLOSED' AND is_current = 0)
              OR (status IN ('OPEN', 'PAUSED') AND is_current = 1)
            )
          );
          CREATE UNIQUE INDEX IF NOT EXISTS one_current_queue_session
          ON queue_session (is_current)
          WHERE is_current = 1;
        `);
        sql.exec(
          "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
          1,
          new Date().toISOString(),
        );
      }

      if (currentVersion < 2) {
        sql.exec(`
          CREATE TABLE IF NOT EXISTS command_receipts (
            command_id TEXT PRIMARY KEY,
            actor_scope_hash TEXT NOT NULL,
            command_type TEXT NOT NULL,
            request_fingerprint TEXT NOT NULL,
            result_json TEXT NOT NULL,
            result_revision INTEGER NOT NULL CHECK (result_revision >= 0),
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL
          );
        `);
        sql.exec(
          "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
          2,
          new Date().toISOString(),
        );
      }

      if (currentVersion < 3) {
        sql.exec(`
          CREATE TABLE IF NOT EXISTS tickets (
            ticket_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES queue_session(session_id),
            sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
            display_number TEXT NOT NULL,
            service_id TEXT NOT NULL,
            lifecycle_status TEXT NOT NULL CHECK (lifecycle_status IN (
              'WAITING', 'CALLED', 'SERVING', 'COMPLETED', 'SKIPPED', 'CANCELLED', 'EXPIRED'
            )),
            presence_status TEXT NOT NULL CHECK (presence_status IN (
              'UNKNOWN', 'AWAY', 'NEARBY', 'RETURNED'
            )),
            joined_at TEXT NOT NULL,
            called_at TEXT,
            grace_deadline TEXT,
            service_started_at TEXT,
            completed_at TEXT,
            cancelled_at TEXT,
            skipped_at TEXT,
            expired_at TEXT,
            call_count INTEGER NOT NULL DEFAULT 0 CHECK (call_count >= 0),
            capability_hash TEXT NOT NULL CHECK (length(capability_hash) = 64),
            last_mutation_revision INTEGER NOT NULL CHECK (last_mutation_revision >= 0),
            UNIQUE (session_id, sequence_number)
          );
          CREATE INDEX IF NOT EXISTS tickets_by_session_status_sequence
          ON tickets (session_id, lifecycle_status, sequence_number);

          CREATE TABLE IF NOT EXISTS events (
            event_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES queue_session(session_id),
            queue_revision INTEGER NOT NULL CHECK (queue_revision >= 0),
            event_type TEXT NOT NULL,
            ticket_id TEXT REFERENCES tickets(ticket_id),
            actor_type TEXT NOT NULL CHECK (actor_type IN ('CUSTOMER', 'MERCHANT', 'SYSTEM')),
            actor_id TEXT,
            occurred_at TEXT NOT NULL,
            safe_payload_json TEXT NOT NULL,
            UNIQUE (session_id, queue_revision)
          );

          CREATE TABLE IF NOT EXISTS join_receipts (
            join_request_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES queue_session(session_id),
            request_fingerprint TEXT NOT NULL CHECK (length(request_fingerprint) = 64),
            ticket_id TEXT NOT NULL REFERENCES tickets(ticket_id),
            safe_result_json TEXT NOT NULL,
            ticket_capability_envelope_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS join_receipts_by_expiry
          ON join_receipts (expires_at);
        `);
        sql.exec(
          "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
          3,
          new Date().toISOString(),
        );
      }
    });
  }
}

function insertCommandReceipt(
  sql: SqlStorage,
  commandId: string,
  actorScopeHash: string,
  commandType: string,
  requestFingerprint: string,
  result: StoredCommandResult,
  resultRevision: number,
  createdAt: string,
  expiresAt: string,
): void {
  sql.exec(
    `INSERT INTO command_receipts (
      command_id, actor_scope_hash, command_type, request_fingerprint, result_json,
      result_revision, created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    commandId,
    actorScopeHash,
    commandType,
    requestFingerprint,
    JSON.stringify(result),
    resultRevision,
    createdAt,
    expiresAt,
  );
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function equalHexDigest(actual: string, expected: string): boolean {
  if (actual.length !== 64 || !/^[a-f0-9]{64}$/.test(expected)) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual.charCodeAt(index) ^ (expected.charCodeAt(index) ?? 0);
  }
  return difference === 0;
}

function createCallNextErrorResult(
  code: "NO_WAITING_TICKETS" | "QUEUE_CLOSED",
  message: string,
): StoredCallNextResult {
  return StoredCallNextResultSchema.parse({
    status: 409,
    body: { error: { code, message } },
  });
}

function apiErrorResponse(
  code: InternalQueueApiErrorCode,
  message: string,
  status: number,
): Response {
  return jsonResponse({ error: { code, message } }, status);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
