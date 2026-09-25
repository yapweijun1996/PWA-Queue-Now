import { DurableObject } from "cloudflare:workers";

const CURRENT_SCHEMA_VERSION = 1;

export class QueueDurableObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.migrate();
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "GET" || url.pathname !== "/_internal/health") {
      return jsonResponse({ error: "Not found" }, 404);
    }

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
    });
  }
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
