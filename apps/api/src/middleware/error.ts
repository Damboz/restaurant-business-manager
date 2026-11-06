import type { ErrorRequestHandler, RequestHandler } from "express";
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

type PostgresError = {
  code?: string;
  constraint?: string;
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

function isPostgresError(error: unknown): error is PostgresError {
  return typeof error === "object" && error !== null && "code" in error;
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

  if (isPostgresError(error)) {
    if (error.code === "23505") {
      const payload = sendError(409, "CONFLICT", "A record with these details already exists");
      response.status(payload.statusCode).json(payload.body);
      return;
    }

    if (error.code === "23503") {
      const payload = sendError(
        400,
        "BAD_REQUEST",
        "A referenced record does not exist or is still in use"
      );
      response.status(payload.statusCode).json(payload.body);
      return;
    }

    if (error.code === "22P02" || error.code === "23514") {
      const payload = sendError(400, "BAD_REQUEST", "The request contains invalid values");
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
