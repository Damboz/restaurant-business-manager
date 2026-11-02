import type { RequestHandler } from "express";
import type { ZodType } from "zod";
import { BadRequestError } from "../lib/errors.js";

export function validateBody(schema: ZodType): RequestHandler {
  return (request, _response, next) => {
    const result = schema.safeParse(request.body);

    if (!result.success) {
      throw new BadRequestError(
        "Please correct the highlighted fields",
        result.error.issues.map((issue) => ({
          field: issue.path.map(String).join(".") || "body",
          message: issue.message
        }))
      );
    }

    request.body = result.data;
    next();
  };
}
