import { describe, expect, it } from "vitest";
import {
  decryptJoinCapabilityEnvelope,
  encryptJoinCapabilityEnvelope,
  JoinRecoveryInvalidError,
  type JoinCapabilityContext,
} from "../src/join-recovery.js";

const recoverySecret = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const otherRecoverySecret = "A".repeat(43);
const ticketCapability = "opaque-ticket-capability";
const context: JoinCapabilityContext = {
  queueId: "queue_01",
  sessionId: "f907d0da-7b16-4a47-9f40-2ef7085e30f2",
  joinRequestId: "69ea98d3-9a5b-47ec-9eb2-268496aef87f",
  serviceId: "service_01",
  ticketId: "ticket_01",
};

describe("join capability recovery envelope", () => {
  it("encrypts the capability and recovers it for the same secret and context", async () => {
    const envelope = await encryptJoinCapabilityEnvelope(recoverySecret, ticketCapability, context);

    expect(envelope).toMatchObject({
      version: 1,
      kdf: "HKDF-SHA-256",
      cipher: "AES-256-GCM",
    });
    expect(envelope.salt).toHaveLength(22);
    expect(envelope.iv).toHaveLength(16);
    expect(JSON.stringify(envelope)).not.toContain(recoverySecret);
    expect(JSON.stringify(envelope)).not.toContain(ticketCapability);
    await expect(decryptJoinCapabilityEnvelope(recoverySecret, envelope, context)).resolves.toBe(
      ticketCapability,
    );
  });

  it("rejects a different recovery secret without exposing decryption details", async () => {
    const envelope = await encryptJoinCapabilityEnvelope(recoverySecret, ticketCapability, context);

    await expect(
      decryptJoinCapabilityEnvelope(otherRecoverySecret, envelope, context),
    ).rejects.toMatchObject({ code: "JOIN_RECOVERY_INVALID" });
  });

  it("rejects every context mismatch and a tampered ciphertext", async () => {
    const envelope = await encryptJoinCapabilityEnvelope(recoverySecret, ticketCapability, context);
    const changedContexts: JoinCapabilityContext[] = [
      { ...context, queueId: "queue_02" },
      { ...context, sessionId: "c8d48f26-af88-4857-95b7-17a8aff07152" },
      { ...context, joinRequestId: "4bb5166f-cc59-4601-9673-c284f4d035c0" },
      { ...context, serviceId: "service_02" },
      { ...context, ticketId: "ticket_02" },
    ];
    const firstCharacter = envelope.ciphertext[0] === "A" ? "B" : "A";
    const tamperedEnvelope = {
      ...envelope,
      ciphertext: `${firstCharacter}${envelope.ciphertext.slice(1)}`,
    };

    for (const changedContext of changedContexts) {
      await expect(
        decryptJoinCapabilityEnvelope(recoverySecret, envelope, changedContext),
      ).rejects.toBeInstanceOf(JoinRecoveryInvalidError);
    }
    await expect(
      decryptJoinCapabilityEnvelope(recoverySecret, tamperedEnvelope, context),
    ).rejects.toBeInstanceOf(JoinRecoveryInvalidError);
  });

  it("rejects unsupported envelope versions and unknown fields", async () => {
    const envelope = await encryptJoinCapabilityEnvelope(recoverySecret, ticketCapability, context);

    await expect(
      decryptJoinCapabilityEnvelope(recoverySecret, { ...envelope, version: 2 }, context),
    ).rejects.toBeInstanceOf(JoinRecoveryInvalidError);
    await expect(
      decryptJoinCapabilityEnvelope(recoverySecret, { ...envelope, ticketCapability }, context),
    ).rejects.toBeInstanceOf(JoinRecoveryInvalidError);
  });
});
