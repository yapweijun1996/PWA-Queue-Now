import { z } from "zod";
import { lifecycleStatuses, presenceStatuses, queueStatuses } from "./domain.js";

export const LifecycleStatusSchema = z.enum(lifecycleStatuses);
export const PresenceStatusSchema = z.enum(presenceStatuses);
export const QueueStatusSchema = z.enum(queueStatuses);

export const QueueRevisionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export type QueueRevision = z.infer<typeof QueueRevisionSchema>;

export const DEFAULT_RETURN_WINDOW_BUFFER_SECONDS = 300;

const QueueSessionServiceSnapshotSchema = z
  .object({
    serviceId: z.string().min(1).max(128),
    name: z.string().trim().min(1).max(120),
    defaultDurationSeconds: z.number().int().min(1),
  })
  .strict();

export const QueueSessionConfigSnapshotSchema = z
  .object({
    prefix: z.string().regex(/^[A-Z0-9]{1,8}$/),
    startSequence: z
      .number()
      .int()
      .min(1)
      .max(Number.MAX_SAFE_INTEGER - 1),
    gracePeriodSeconds: z.number().int().min(0),
    serviceCapacity: z.number().int().min(1),
    returnWindowBufferSeconds: z.literal(DEFAULT_RETURN_WINDOW_BUFFER_SECONDS),
    services: z.array(QueueSessionServiceSnapshotSchema).min(1).max(100),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const seenServiceIds = new Set<string>();
    snapshot.services.forEach((service, index) => {
      if (seenServiceIds.has(service.serviceId)) {
        context.addIssue({
          code: "custom",
          message: "Service IDs must be unique within a queue session snapshot.",
          path: ["services", index, "serviceId"],
        });
      }
      seenServiceIds.add(service.serviceId);
    });
  });
export type QueueSessionConfigSnapshot = z.infer<typeof QueueSessionConfigSnapshotSchema>;

export const OpenQueueSessionRequestSchema = z
  .object({
    commandId: z.string().uuid(),
  })
  .strict();

export const OpenQueueSessionResponseSchema = z
  .object({
    sessionId: z.string().uuid(),
    queueId: z.string().min(1).max(128),
    status: z.literal("OPEN"),
    openedAt: z.iso.datetime({ offset: false }),
    queueRevision: z.literal(0),
  })
  .strict();
export type OpenQueueSessionRequest = z.infer<typeof OpenQueueSessionRequestSchema>;
export type OpenQueueSessionResponse = z.infer<typeof OpenQueueSessionResponseSchema>;

export const QueueChangedEventSchema = z
  .object({
    type: z.literal("queue.changed"),
    queueRevision: QueueRevisionSchema,
    occurredAt: z.iso.datetime({ offset: false }),
  })
  .strict();
export type QueueChangedEvent = z.infer<typeof QueueChangedEventSchema>;

const ReturnWindowSchema = z
  .object({
    from: z.iso.datetime({ offset: false }),
    to: z.iso.datetime({ offset: false }),
  })
  .strict()
  .refine((window) => Date.parse(window.from) <= Date.parse(window.to), {
    message: "The return-window start must not be after its end.",
  });

const CustomerTicketSnapshotSchema = z
  .object({
    ticketId: z.string().min(1),
    displayNumber: z.string().min(1),
    lifecycleStatus: LifecycleStatusSchema,
    presenceStatus: PresenceStatusSchema,
    peopleAhead: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    returnWindow: ReturnWindowSchema,
    queueRevision: QueueRevisionSchema,
  })
  .strict();

const JoinRecoverySecretSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/,
    "Expected unpadded base64url encoding of 32 bytes.",
  );

export const JoinQueueRequestSchema = z
  .object({
    joinRequestId: z.string().uuid(),
    joinRecoverySecret: JoinRecoverySecretSchema,
    serviceId: z.string().min(1),
  })
  .strict();

export const JoinQueueResponseSchema = z
  .object({
    ticket: CustomerTicketSnapshotSchema,
    ticketCapability: z.string().min(1),
  })
  .strict();

export const UpdatePresenceRequestSchema = z
  .object({
    commandId: z.string().uuid(),
    presence: PresenceStatusSchema,
  })
  .strict();

export const CancelTicketRequestSchema = z
  .object({
    commandId: z.string().uuid(),
  })
  .strict();

export type JoinQueueRequest = z.infer<typeof JoinQueueRequestSchema>;
export type JoinQueueResponse = z.infer<typeof JoinQueueResponseSchema>;
export type UpdatePresenceRequest = z.infer<typeof UpdatePresenceRequestSchema>;
export type CancelTicketRequest = z.infer<typeof CancelTicketRequestSchema>;
