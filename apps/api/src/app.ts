import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env.js";
import { asyncHandler } from "./lib/async-handler.js";
import { pool } from "./lib/db.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { restaurantsRouter } from "./modules/restaurants/restaurants.routes.js";

export function createApp(): express.Express {
  const app = express();

  app.disable("x-powered-by");

  if (env.trustProxy) {
    app.set("trust proxy", 1);
  }

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" }
    })
  );
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || env.corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }

        callback(new Error("Origin is not allowed by CORS"));
      },
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Restaurant-Id"],
      maxAge: 86_400
    })
  );
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/v1/health", (_request, response) => {
    response.json({
      data: {
        status: "ok",
        timestamp: new Date().toISOString()
      }
    });
  });

  app.get(
    "/api/v1/health/ready",
    asyncHandler(async (_request, response) => {
      await pool.query("SELECT 1");

      response.json({
        data: {
          status: "ready",
          database: "reachable",
          timestamp: new Date().toISOString()
        }
      });
    })
  );

  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/restaurants", restaurantsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export const app = createApp();
