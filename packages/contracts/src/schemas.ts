import { z } from "zod";
import { lifecycleStatuses, presenceStatuses, queueStatuses } from "./domain.js";

export const LifecycleStatusSchema = z.enum(lifecycleStatuses);
export const PresenceStatusSchema = z.enum(presenceStatuses);
export const QueueStatusSchema = z.enum(queueStatuses);

export const QueueRevisionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export type QueueRevision = z.infer<typeof QueueRevisionSchema>;

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

export const JoinQueueRequestSchema = z
  .object({
    joinRequestId: z.string().uuid(),
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
