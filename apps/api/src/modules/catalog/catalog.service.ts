import { Prisma } from "@prisma/client";
import { recordAudit } from "../../lib/audit.js";
import { bigintToJson } from "../../lib/decimal.js";
import { ConflictError, NotFoundError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";

type AuditMeta = { ip?: string; userAgent?: string };

function isUnique(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function listProductCategories(restaurantId: string) {
  const categories = await prisma.productCategory.findMany({
    where: { restaurantId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { products: true } } }
  });

  return categories.map((category) => ({
    id: category.id,
    name: category.name,
    sortOrder: category.sortOrder,
    isActive: category.isActive,
    productCount: category._count.products,
    createdAt: category.createdAt.toISOString()
  }));
}

export async function createProductCategory(
  restaurantId: string,
  actorUserId: string,
  input: { name: string; sortOrder: number; isActive: boolean },
  meta: AuditMeta
) {
  try {
    const category = await prisma.productCategory.create({
      data: { restaurantId, ...input },
      select: { id: true }
    });

    await recordAudit(prisma, {
      restaurantId,
      actorUserId,
      action: "PRODUCT_CATEGORY_CREATED",
      entityType: "ProductCategory",
      entityId: category.id,
      after: input,
      ...meta
    });

    return { id: category.id };
  } catch (error) {
    if (isUnique(error)) {
      throw new ConflictError("A product category with this name already exists");
    }
    throw error;
  }
}

export async function updateProductCategory(
  restaurantId: string,
  actorUserId: string,
  categoryId: string,
  input: Record<string, unknown>,
  meta: AuditMeta
) {
  const category = await prisma.productCategory.findFirst({
    where: { id: categoryId, restaurantId }
  });

  if (!category) {
    throw new NotFoundError("The product category was not found");
  }

  try {
    await prisma.productCategory.update({ where: { id: categoryId }, data: input });
  } catch (error) {
    if (isUnique(error)) {
      throw new ConflictError("A product category with this name already exists");
    }
    throw error;
  }

  await recordAudit(prisma, {
    restaurantId,
    actorUserId,
    action: "PRODUCT_CATEGORY_UPDATED",
    entityType: "ProductCategory",
    entityId: categoryId,
    before: { name: category.name, isActive: category.isActive },
    after: input as Prisma.InputJsonValue,
    ...meta
  });

  return listProductCategories(restaurantId).then((categories) =>
    categories.find((item) => item.id === categoryId)!
  );
}

export async function listProducts(
  restaurantId: string,
  query: { page: number; pageSize: number; search?: string; categoryId?: string; status?: "ACTIVE" | "INACTIVE" }
) {
  const where: Prisma.ProductWhereInput = {
    restaurantId,
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: "insensitive" } },
            { description: { contains: query.search, mode: "insensitive" } }
          ]
        }
      : {})
  };

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: [{ status: "asc" }, { name: "asc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: {
        category: { select: { id: true, name: true } },
        recipes: {
          where: { isActive: true },
          select: { id: true, version: true, yieldQuantity: true },
          take: 1
        }
      }
    }),
    prisma.product.count({ where })
  ]);

  return {
    items: products.map((product) => ({
      id: product.id,
      name: product.name,
      description: product.description,
      categoryId: product.categoryId,
      categoryName: product.category.name,
      sellingPriceMinor: bigintToJson(product.sellingPriceMinor),
      currency: product.currency,
      status: product.status,
      isRecipeBased: product.isRecipeBased,
      activeRecipe: product.recipes[0]
        ? {
            id: product.recipes[0].id,
            version: product.recipes[0].version,
            yieldQuantity: product.recipes[0].yieldQuantity.toString()
          }
        : null,
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString()
    })),
    total,
    page: query.page,
    pageSize: query.pageSize
  };
}

export async function getProduct(restaurantId: string, productId: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, restaurantId },
    include: {
      category: { select: { id: true, name: true } },
      priceHistory: { orderBy: { changedAt: "desc" }, take: 20 }
    }
  });

  if (!product) {
    throw new NotFoundError("The product was not found");
  }

  return {
    id: product.id,
    name: product.name,
    description: product.description,
    categoryId: product.categoryId,
    categoryName: product.category.name,
    sellingPriceMinor: bigintToJson(product.sellingPriceMinor),
    currency: product.currency,
    status: product.status,
    isRecipeBased: product.isRecipeBased,
    priceHistory: product.priceHistory.map((entry) => ({
      oldPriceMinor: bigintToJson(entry.oldPriceMinor),
      newPriceMinor: bigintToJson(entry.newPriceMinor),
      changedAt: entry.changedAt.toISOString()
    }))
  };
}

export async function createProduct(
  restaurantId: string,
  actorUserId: string,
  input: {
    categoryId: string;
    name: string;
    description?: string;
    sellingPriceMinor: bigint;
    isRecipeBased: boolean;
    status: "ACTIVE" | "INACTIVE";
  },
  meta: AuditMeta
) {
  const category = await prisma.productCategory.findFirst({
    where: { id: input.categoryId, restaurantId },
    select: { id: true }
  });

  if (!category) {
    throw new NotFoundError("The product category was not found");
  }

  let productId: string;

  try {
    const product = await prisma.product.create({
      data: {
        restaurantId,
        categoryId: input.categoryId,
        name: input.name,
        description: input.description,
        sellingPriceMinor: input.sellingPriceMinor,
        isRecipeBased: input.isRecipeBased,
        status: input.status,
        createdByUserId: actorUserId
      },
      select: { id: true }
    });
    productId = product.id;
  } catch (error) {
    if (isUnique(error)) {
      throw new ConflictError("A product with this name already exists");
    }
    throw error;
  }

  await recordAudit(prisma, {
    restaurantId,
    actorUserId,
    action: "PRODUCT_CREATED",
    entityType: "Product",
    entityId: productId,
    after: { name: input.name, sellingPriceMinor: input.sellingPriceMinor.toString() },
    ...meta
  });

  return getProduct(restaurantId, productId);
}

export async function updateProduct(
  restaurantId: string,
  actorUserId: string,
  productId: string,
  input: {
    categoryId?: string;
    name?: string;
    description?: string | null;
    sellingPriceMinor?: bigint;
    status?: "ACTIVE" | "INACTIVE";
    isRecipeBased?: boolean;
  },
  meta: AuditMeta
) {
  const existing = await prisma.product.findFirst({
    where: { id: productId, restaurantId }
  });

  if (!existing) {
    throw new NotFoundError("The product was not found");
  }

  if (input.categoryId) {
    const category = await prisma.productCategory.findFirst({
      where: { id: input.categoryId, restaurantId },
      select: { id: true }
    });
    if (!category) {
      throw new NotFoundError("The product category was not found");
    }
  }

  if (input.isRecipeBased === false) {
    const activeRecipe = await prisma.recipe.findFirst({
      where: { productId, isActive: true },
      select: { id: true }
    });
    if (activeRecipe) {
      await prisma.recipe.updateMany({ where: { productId }, data: { isActive: false } });
    }
  }

  try {
    await prisma.$transaction(async (transaction) => {
      if (
        input.sellingPriceMinor !== undefined &&
        input.sellingPriceMinor !== existing.sellingPriceMinor
      ) {
        await transaction.productPriceHistory.create({
          data: {
            productId,
            oldPriceMinor: existing.sellingPriceMinor,
            newPriceMinor: input.sellingPriceMinor,
            changedByUserId: actorUserId
          }
        });
      }

      await transaction.product.update({
        where: { id: productId },
        data: input
      });
    });
  } catch (error) {
    if (isUnique(error)) {
      throw new ConflictError("A product with this name already exists");
    }
    throw error;
  }

  await recordAudit(prisma, {
    restaurantId,
    actorUserId,
    action: "PRODUCT_UPDATED",
    entityType: "Product",
    entityId: productId,
    before: {
      name: existing.name,
      sellingPriceMinor: existing.sellingPriceMinor.toString(),
      status: existing.status
    },
    after: {
      ...input,
      sellingPriceMinor: input.sellingPriceMinor?.toString()
    },
    ...meta
  });

  return getProduct(restaurantId, productId);
}
