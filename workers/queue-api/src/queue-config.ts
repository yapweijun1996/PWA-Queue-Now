import {
  DEFAULT_RETURN_WINDOW_BUFFER_SECONDS,
  QueueSessionConfigSnapshotSchema,
  type QueueSessionConfigSnapshot,
} from "@queuenow/contracts";

interface QueueConfigurationRow {
  readonly queueId: string;
  readonly publicSlug: string;
  readonly shopName: string;
  readonly prefix: string;
  readonly startSequence: number;
  readonly gracePeriodSeconds: number;
  readonly serviceCapacity: number;
  readonly serviceId: string | null;
  readonly serviceName: string | null;
  readonly defaultDurationSeconds: number | null;
}

export interface ResolvedQueueConfiguration {
  readonly queueId: string;
  readonly publicSlug: string;
  readonly shopName: string;
  readonly configSnapshot: QueueSessionConfigSnapshot;
}

export class InvalidQueueConfigurationError extends Error {
  readonly code = "QUEUE_CONFIGURATION_INVALID";

  constructor() {
    super("The stored queue configuration is invalid.");
    this.name = "InvalidQueueConfigurationError";
  }
}

export function loadPublicQueueConfiguration(
  database: D1Database,
  publicSlug: string,
): Promise<ResolvedQueueConfiguration | null> {
  return loadQueueConfiguration(database, { kind: "publicSlug", value: publicSlug });
}

/** Call only after authenticating and authorizing merchant access to the queue. */
export function loadQueueConfigurationById(
  database: D1Database,
  queueId: string,
): Promise<ResolvedQueueConfiguration | null> {
  return loadQueueConfiguration(database, { kind: "queueId", value: queueId });
}

async function loadQueueConfiguration(
  database: D1Database,
  selector: { readonly kind: "queueId" | "publicSlug"; readonly value: string },
): Promise<ResolvedQueueConfiguration | null> {
  const selectorSql = selector.kind === "queueId" ? "q.queue_id = ?" : "q.public_slug = ?";
  // Read queue and services in one statement so the snapshot cannot mix config revisions.
  const queueResult = await database
    .prepare(
      `SELECT
         q.queue_id AS queueId,
         q.public_slug AS publicSlug,
         s.name AS shopName,
         q.prefix AS prefix,
         q.start_sequence AS startSequence,
         q.grace_period_seconds AS gracePeriodSeconds,
         q.service_capacity AS serviceCapacity,
         svc.service_id AS serviceId,
         svc.name AS serviceName,
         svc.default_duration_seconds AS defaultDurationSeconds
       FROM queue_definitions AS q
       INNER JOIN shops AS s ON s.shop_id = q.shop_id
       INNER JOIN merchants AS m ON m.merchant_id = s.owner_merchant_id
       LEFT JOIN services AS svc ON svc.shop_id = q.shop_id AND svc.active = 1
       WHERE ${selectorSql}
         AND q.status = 'ACTIVE'
         AND s.status = 'ACTIVE'
         AND m.status = 'ACTIVE'
       ORDER BY svc.sort_order ASC, svc.service_id ASC
       LIMIT 101`,
    )
    .bind(selector.value)
    .all<QueueConfigurationRow>();
  const queue = queueResult.results[0];
  if (!queue) {
    return null;
  }

  const services = queueResult.results.flatMap((row) => {
    if (row.serviceId === null) {
      if (row.serviceName !== null || row.defaultDurationSeconds !== null) {
        throw new InvalidQueueConfigurationError();
      }
      return [];
    }
    if (row.serviceName === null || row.defaultDurationSeconds === null) {
      throw new InvalidQueueConfigurationError();
    }
    return [
      {
        serviceId: row.serviceId,
        name: row.serviceName,
        defaultDurationSeconds: row.defaultDurationSeconds,
      },
    ];
  });

  const parsedConfig = QueueSessionConfigSnapshotSchema.safeParse({
    prefix: queue.prefix,
    startSequence: queue.startSequence,
    gracePeriodSeconds: queue.gracePeriodSeconds,
    serviceCapacity: queue.serviceCapacity,
    returnWindowBufferSeconds: DEFAULT_RETURN_WINDOW_BUFFER_SECONDS,
    services,
  });
  if (!parsedConfig.success) {
    throw new InvalidQueueConfigurationError();
  }

  return {
    queueId: queue.queueId,
    publicSlug: queue.publicSlug,
    shopName: queue.shopName.trim(),
    configSnapshot: parsedConfig.data,
  };
}
