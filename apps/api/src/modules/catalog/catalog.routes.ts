import { Router, type Request } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { stringParam } from "../../lib/request-params.js";
import { requirePermission } from "../../middleware/restaurant.js";
import { validateBody } from "../../middleware/validate.js";
import {
  createProduct,
  createProductCategory,
  getProduct,
  listProductCategories,
  listProducts,
  updateProduct,
  updateProductCategory
} from "./catalog.service.js";
import {
  listProductsQuerySchema,
  productCategorySchema,
  productSchema,
  updateProductCategorySchema,
  updateProductSchema
} from "./catalog.schemas.js";

function restaurantIdFrom(request: Request): string {
  return stringParam(request.params.restaurantId)!;
}
function metaFrom(request: Request) {
  return { ip: request.ip, userAgent: request.get("user-agent") };
}

export const productCategoriesRouter = Router({ mergeParams: true });

productCategoriesRouter.get(
  "/",
  requirePermission("products.view"),
  asyncHandler(async (request, response) => {
    response.json({
      data: { categories: await listProductCategories(restaurantIdFrom(request)) }
    });
  })
);

productCategoriesRouter.post(
  "/",
  requirePermission("products.manage"),
  validateBody(productCategorySchema),
  asyncHandler(async (request, response) => {
    const category = await createProductCategory(
      restaurantIdFrom(request),
      request.user!.id,
      request.body,
      metaFrom(request)
    );
    response.status(201).json({ data: { category } });
  })
);

productCategoriesRouter.patch(
  "/:categoryId",
  requirePermission("products.manage"),
  validateBody(updateProductCategorySchema),
  asyncHandler(async (request, response) => {
    const category = await updateProductCategory(
      restaurantIdFrom(request),
      request.user!.id,
      stringParam(request.params.categoryId)!,
      request.body,
      metaFrom(request)
    );
    response.json({ data: { category } });
  })
);

export const productsRouter = Router({ mergeParams: true });

productsRouter.get(
  "/",
  requirePermission("products.view"),
  asyncHandler(async (request, response) => {
    const query = listProductsQuerySchema.parse(request.query);
    response.json({ data: await listProducts(restaurantIdFrom(request), query) });
  })
);

productsRouter.get(
  "/:productId",
  requirePermission("products.view"),
  asyncHandler(async (request, response) => {
    response.json({
      data: {
        product: await getProduct(
          restaurantIdFrom(request),
          stringParam(request.params.productId)!
        )
      }
    });
  })
);

productsRouter.post(
  "/",
  requirePermission("products.manage"),
  validateBody(productSchema),
  asyncHandler(async (request, response) => {
    const product = await createProduct(
      restaurantIdFrom(request),
      request.user!.id,
      request.body,
      metaFrom(request)
    );
    response.status(201).json({ data: { product } });
  })
);

productsRouter.patch(
  "/:productId",
  requirePermission("products.manage"),
  validateBody(updateProductSchema),
  asyncHandler(async (request, response) => {
    const product = await updateProduct(
      restaurantIdFrom(request),
      request.user!.id,
      stringParam(request.params.productId)!,
      request.body,
      metaFrom(request)
    );
    response.json({ data: { product } });
  })
);
