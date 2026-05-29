import request from "supertest";
import { describe, expect, it } from "vitest";
import { createDefaultWorkspace } from "@/domain/defaults";
import { createAppForTest } from "./app";

describe("server app", () => {
  it("returns seeded agents and runtimes", async () => {
    const app = createAppForTest(createDefaultWorkspace("2026-05-29T00:00:00.000Z"));

    const agents = await request(app).get("/api/agents").expect(200);
    const runtimes = await request(app).get("/api/model-runtimes").expect(200);

    expect(agents.body).toHaveLength(1);
    expect(runtimes.body.some((runtime: { adapter: string }) => runtime.adapter === "ollama")).toBe(
      true,
    );
  });

  it("creates a simulated call with an initial event", async () => {
    const app = createAppForTest(createDefaultWorkspace("2026-05-29T00:00:00.000Z"));
    const agentId = (await request(app).get("/api/agents")).body[0].id;

    const response = await request(app)
      .post("/api/calls/simulate")
      .send({ agentId })
      .expect(201);

    expect(response.body.call.status).toBe("connected");
    expect(response.body.events[0].payload.status).toBe("connected");
  });
});
