import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../src/app.js";

describe("HTTP app", () => {
  it("returns a health response", async () => {
    const response = await request(app).get("/api/v1/health");

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("ok");
  });

  it("returns a structured 404", async () => {
    const response = await request(app).get("/api/v1/missing");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("validates registration bodies", async () => {
    const response = await request(app).post("/api/v1/auth/register").send({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("BAD_REQUEST");
  });

  it("protects restaurant routes with authentication", async () => {
    const response = await request(app).get("/api/v1/restaurants");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("protects team routes with authentication", async () => {
    const response = await request(app).get(
      "/api/v1/restaurants/00000000-0000-0000-0000-000000000000/users"
    );

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });
});
