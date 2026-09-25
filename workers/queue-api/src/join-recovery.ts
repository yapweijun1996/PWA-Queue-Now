import { z } from "zod";

type WorkerBytes = Uint8Array<ArrayBuffer>;

const ENVELOPE_VERSION = 1;
const ENVELOPE_KEY_INFO = new TextEncoder().encode("QueueNow join capability recovery v1");
const MAX_ENCODED_CIPHERTEXT_LENGTH = 8192;

const JoinCapabilityContextSchema = z
  .object({
    queueId: z.string().min(1).max(128),
    sessionId: z.string().min(1).max(128),
    joinRequestId: z.string().uuid(),
    serviceId: z.string().min(1).max(128),
    ticketId: z.string().min(1).max(128),
  })
  .strict();

const JoinCapabilityEnvelopeSchema = z
  .object({
    version: z.literal(ENVELOPE_VERSION),
    kdf: z.literal("HKDF-SHA-256"),
    cipher: z.literal("AES-256-GCM"),
    salt: z.string().min(1).max(64),
    iv: z.string().min(1).max(32),
    ciphertext: z.string().min(1).max(MAX_ENCODED_CIPHERTEXT_LENGTH),
  })
  .strict();

export type JoinCapabilityContext = z.infer<typeof JoinCapabilityContextSchema>;
export type JoinCapabilityEnvelope = z.infer<typeof JoinCapabilityEnvelopeSchema>;

export class JoinRecoveryInvalidError extends Error {
  readonly code = "JOIN_RECOVERY_INVALID";

  constructor() {
    super("The join recovery proof is invalid.");
    this.name = "JoinRecoveryInvalidError";
  }
}

export async function encryptJoinCapabilityEnvelope(
  recoverySecret: string,
  ticketCapability: string,
  context: JoinCapabilityContext,
): Promise<JoinCapabilityEnvelope> {
  const secretBytes = decodeBase64Url(recoverySecret, 32);
  const parsedContext = JoinCapabilityContextSchema.parse(context);
  const capabilityBytes = new TextEncoder().encode(ticketCapability);
  if (
    ticketCapability.length === 0 ||
    new TextDecoder().decode(capabilityBytes) !== ticketCapability
  ) {
    throw new TypeError("Ticket capability must be a non-empty UTF-8 string.");
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveEnvelopeKey(secretBytes, salt, "encrypt");
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: serializeAdditionalData(parsedContext),
        tagLength: 128,
      },
      key,
      capabilityBytes,
    ),
  );
  const encodedCiphertext = encodeBase64Url(ciphertext);
  if (encodedCiphertext.length > MAX_ENCODED_CIPHERTEXT_LENGTH) {
    throw new RangeError("Ticket capability is too large to persist in a recovery envelope.");
  }

  return {
    version: ENVELOPE_VERSION,
    kdf: "HKDF-SHA-256",
    cipher: "AES-256-GCM",
    salt: encodeBase64Url(salt),
    iv: encodeBase64Url(iv),
    ciphertext: encodedCiphertext,
  };
}

export async function decryptJoinCapabilityEnvelope(
  recoverySecret: string,
  envelope: unknown,
  context: JoinCapabilityContext,
): Promise<string> {
  let secretBytes: WorkerBytes;
  let salt: WorkerBytes;
  let iv: WorkerBytes;
  let ciphertext: WorkerBytes;
  let additionalData: WorkerBytes;

  try {
    const parsedEnvelope = JoinCapabilityEnvelopeSchema.parse(envelope);
    secretBytes = decodeBase64Url(recoverySecret, 32);
    salt = decodeBase64Url(parsedEnvelope.salt, 16);
    iv = decodeBase64Url(parsedEnvelope.iv, 12);
    ciphertext = decodeBase64Url(parsedEnvelope.ciphertext);
    if (ciphertext.length <= 16) {
      throw new TypeError("The capability envelope is incomplete.");
    }
    additionalData = serializeAdditionalData(JoinCapabilityContextSchema.parse(context));
  } catch {
    throw new JoinRecoveryInvalidError();
  }

  const key = await deriveEnvelopeKey(secretBytes, salt, "decrypt");
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData, tagLength: 128 },
      key,
      ciphertext,
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "OperationError") {
      throw new JoinRecoveryInvalidError();
    }
    throw error;
  }

  try {
    const capability = new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
    if (capability.length === 0) {
      throw new TypeError("The decrypted capability is empty.");
    }
    return capability;
  } catch {
    throw new JoinRecoveryInvalidError();
  }
}

async function deriveEnvelopeKey(
  secretBytes: WorkerBytes,
  salt: WorkerBytes,
  usage: "encrypt" | "decrypt",
): Promise<CryptoKey> {
  const inputKey = await crypto.subtle.importKey("raw", secretBytes, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt,
      info: ENVELOPE_KEY_INFO,
    },
    inputKey,
    { name: "AES-GCM", length: 256 },
    false,
    [usage],
  );
}

function serializeAdditionalData(context: JoinCapabilityContext): WorkerBytes {
  return new TextEncoder().encode(
    JSON.stringify([
      "queuenow.join-capability",
      ENVELOPE_VERSION,
      context.queueId,
      context.sessionId,
      context.joinRequestId,
      context.serviceId,
      context.ticketId,
    ]),
  );
}

function decodeBase64Url(value: string, expectedLength?: number): WorkerBytes {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    throw new TypeError("Invalid base64url data.");
  }

  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (
    encodeBase64Url(bytes) !== value ||
    (expectedLength !== undefined && bytes.length !== expectedLength)
  ) {
    throw new TypeError("Invalid base64url data.");
  }
  return bytes;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
