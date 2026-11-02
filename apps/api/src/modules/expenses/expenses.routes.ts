import { Router, type Request } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { stringParam } from "../../lib/request-params.js";
import { requirePermission } from "../../middleware/restaurant.js";
import { validateBody } from "../../middleware/validate.js";
import {
  createExpense,
  getExpense,
  listExpenseCategories,
  listExpenses,
  voidExpense
} from "./expenses.service.js";
import {
  expenseSchema,
  listExpensesQuerySchema,
  voidExpenseSchema
} from "./expenses.schemas.js";

function restaurantIdFrom(request: Request): string {
  return stringParam(request.params.restaurantId)!;
}
function metaFrom(request: Request) {
  return { ip: request.ip, userAgent: request.get("user-agent") };
}

export const expensesRouter = Router({ mergeParams: true });

expensesRouter.get(
  "/",
  requirePermission("expenses.view"),
  asyncHandler(async (request, response) => {
    const query = listExpensesQuerySchema.parse(request.query);
    response.json({ data: await listExpenses(restaurantIdFrom(request), query) });
  })
);

expensesRouter.get(
  "/categories",
  requirePermission("expenses.view"),
  asyncHandler(async (request, response) => {
    response.json({
      data: { categories: await listExpenseCategories(restaurantIdFrom(request)) }
    });
  })
);

expensesRouter.get(
  "/:expenseId",
  requirePermission("expenses.view"),
  asyncHandler(async (request, response) => {
    response.json({
      data: {
        expense: await getExpense(
          restaurantIdFrom(request),
          stringParam(request.params.expenseId)!
        )
      }
    });
  })
);

expensesRouter.post(
  "/",
  requirePermission("expenses.create"),
  validateBody(expenseSchema),
  asyncHandler(async (request, response) => {
    const expense = await createExpense(
      restaurantIdFrom(request),
      request.user!.id,
      request.body,
      metaFrom(request)
    );
    response.status(201).json({ data: { expense } });
  })
);

expensesRouter.post(
  "/:expenseId/void",
  requirePermission("expenses.void"),
  validateBody(voidExpenseSchema),
  asyncHandler(async (request, response) => {
    const expense = await voidExpense(
      restaurantIdFrom(request),
      request.user!.id,
      stringParam(request.params.expenseId)!,
      request.body.reason,
      metaFrom(request)
    );
    response.json({ data: { expense } });
  })
);
