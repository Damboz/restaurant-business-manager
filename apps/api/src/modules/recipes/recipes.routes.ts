import { Router, type Request } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/async-handler.js";
import { stringParam } from "../../lib/request-params.js";
import { requirePermission } from "../../middleware/restaurant.js";
import { validateBody } from "../../middleware/validate.js";
import {
  createRecipe,
  getProductRecipeCost,
  getRecipe,
  listRecipes,
  updateRecipe
} from "./recipes.service.js";
import { createRecipeSchema, updateRecipeSchema } from "./recipes.schemas.js";

function restaurantIdFrom(request: Request): string {
  return stringParam(request.params.restaurantId)!;
}
function metaFrom(request: Request) {
  return { ip: request.ip, userAgent: request.get("user-agent") };
}

export const recipesRouter = Router({ mergeParams: true });

recipesRouter.get(
  "/",
  requirePermission("products.view"),
  asyncHandler(async (request, response) => {
    const query = z
      .object({ productId: z.string().uuid().optional() })
      .parse(request.query);
    response.json({
      data: { recipes: await listRecipes(restaurantIdFrom(request), query.productId) }
    });
  })
);

recipesRouter.get(
  "/product/:productId/cost",
  requirePermission("products.view"),
  asyncHandler(async (request, response) => {
    response.json({
      data: await getProductRecipeCost(
        restaurantIdFrom(request),
        stringParam(request.params.productId)!
      )
    });
  })
);

recipesRouter.get(
  "/:recipeId",
  requirePermission("products.view"),
  asyncHandler(async (request, response) => {
    response.json({
      data: {
        recipe: await getRecipe(
          restaurantIdFrom(request),
          stringParam(request.params.recipeId)!
        )
      }
    });
  })
);

recipesRouter.post(
  "/",
  requirePermission("products.manage"),
  validateBody(createRecipeSchema),
  asyncHandler(async (request, response) => {
    const recipe = await createRecipe(
      restaurantIdFrom(request),
      request.user!.id,
      request.body,
      metaFrom(request)
    );
    response.status(201).json({ data: { recipe } });
  })
);

recipesRouter.patch(
  "/:recipeId",
  requirePermission("products.manage"),
  validateBody(updateRecipeSchema),
  asyncHandler(async (request, response) => {
    const recipe = await updateRecipe(
      restaurantIdFrom(request),
      request.user!.id,
      stringParam(request.params.recipeId)!,
      request.body,
      metaFrom(request)
    );
    response.json({ data: { recipe } });
  })
);
