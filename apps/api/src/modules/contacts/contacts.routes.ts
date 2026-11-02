import { Router, type Request } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { stringParam } from "../../lib/request-params.js";
import { requirePermission } from "../../middleware/restaurant.js";
import { validateBody } from "../../middleware/validate.js";
import {
  createContact,
  listContacts,
  updateContact,
  type ContactKind
} from "./contacts.service.js";
import {
  createCustomerSchema,
  createSupplierSchema,
  listContactsQuerySchema,
  updateCustomerSchema,
  updateSupplierSchema
} from "./contacts.schemas.js";

function restaurantIdFrom(request: Request): string {
  return stringParam(request.params.restaurantId)!;
}

function metaFrom(request: Request) {
  return { ip: request.ip, userAgent: request.get("user-agent") };
}

function createContactRouter(kind: ContactKind) {
  const router = Router({ mergeParams: true });
  const view = kind === "supplier" ? "suppliers.view" : "customers.view";
  const manage = kind === "supplier" ? "suppliers.manage" : "customers.manage";
  const createSchema = kind === "supplier" ? createSupplierSchema : createCustomerSchema;
  const updateSchema = kind === "supplier" ? updateSupplierSchema : updateCustomerSchema;

  router.get(
    "/",
    requirePermission(view),
    asyncHandler(async (request, response) => {
      const query = listContactsQuerySchema.parse(request.query);
      response.json({
        data: await listContacts(kind, restaurantIdFrom(request), query)
      });
    })
  );

  router.post(
    "/",
    requirePermission(manage),
    validateBody(createSchema),
    asyncHandler(async (request, response) => {
      const contact = await createContact(
        kind,
        restaurantIdFrom(request),
        request.user!.id,
        request.body,
        metaFrom(request)
      );
      response.status(201).json({ data: { [kind]: contact } });
    })
  );

  router.patch(
    "/:id",
    requirePermission(manage),
    validateBody(updateSchema),
    asyncHandler(async (request, response) => {
      const contact = await updateContact(
        kind,
        restaurantIdFrom(request),
        request.user!.id,
        stringParam(request.params.id)!,
        request.body,
        metaFrom(request)
      );
      response.json({ data: { [kind]: contact } });
    })
  );

  return router;
}

export const suppliersRouter = createContactRouter("supplier");
export const customersRouter = createContactRouter("customer");
