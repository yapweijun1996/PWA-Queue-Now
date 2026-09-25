import { describe, expect, it } from "vitest";
import {
  CancelTicketRequestSchema,
  JoinQueueRequestSchema,
  JoinQueueResponseSchema,
  OpenQueueSessionRequestSchema,
  OpenQueueSessionResponseSchema,
  QueueChangedEventSchema,
  QueueSessionConfigSnapshotSchema,
  QueueRevisionSchema,
  UpdatePresenceRequestSchema,
} from "../src/index.js";

const validJoinResponse = {
  ticket: {
    ticketId: "ticket_01",
    displayNumber: "A025",
    lifecycleStatus: "WAITING",
    presenceStatus: "UNKNOWN",
    peopleAhead: 3,
    returnWindow: {
      from: "2026-09-25T13:30:00Z",
      to: "2026-09-25T13:40:00Z",
    },
    queueRevision: 42,
  },
  ticketCapability: "opaque-capability",
};

describe("customer API schemas", () => {
  it("accepts a valid anonymous join request", () => {
    expect(
      JoinQueueRequestSchema.parse({
        joinRequestId: "e6a0180e-f189-4a6f-b254-3e2e03497b47",
        serviceId: "service_01",
      }),
    ).toEqual({
      joinRequestId: "e6a0180e-f189-4a6f-b254-3e2e03497b47",
      serviceId: "service_01",
    });
  });

  it("rejects malformed join identifiers and unknown request fields", () => {
    expect(
      JoinQueueRequestSchema.safeParse({
        joinRequestId: "not-a-uuid",
        serviceId: "service_01",
      }).success,
    ).toBe(false);
    expect(
      JoinQueueRequestSchema.safeParse({
        joinRequestId: "e6a0180e-f189-4a6f-b254-3e2e03497b47",
        serviceId: "service_01",
        customerName: "Not collected in V1",
      }).success,
    ).toBe(false);
  });

  it("validates the join response and rejects reversed return windows", () => {
    expect(JoinQueueResponseSchema.parse(validJoinResponse)).toEqual(validJoinResponse);
    expect(
      JoinQueueResponseSchema.safeParse({
        ...validJoinResponse,
        ticket: {
          ...validJoinResponse.ticket,
          returnWindow: {
            from: "2026-09-25T13:40:00Z",
            to: "2026-09-25T13:30:00Z",
          },
        },
      }).success,
    ).toBe(false);
  });

  it("rejects unsafe queue revisions", () => {
    expect(QueueRevisionSchema.safeParse(-1).success).toBe(false);
    expect(QueueRevisionSchema.safeParse(Number.MAX_SAFE_INTEGER + 1).success).toBe(false);
    expect(QueueRevisionSchema.safeParse(42).success).toBe(true);
    expect(QueueRevisionSchema.safeParse(Number.MAX_SAFE_INTEGER).success).toBe(true);
  });

  it("validates presence and cancel command identifiers", () => {
    expect(
      UpdatePresenceRequestSchema.safeParse({
        commandId: "02f8fcd6-3d5a-4e10-ae40-2f5a90e8a223",
        presence: "NEARBY",
      }).success,
    ).toBe(true);
    expect(
      UpdatePresenceRequestSchema.safeParse({
        commandId: "02f8fcd6-3d5a-4e10-ae40-2f5a90e8a223",
        presence: "CALLED",
      }).success,
    ).toBe(false);
    expect(
      CancelTicketRequestSchema.safeParse({
        commandId: "02f8fcd6-3d5a-4e10-ae40-2f5a90e8a223",
      }).success,
    ).toBe(true);
  });
});

describe("merchant queue session schemas", () => {
  const validConfigSnapshot = {
    prefix: "A",
    startSequence: 25,
    gracePeriodSeconds: 300,
    serviceCapacity: 2,
    services: [
      {
        serviceId: "service_01",
        name: " Haircut ",
        defaultDurationSeconds: 1800,
      },
    ],
  };

  it("validates the public open command and snapshots service settings", () => {
    expect(
      OpenQueueSessionRequestSchema.parse({
        commandId: "f907d0da-7b16-4a47-9f40-2ef7085e30f2",
      }),
    ).toEqual({ commandId: "f907d0da-7b16-4a47-9f40-2ef7085e30f2" });
    expect(QueueSessionConfigSnapshotSchema.parse(validConfigSnapshot)).toMatchObject({
      prefix: "A",
      startSequence: 25,
      services: [{ name: "Haircut" }],
    });
    expect(
      OpenQueueSessionResponseSchema.parse({
        sessionId: "f907d0da-7b16-4a47-9f40-2ef7085e30f2",
        queueId: "queue_01",
        status: "OPEN",
        openedAt: "2026-09-25T13:40:00Z",
        queueRevision: 0,
      }).status,
    ).toBe("OPEN");
  });

  it("rejects unsafe sequence values, duplicate services, and client-supplied actor scopes", () => {
    expect(
      QueueSessionConfigSnapshotSchema.safeParse({
        ...validConfigSnapshot,
        startSequence: Number.MAX_SAFE_INTEGER,
      }).success,
    ).toBe(false);
    expect(
      QueueSessionConfigSnapshotSchema.safeParse({
        ...validConfigSnapshot,
        services: [...validConfigSnapshot.services, ...validConfigSnapshot.services],
      }).success,
    ).toBe(false);
    expect(
      OpenQueueSessionRequestSchema.safeParse({
        commandId: "f907d0da-7b16-4a47-9f40-2ef7085e30f2",
        actorScope: "client-controlled",
      }).success,
    ).toBe(false);
  });
});

describe("realtime event schema", () => {
  const validEvent = {
    type: "queue.changed",
    queueRevision: 42,
    occurredAt: "2026-09-25T13:40:00Z",
  };

  it("accepts a payload-free queue change notification", () => {
    expect(QueueChangedEventSchema.parse(validEvent)).toEqual(validEvent);
  });

  it("rejects private payloads and invalid event metadata", () => {
    expect(
      QueueChangedEventSchema.safeParse({
        ...validEvent,
        payload: { ticketCapability: "must-not-be-broadcast" },
      }).success,
    ).toBe(false);
    expect(
      QueueChangedEventSchema.safeParse({ ...validEvent, type: "ticket.updated" }).success,
    ).toBe(false);
    expect(QueueChangedEventSchema.safeParse({ ...validEvent, queueRevision: -1 }).success).toBe(
      false,
    );
  });
});
