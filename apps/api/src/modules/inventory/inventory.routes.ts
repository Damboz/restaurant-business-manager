import { Router, type Request } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { stringParam } from "../../lib/request-params.js";
import { requirePermission } from "../../middleware/restaurant.js";
import { validateBody } from "../../middleware/validate.js";
import {
  createInventoryCategory,
  createInventoryItem,
  createStockAdjustment,
  createStockPurchase,
  getInventoryItem,
  getStockPurchase,
  listInventoryCategories,
  listInventoryItems,
  listStockMovements,
  listStockPurchases,
  updateInventoryCategory,
  updateInventoryItem
} from "./inventory.service.js";
import {
  inventoryCategorySchema,
  inventoryItemSchema,
  listInventoryQuerySchema,
  listMovementsQuerySchema,
  stockAdjustmentSchema,
  stockPurchaseSchema,
  updateInventoryCategorySchema,
  updateInventoryItemSchema
} from "./inventory.schemas.js";
import { paginationSchema } from "@rbm/shared";

function restaurantIdFrom(request: Request): string {
  return stringParam(request.params.restaurantId)!;
}
function metaFrom(request: Request) {
  return { ip: request.ip, userAgent: request.get("user-agent") };
}

export const inventoryCategoriesRouter = Router({ mergeParams: true });

inventoryCategoriesRouter.get(
  "/",
  requirePermission("stock.view"),
  asyncHandler(async (request, response) => {
    response.json({
      data: { categories: await listInventoryCategories(restaurantIdFrom(request)) }
    });
  })
);

inventoryCategoriesRouter.post(
  "/",
  requirePermission("stock.manage"),
  validateBody(inventoryCategorySchema),
  asyncHandler(async (request, response) => {
    const category = await createInventoryCategory(
      restaurantIdFrom(request),
      request.user!.id,
      request.body,
      metaFrom(request)
    );
    response.status(201).json({ data: { category } });
  })
);

inventoryCategoriesRouter.patch(
  "/:categoryId",
  requirePermission("stock.manage"),
  validateBody(updateInventoryCategorySchema),
  asyncHandler(async (request, response) => {
    const category = await updateInventoryCategory(
      restaurantIdFrom(request),
      request.user!.id,
      stringParam(request.params.categoryId)!,
      request.body,
      metaFrom(request)
    );
    response.json({ data: { category } });
  })
);

export const inventoryRouter = Router({ mergeParams: true });

inventoryRouter.get(
  "/",
  requirePermission("stock.view"),
  asyncHandler(async (request, response) => {
    const query = listInventoryQuerySchema.parse(request.query);
    response.json({ data: await listInventoryItems(restaurantIdFrom(request), query) });
  })
);

inventoryRouter.get(
  "/:itemId",
  requirePermission("stock.view"),
  asyncHandler(async (request, response) => {
    response.json({
      data: {
        item: await getInventoryItem(
          restaurantIdFrom(request),
          stringParam(request.params.itemId)!
        )
      }
    });
  })
);

inventoryRouter.post(
  "/",
  requirePermission("stock.manage"),
  validateBody(inventoryItemSchema),
  asyncHandler(async (request, response) => {
    const item = await createInventoryItem(
      restaurantIdFrom(request),
      request.user!.id,
      request.body,
      metaFrom(request)
    );
    response.status(201).json({ data: { item } });
  })
);

inventoryRouter.patch(
  "/:itemId",
  requirePermission("stock.manage"),
  validateBody(updateInventoryItemSchema),
  asyncHandler(async (request, response) => {
    const item = await updateInventoryItem(
      restaurantIdFrom(request),
      request.user!.id,
      stringParam(request.params.itemId)!,
      request.body,
      metaFrom(request)
    );
    response.json({ data: { item } });
  })
);

export const stockMovementsRouter = Router({ mergeParams: true });

stockMovementsRouter.get(
  "/",
  requirePermission("stock.view"),
  asyncHandler(async (request, response) => {
    const query = listMovementsQuerySchema.parse(request.query);
    response.json({
      data: await listStockMovements(restaurantIdFrom(request), query)
    });
  })
);

export const stockPurchasesRouter = Router({ mergeParams: true });

stockPurchasesRouter.get(
  "/",
  requirePermission("stock.view"),
  asyncHandler(async (request, response) => {
    const query = paginationSchema
      .extend({
        startDate: listMovementsQuerySchema.shape.startDate,
        endDate: listMovementsQuerySchema.shape.endDate
      })
      .parse(request.query);
    response.json({
      data: await listStockPurchases(restaurantIdFrom(request), query)
    });
  })
);

stockPurchasesRouter.get(
  "/:purchaseId",
  requirePermission("stock.view"),
  asyncHandler(async (request, response) => {
    response.json({
      data: {
        purchase: await getStockPurchase(
          restaurantIdFrom(request),
          stringParam(request.params.purchaseId)!
        )
      }
    });
  })
);

stockPurchasesRouter.post(
  "/",
  requirePermission("stock.purchase"),
  validateBody(stockPurchaseSchema),
  asyncHandler(async (request, response) => {
    const purchase = await createStockPurchase(
      restaurantIdFrom(request),
      request.user!.id,
      request.body,
      metaFrom(request)
    );
    response.status(201).json({ data: { purchase } });
  })
);

export const stockAdjustmentsRouter = Router({ mergeParams: true });

stockAdjustmentsRouter.post(
  "/",
  requirePermission("stock.adjust"),
  validateBody(stockAdjustmentSchema),
  asyncHandler(async (request, response) => {
    const movement = await createStockAdjustment(
      restaurantIdFrom(request),
      request.user!.id,
      request.body,
      metaFrom(request)
    );
    response.status(201).json({ data: { movement } });
  })
);
