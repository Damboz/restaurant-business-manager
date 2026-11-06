import { recordAudit } from "../../lib/audit.js";
import { dateToDateOnly } from "../../lib/business-date.js";
import { query } from "../../lib/db.js";
import { NotFoundError } from "../../lib/errors.js";

type AuditMeta = { ip?: string; userAgent?: string };

type RestaurantRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address_line: string | null;
  city: string | null;
  country: string;
  currency: string;
  timezone: string;
  logo_url: string | null;
  opening_date: string | null;
  operating_hours: Record<string, unknown> | null;
  status: string;
};

type PaymentMethodRow = {
  id: string;
  key: string;
  name: string;
  is_active: boolean;
  restaurant_id: string | null;
};

type ExpenseCategoryRow = {
  id: string;
  key: string | null;
  name: string;
  is_operating: boolean;
  is_system: boolean;
};

export async function getSettings(restaurantId: string) {
  const { rows: restaurants } = await query<RestaurantRow>(
    `SELECT id, name, phone, email, address_line, city, country, currency,
            timezone, logo_url, opening_date, operating_hours, status
     FROM restaurants
     WHERE id = $1`,
    [restaurantId]
  );
  const restaurant = restaurants[0];

  if (!restaurant) {
    throw new NotFoundError("The restaurant was not found");
  }

  const [{ rows: paymentMethods }, { rows: expenseCategories }] = await Promise.all([
    query<PaymentMethodRow>(
      `SELECT id, key, name, is_active, restaurant_id
       FROM payment_methods
       WHERE is_active = true AND (restaurant_id = $1 OR restaurant_id IS NULL)
       ORDER BY sort_order ASC, name ASC`,
      [restaurantId]
    ),
    query<ExpenseCategoryRow>(
      `SELECT id, key, name, is_operating, is_system
       FROM expense_categories
       WHERE is_active = true AND (restaurant_id = $1 OR restaurant_id IS NULL)
       ORDER BY sort_order ASC, name ASC`,
      [restaurantId]
    )
  ]);

  return {
    restaurant: {
      id: restaurant.id,
      name: restaurant.name,
      phone: restaurant.phone,
      email: restaurant.email,
      addressLine: restaurant.address_line,
      city: restaurant.city,
      country: restaurant.country,
      currency: restaurant.currency,
      timezone: restaurant.timezone,
      logoUrl: restaurant.logo_url,
      openingDate: restaurant.opening_date
        ? dateToDateOnly(restaurant.opening_date)
        : null,
      operatingHours: restaurant.operating_hours,
      status: restaurant.status
    },
    paymentMethods: paymentMethods.map((method) => ({
      id: method.id,
      key: method.key,
      name: method.name,
      isActive: method.is_active,
      restaurantId: method.restaurant_id
    })),
    expenseCategories: expenseCategories.map((category) => ({
      id: category.id,
      key: category.key,
      name: category.name,
      isOperating: category.is_operating,
      isSystem: category.is_system
    }))
  };
}

const SETTINGS_COLUMNS: Record<string, string> = {
  name: "name",
  phone: "phone",
  email: "email",
  addressLine: "address_line",
  city: "city",
  logoUrl: "logo_url"
};

export async function updateSettings(
  restaurantId: string,
  actorUserId: string,
  input: {
    name?: string;
    phone?: string | null;
    email?: string | null;
    addressLine?: string | null;
    city?: string | null;
    logoUrl?: string | null;
    openingDate?: string | null;
    operatingHours?: Record<string, unknown> | null;
  },
  meta: AuditMeta
) {
  const { rows: existingRows } = await query<RestaurantRow>(
    `SELECT * FROM restaurants WHERE id = $1`,
    [restaurantId]
  );
  const existing = existingRows[0];

  if (!existing) {
    throw new NotFoundError("The restaurant was not found");
  }

  const assignments: string[] = [];
  const params: unknown[] = [];

  for (const [key, column] of Object.entries(SETTINGS_COLUMNS)) {
    if (input[key as keyof typeof input] !== undefined) {
      params.push(input[key as keyof typeof input]);
      assignments.push(`${column} = $${params.length}`);
    }
  }

  if (input.openingDate !== undefined) {
    params.push(input.openingDate);
    assignments.push(`opening_date = $${params.length}`);
  }

  if (input.operatingHours !== undefined) {
    params.push(
      input.operatingHours === null ? null : JSON.stringify(input.operatingHours)
    );
    assignments.push(`operating_hours = $${params.length}`);
  }

  if (assignments.length > 0) {
    params.push(restaurantId);
    await query(
      `UPDATE restaurants
       SET ${assignments.join(", ")}, updated_at = NOW()
       WHERE id = $${params.length}`,
      params
    );
  }

  await recordAudit(null, {
    restaurantId,
    actorUserId,
    action: "SETTINGS_UPDATED",
    entityType: "Restaurant",
    entityId: restaurantId,
    before: {
      name: existing.name,
      phone: existing.phone,
      city: existing.city
    },
    after: input,
    ...meta
  });

  return getSettings(restaurantId);
}
