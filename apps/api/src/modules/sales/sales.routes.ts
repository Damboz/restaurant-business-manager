import { Router, type Request } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { stringParam } from "../../lib/request-params.js";
import { requirePermission } from "../../middleware/restaurant.js";
import { validateBody } from "../../middleware/validate.js";
import { createSale, getSale, listSales, voidSale } from "./sales.service.js";
import { listSalesQuerySchema, saleSchema, voidSaleSchema } from "./sales.schemas.js";

function restaurantIdFrom(request: Request): string {
  return stringParam(request.params.restaurantId)!;
}
function metaFrom(request: Request) {
  return { ip: request.ip, userAgent: request.get("user-agent") };
}

export const salesRouter = Router({ mergeParams: true });

salesRouter.get(
  "/",
  requirePermission("sales.view"),
  asyncHandler(async (request, response) => {
    const query = listSalesQuerySchema.parse(request.query);
    response.json({ data: await listSales(restaurantIdFrom(request), query) });
  })
);

salesRouter.get(
  "/:saleId",
  requirePermission("sales.view"),
  asyncHandler(async (request, response) => {
    response.json({
      data: {
        sale: await getSale(restaurantIdFrom(request), stringParam(request.params.saleId)!)
      }
    });
  })
);

salesRouter.post(
  "/",
  requirePermission("sales.create"),
  validateBody(saleSchema),
  asyncHandler(async (request, response) => {
    if (request.body.source === "MANUAL") {
      if (!request.permissions?.has("sales.manual")) {
        response.status(403).json({
          error: {
            code: "FORBIDDEN",
            message: "You do not have permission to record manual sales"
          }
        });
        return;
      }
    }

    const sale = await createSale(
      restaurantIdFrom(request),
      request.user!.id,
      request.body,
      metaFrom(request)
    );
    response.status(201).json({ data: { sale } });
  })
);

salesRouter.post(
  "/:saleId/void",
  requirePermission("sales.void"),
  validateBody(voidSaleSchema),
  asyncHandler(async (request, response) => {
    const sale = await voidSale(
      restaurantIdFrom(request),
      request.user!.id,
      stringParam(request.params.saleId)!,
      request.body.reason,
      metaFrom(request)
    );
    response.json({ data: { sale } });
  })
);
