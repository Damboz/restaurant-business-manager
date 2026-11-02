import { Router } from "express";
import { productCategoriesRouter, productsRouter } from "../catalog/catalog.routes.js";
import { customersRouter, suppliersRouter } from "../contacts/contacts.routes.js";
import {
  inventoryCategoriesRouter,
  inventoryRouter,
  stockAdjustmentsRouter,
  stockMovementsRouter,
  stockPurchasesRouter
} from "../inventory/inventory.routes.js";
import { recipesRouter } from "../recipes/recipes.routes.js";
import { salesRouter } from "../sales/sales.routes.js";
import { expensesRouter } from "../expenses/expenses.routes.js";
import { financeRouter } from "../finance/finance.routes.js";
import { reportsRouter } from "../reports/reports.routes.js";
import { closingsRouter } from "../closings/closings.routes.js";
import { notificationsRouter } from "../notifications/notifications.routes.js";
import { settingsRouter } from "../settings/settings.routes.js";

export const businessRouter = Router({ mergeParams: true });

businessRouter.use("/product-categories", productCategoriesRouter);
businessRouter.use("/products", productsRouter);
businessRouter.use("/suppliers", suppliersRouter);
businessRouter.use("/customers", customersRouter);
businessRouter.use("/inventory-categories", inventoryCategoriesRouter);
businessRouter.use("/inventory", inventoryRouter);
businessRouter.use("/stock-movements", stockMovementsRouter);
businessRouter.use("/stock-purchases", stockPurchasesRouter);
businessRouter.use("/stock-adjustments", stockAdjustmentsRouter);
businessRouter.use("/recipes", recipesRouter);
businessRouter.use("/sales", salesRouter);
businessRouter.use("/expenses", expensesRouter);
businessRouter.use("/finance", financeRouter);
businessRouter.use("/reports", reportsRouter);
businessRouter.use("/closings", closingsRouter);
businessRouter.use("/notifications", notificationsRouter);
businessRouter.use("/settings", settingsRouter);
