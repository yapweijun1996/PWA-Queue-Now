import {
  OpenQueueSessionRequestSchema,
  OpenQueueSessionResponseSchema,
  QueueSessionConfigSnapshotSchema,
} from "@queuenow/contracts";
import { QueueDomainError, resolveCommandReceipt, type CommandReceipt } from "@queuenow/queue-core";
import { DurableObject } from "cloudflare:workers";
import { z } from "zod";

const CURRENT_SCHEMA_VERSION = 2;
const OPEN_SESSION_COMMAND_TYPE = "OPEN_QUEUE_SESSION";
const COMMAND_RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;

const InternalOpenQueueSessionIdentitySchema = OpenQueueSessionRequestSchema.extend({
  actorScope: z.string().min(1).max(128),
  queueId: z.string().min(1).max(128),
}).passthrough();

const InternalOpenQueueSessionCommandSchema = InternalOpenQueueSessionIdentitySchema.extend({
  configSnapshot: QueueSessionConfigSnapshotSchema,
}).strict();

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

type StoredOpenSessionResult = z.infer<typeof StoredOpenSessionResultSchema>;
type InternalQueueApiErrorCode =
  | "IDEMPOTENCY_CONFLICT"
  | "INVALID_REQUEST"
  | "QUEUE_CONFIG_REQUIRED"
  | "QUEUE_ID_MISMATCH";
type OpenSessionOutcome =
  | { readonly kind: "result"; readonly result: StoredOpenSessionResult }
  | { readonly kind: "idempotency-conflict" }
  | { readonly kind: "queue-id-mismatch" }
  | { readonly kind: "queue-config-required" }
  | { readonly kind: "invalid-request" };

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

    // The public Worker must authenticate and authorize before forwarding this internal command.
    if (request.method === "POST" && url.pathname === "/_internal/sessions/open") {
      return this.openQueueSession(request);
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
        const storedReceipt: CommandReceipt<StoredOpenSessionResult> = {
          commandId: storedRow.command_id,
          actorScope: storedRow.actor_scope_hash,
          commandType: storedRow.command_type,
          requestFingerprint: storedRow.request_fingerprint,
          result: StoredOpenSessionResultSchema.parse(JSON.parse(storedRow.result_json)),
        };

        try {
          const resolution = resolveCommandReceipt(storedReceipt, {
            commandId: identity.data.commandId,
            actorScope: actorScopeHash,
            commandType: OPEN_SESSION_COMMAND_TYPE,
            requestFingerprint,
          });
          if (resolution.kind === "execute") {
            throw new Error("An existing command receipt cannot resolve to execute.");
          }
          return { kind: "result", result: resolution.result };
        } catch (error) {
          if (error instanceof QueueDomainError && error.code === "IDEMPOTENCY_CONFLICT") {
            return { kind: "idempotency-conflict" };
          }
          throw error;
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

    return jsonResponse(outcome.result.body, outcome.result.status);
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
    });
  }
}

function insertCommandReceipt(
  sql: SqlStorage,
  commandId: string,
  actorScopeHash: string,
  requestFingerprint: string,
  result: StoredOpenSessionResult,
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
    OPEN_SESSION_COMMAND_TYPE,
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
