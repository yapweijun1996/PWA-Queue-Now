import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("Queue API Worker runtime", () => {
  it("serves only the public health route", async () => {
    const context = createExecutionContext();
    const healthResponse = await exports.default.fetch(
      new Request("https://queuenow.test/health"),
      env,
      context,
    );
    await waitOnExecutionContext(context);

    expect(healthResponse.status).toBe(200);
    expect(await healthResponse.json()).toEqual({ status: "ok" });

    const internalResponse = await exports.default.fetch(
      new Request("https://queuenow.test/_internal/health"),
      env,
      createExecutionContext(),
    );
    expect(internalResponse.status).toBe(404);
  });

  it("creates the SQLite schema once and reads it through the Durable Object binding", async () => {
    const id = env.QUEUES.idFromName("queue-schema-test");
    const stub = env.QUEUES.get(id);
    const url = "https://queue-do.test/_internal/health";

    const firstResponse = await stub.fetch(url);
    const secondResponse = await stub.fetch(url);

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(await secondResponse.json()).toEqual({
      status: "ok",
      schemaVersion: 1,
      sessionCount: 0,
    });
  });
});
