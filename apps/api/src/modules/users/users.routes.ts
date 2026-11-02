import { Router, type Request } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { stringParam } from "../../lib/request-params.js";
import { requirePermission } from "../../middleware/restaurant.js";
import { validateBody } from "../../middleware/validate.js";
import {
  createMember,
  getMember,
  listMembers,
  removeMember,
  updateMember,
  type MembershipActor
} from "./users.service.js";
import {
  createMemberSchema,
  listMembersQuerySchema,
  membershipIdParamsSchema,
  updateMemberSchema
} from "./users.schemas.js";

export const usersRouter = Router({ mergeParams: true });

function actorFrom(request: Request): MembershipActor {
  return {
    userId: request.user!.id,
    membershipId: request.membership!.id,
    roleKey: request.membership!.role.key
  };
}

function metadataFrom(request: Request): { ip?: string; userAgent?: string } {
  return {
    ip: request.ip,
    userAgent: request.get("user-agent")
  };
}

function restaurantIdFrom(request: Request): string {
  return stringParam(request.params.restaurantId)!;
}

usersRouter.get(
  "/",
  requirePermission("employees.view"),
  asyncHandler(async (request, response) => {
    const query = listMembersQuerySchema.parse(request.query);
    const members = await listMembers(restaurantIdFrom(request), query);

    response.json({ data: { members } });
  })
);

usersRouter.get(
  "/:membershipId",
  requirePermission("employees.view"),
  asyncHandler(async (request, response) => {
    const { membershipId } = membershipIdParamsSchema.parse(request.params);
    const member = await getMember(restaurantIdFrom(request), membershipId);

    response.json({ data: { member } });
  })
);

usersRouter.post(
  "/",
  requirePermission("employees.manage"),
  validateBody(createMemberSchema),
  asyncHandler(async (request, response) => {
    const member = await createMember(
      restaurantIdFrom(request),
      actorFrom(request),
      request.body,
      metadataFrom(request)
    );

    response.status(201).json({ data: { member } });
  })
);

usersRouter.patch(
  "/:membershipId",
  requirePermission("employees.manage"),
  validateBody(updateMemberSchema),
  asyncHandler(async (request, response) => {
    const { membershipId } = membershipIdParamsSchema.parse(request.params);
    const member = await updateMember(
      restaurantIdFrom(request),
      actorFrom(request),
      membershipId,
      request.body,
      metadataFrom(request)
    );

    response.json({ data: { member } });
  })
);

usersRouter.delete(
  "/:membershipId",
  requirePermission("employees.manage"),
  asyncHandler(async (request, response) => {
    const { membershipId } = membershipIdParamsSchema.parse(request.params);

    await removeMember(
      restaurantIdFrom(request),
      actorFrom(request),
      membershipId,
      metadataFrom(request)
    );

    response.status(204).send();
  })
);

