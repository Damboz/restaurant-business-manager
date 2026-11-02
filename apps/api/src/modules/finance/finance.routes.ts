import { Router, type Request } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { stringParam } from "../../lib/request-params.js";
import { requirePermission } from "../../middleware/restaurant.js";
import { validateBody } from "../../middleware/validate.js";
import {
  createOwnerTransaction,
  listOpeningBalances,
  listOwnerTransactions,
  upsertOpeningBalance,
  voidOwnerTransaction
} from "./finance.service.js";
import {
  createOwnerTransactionSchema,
  listOwnerTransactionsQuerySchema,
  openingBalanceSchema,
  voidOwnerTransactionSchema
} from "./finance.schemas.js";

function restaurantIdFrom(request: Request): string {
  return stringParam(request.params.restaurantId)!;
}
function metaFrom(request: Request) {
  return { ip: request.ip, userAgent: request.get("user-agent") };
}

export const financeRouter = Router({ mergeParams: true });

financeRouter.get(
  "/owner-transactions",
  requirePermission("finance.view"),
  asyncHandler(async (request, response) => {
    const query = listOwnerTransactionsQuerySchema.parse(request.query);
    response.json({
      data: await listOwnerTransactions(restaurantIdFrom(request), query)
    });
  })
);

financeRouter.post(
  "/owner-transactions",
  requirePermission("finance.manage"),
  validateBody(createOwnerTransactionSchema),
  asyncHandler(async (request, response) => {
    const transaction = await createOwnerTransaction(
      restaurantIdFrom(request),
      request.user!.id,
      request.body,
      metaFrom(request)
    );
    response.status(201).json({ data: { transaction } });
  })
);

financeRouter.post(
  "/owner-transactions/:transactionId/void",
  requirePermission("finance.manage"),
  validateBody(voidOwnerTransactionSchema),
  asyncHandler(async (request, response) => {
    const transaction = await voidOwnerTransaction(
      restaurantIdFrom(request),
      request.user!.id,
      stringParam(request.params.transactionId)!,
      request.body.reason,
      metaFrom(request)
    );
    response.json({ data: { transaction } });
  })
);

financeRouter.get(
  "/opening-balances",
  requirePermission("finance.view"),
  asyncHandler(async (request, response) => {
    response.json({
      data: { balances: await listOpeningBalances(restaurantIdFrom(request)) }
    });
  })
);

financeRouter.post(
  "/opening-balances",
  requirePermission("finance.manage"),
  validateBody(openingBalanceSchema),
  asyncHandler(async (request, response) => {
    const balance = await upsertOpeningBalance(
      restaurantIdFrom(request),
      request.user!.id,
      request.body,
      metaFrom(request)
    );
    response.status(201).json({ data: { balance } });
  })
);
