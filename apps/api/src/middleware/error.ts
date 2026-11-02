import type { ErrorRequestHandler, RequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { AppError } from "../lib/errors.js";
import { env } from "../config/env.js";

type ErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

function sendError(
  statusCode: number,
  code: string,
  message: string,
  details?: unknown
): { statusCode: number; body: ErrorBody } {
  const body: ErrorBody = {
    error: {
      code,
      message
    }
  };

  if (details !== undefined) {
    body.error.details = details;
  }

  return { statusCode, body };
}

export const notFoundHandler: RequestHandler = (request, response) => {
  const { statusCode, body } = sendError(
    404,
    "NOT_FOUND",
    `No route matches ${request.method} ${request.originalUrl}`
  );

  response.status(statusCode).json(body);
};

export const errorHandler: ErrorRequestHandler = (error, _request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  if (error instanceof AppError) {
    const { statusCode, code, message, details } = error;
    const payload = sendError(statusCode, code, message, details);
    response.status(payload.statusCode).json(payload.body);
    return;
  }

  if (error instanceof ZodError) {
    const payload = sendError(
      400,
      "VALIDATION_ERROR",
      "Please correct the highlighted fields",
      error.issues.map((issue) => ({
        field: issue.path.map(String).join(".") || "body",
        message: issue.message
      }))
    );

    response.status(payload.statusCode).json(payload.body);
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      const payload = sendError(409, "CONFLICT", "A record with these details already exists");
      response.status(payload.statusCode).json(payload.body);
      return;
    }

    if (error.code === "P2025") {
      const payload = sendError(404, "NOT_FOUND", "The requested record was not found");
      response.status(payload.statusCode).json(payload.body);
      return;
    }
  }

  if (
    error instanceof SyntaxError &&
    "status" in error &&
    (error as SyntaxError & { status?: number }).status === 400
  ) {
    const payload = sendError(400, "INVALID_JSON", "The request body is not valid JSON");
    response.status(payload.statusCode).json(payload.body);
    return;
  }

  console.error(error);

  const payload = sendError(
    500,
    "INTERNAL_ERROR",
    env.isProduction ? "Something went wrong" : "An unexpected error occurred"
  );

  response.status(payload.statusCode).json(payload.body);
};
