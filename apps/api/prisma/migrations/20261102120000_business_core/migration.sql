-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "SaleSource" AS ENUM ('ITEMIZED', 'MANUAL');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('COMPLETED', 'VOIDED');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('ACTIVE', 'VOIDED');

-- CreateEnum
CREATE TYPE "StockPurchaseStatus" AS ENUM ('RECEIVED', 'VOIDED');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('OPENING', 'PURCHASE', 'CONSUMPTION', 'ADJUSTMENT', 'WASTAGE', 'RETURN');

-- CreateEnum
CREATE TYPE "StockReferenceType" AS ENUM ('SALE', 'STOCK_PURCHASE', 'ADJUSTMENT', 'OPENING', 'WASTAGE', 'RETURN');

-- CreateEnum
CREATE TYPE "OwnerTransactionType" AS ENUM ('WITHDRAWAL', 'CONTRIBUTION');

-- CreateEnum
CREATE TYPE "OwnerTransactionStatus" AS ENUM ('ACTIVE', 'VOIDED');

-- CreateEnum
CREATE TYPE "DailyClosingStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('LOW_STOCK', 'DAILY_SUMMARY', 'CLOSING_REMINDER', 'HIGH_EXPENSE', 'MISSING_RECORD', 'SYNC_SUCCESS', 'SYNC_FAILED');

-- CreateEnum
CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "SyncDirection" AS ENUM ('PUSH', 'PULL');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'SYNCED', 'CONFLICT', 'FAILED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('SALE', 'EXPENSE', 'STOCK_PURCHASE', 'OWNER_TRANSACTION');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "deactivated_at" TIMESTAMPTZ(3),
ADD COLUMN     "must_change_password" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "restaurants" ADD COLUMN     "closed_at" TIMESTAMPTZ(3),
ADD COLUMN     "logo_url" VARCHAR(500),
ADD COLUMN     "opening_date" DATE,
ADD COLUMN     "operating_hours" JSONB,
ADD COLUMN     "owner_user_id" UUID;

-- AlterTable
ALTER TABLE "restaurant_users" ADD COLUMN     "accepted_at" TIMESTAMPTZ(3),
ADD COLUMN     "invitation_expires_at" TIMESTAMPTZ(3),
ADD COLUMN     "invitation_token_hash" CHAR(64),
ADD COLUMN     "invited_at" TIMESTAMPTZ(3),
ADD COLUMN     "invited_by_user_id" UUID;

-- CreateTable
CREATE TABLE "product_categories" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "description" VARCHAR(500),
    "selling_price_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'MWK',
    "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_recipe_based" BOOLEAN NOT NULL DEFAULT false,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_price_history" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "old_price_minor" BIGINT NOT NULL,
    "new_price_minor" BIGINT NOT NULL,
    "changed_by_user_id" UUID NOT NULL,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_price_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "phone" VARCHAR(20),
    "email" VARCHAR(254),
    "address" VARCHAR(255),
    "notes" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "phone" VARCHAR(20),
    "email" VARCHAR(254),
    "notes" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID,
    "key" VARCHAR(30) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID,
    "key" VARCHAR(50),
    "name" VARCHAR(100) NOT NULL,
    "is_operating" BOOLEAN NOT NULL DEFAULT true,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_categories" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inventory_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "transaction_number" VARCHAR(30) NOT NULL,
    "source" "SaleSource" NOT NULL,
    "status" "SaleStatus" NOT NULL DEFAULT 'COMPLETED',
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "business_date" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'MWK',
    "subtotal_minor" BIGINT NOT NULL,
    "total_minor" BIGINT NOT NULL,
    "notes" VARCHAR(500),
    "customer_id" UUID,
    "recorded_by_user_id" UUID NOT NULL,
    "device_id" UUID,
    "client_id" UUID,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_user_id" UUID,
    "void_reason" VARCHAR(255),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_items" (
    "id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "product_id" UUID,
    "product_name" VARCHAR(150) NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit_price_minor" BIGINT NOT NULL,
    "line_total_minor" BIGINT NOT NULL,
    "cost_of_goods_minor" BIGINT,
    "recipe_id" UUID,
    "notes" VARCHAR(255),

    CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_payments" (
    "id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "payment_method_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,

    CONSTRAINT "sale_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_sequences" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "document_type" "DocumentType" NOT NULL,
    "period_key" VARCHAR(8) NOT NULL,
    "last_number" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "expense_number" VARCHAR(30) NOT NULL,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'ACTIVE',
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "business_date" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'MWK',
    "supplier_id" UUID,
    "payment_method_id" UUID NOT NULL,
    "total_minor" BIGINT NOT NULL,
    "notes" VARCHAR(500),
    "recorded_by_user_id" UUID NOT NULL,
    "device_id" UUID,
    "client_id" UUID,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_user_id" UUID,
    "void_reason" VARCHAR(255),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_items" (
    "id" UUID NOT NULL,
    "expense_id" UUID NOT NULL,
    "expense_category_id" UUID NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit" VARCHAR(20) NOT NULL,
    "unit_price_minor" BIGINT NOT NULL,
    "line_total_minor" BIGINT NOT NULL,

    CONSTRAINT "expense_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_purchases" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "purchase_number" VARCHAR(30) NOT NULL,
    "status" "StockPurchaseStatus" NOT NULL DEFAULT 'RECEIVED',
    "supplier_id" UUID,
    "payment_method_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "business_date" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'MWK',
    "total_minor" BIGINT NOT NULL,
    "notes" VARCHAR(500),
    "recorded_by_user_id" UUID NOT NULL,
    "device_id" UUID,
    "client_id" UUID,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_user_id" UUID,
    "void_reason" VARCHAR(255),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_purchase_items" (
    "id" UUID NOT NULL,
    "stock_purchase_id" UUID NOT NULL,
    "inventory_item_id" UUID NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit" VARCHAR(20) NOT NULL,
    "unit_price_minor" BIGINT NOT NULL,
    "line_total_minor" BIGINT NOT NULL,

    CONSTRAINT "stock_purchase_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "unit" VARCHAR(20) NOT NULL,
    "current_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "minimum_level" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "average_cost_minor_per_unit" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "default_supplier_id" UUID,
    "last_restocked_at" TIMESTAMPTZ(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "inventory_item_id" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity_delta" DECIMAL(18,4) NOT NULL,
    "unit_cost_minor" DECIMAL(18,6) NOT NULL,
    "value_minor" BIGINT NOT NULL,
    "quantity_after" DECIMAL(18,4) NOT NULL,
    "reference_type" "StockReferenceType" NOT NULL,
    "reference_id" UUID,
    "reason" VARCHAR(255),
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "business_date" DATE NOT NULL,
    "recorded_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipes" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "yield_quantity" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" VARCHAR(500),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_ingredients" (
    "id" UUID NOT NULL,
    "recipe_id" UUID NOT NULL,
    "inventory_item_id" UUID NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit" VARCHAR(20) NOT NULL,

    CONSTRAINT "recipe_ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_closings" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "status" "DailyClosingStatus" NOT NULL DEFAULT 'OPEN',
    "cash_sales_minor" BIGINT NOT NULL DEFAULT 0,
    "mobile_money_sales_minor" BIGINT NOT NULL DEFAULT 0,
    "bank_sales_minor" BIGINT NOT NULL DEFAULT 0,
    "other_sales_minor" BIGINT NOT NULL DEFAULT 0,
    "manual_sales_minor" BIGINT NOT NULL DEFAULT 0,
    "total_sales_minor" BIGINT NOT NULL DEFAULT 0,
    "cogs_minor" BIGINT NOT NULL DEFAULT 0,
    "gross_profit_minor" BIGINT NOT NULL DEFAULT 0,
    "operating_expenses_minor" BIGINT NOT NULL DEFAULT 0,
    "net_profit_minor" BIGINT NOT NULL DEFAULT 0,
    "transaction_count" INTEGER NOT NULL DEFAULT 0,
    "closed_by_user_id" UUID NOT NULL,
    "closed_at" TIMESTAMPTZ(3) NOT NULL,
    "reopened_by_user_id" UUID,
    "reopened_at" TIMESTAMPTZ(3),
    "reopen_reason" VARCHAR(255),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "daily_closings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "owner_transactions" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "type" "OwnerTransactionType" NOT NULL,
    "status" "OwnerTransactionStatus" NOT NULL DEFAULT 'ACTIVE',
    "amount_minor" BIGINT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "business_date" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'MWK',
    "description" VARCHAR(255) NOT NULL,
    "recorded_by_user_id" UUID NOT NULL,
    "client_id" UUID,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_user_id" UUID,
    "void_reason" VARCHAR(255),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "owner_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opening_balances" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "as_of_date" DATE NOT NULL,
    "cash_minor" BIGINT NOT NULL DEFAULT 0,
    "bank_minor" BIGINT NOT NULL DEFAULT 0,
    "inventory_value_minor" BIGINT NOT NULL DEFAULT 0,
    "notes" VARCHAR(255),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opening_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID,
    "actor_user_id" UUID,
    "action" VARCHAR(80) NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" UUID,
    "before" JSONB,
    "after" JSONB,
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO',
    "title_key" VARCHAR(120) NOT NULL,
    "body_key" VARCHAR(120) NOT NULL,
    "params" JSONB,
    "dedupe_key" VARCHAR(200),
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "platform" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_records" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" UUID,
    "client_id" UUID,
    "direction" "SyncDirection" NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(500),
    "last_attempt_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sync_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_categories_restaurant_id_is_active_idx" ON "product_categories"("restaurant_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_restaurant_id_name_key" ON "product_categories"("restaurant_id", "name");

-- CreateIndex
CREATE INDEX "products_restaurant_id_status_category_id_idx" ON "products"("restaurant_id", "status", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_restaurant_id_name_key" ON "products"("restaurant_id", "name");

-- CreateIndex
CREATE INDEX "product_price_history_product_id_changed_at_idx" ON "product_price_history"("product_id", "changed_at");

-- CreateIndex
CREATE INDEX "suppliers_restaurant_id_is_active_idx" ON "suppliers"("restaurant_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_restaurant_id_name_key" ON "suppliers"("restaurant_id", "name");

-- CreateIndex
CREATE INDEX "customers_restaurant_id_is_active_idx" ON "customers"("restaurant_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "customers_restaurant_id_name_key" ON "customers"("restaurant_id", "name");

-- CreateIndex
CREATE INDEX "payment_methods_restaurant_id_is_active_idx" ON "payment_methods"("restaurant_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "payment_methods_restaurant_id_key_key" ON "payment_methods"("restaurant_id", "key");

-- CreateIndex
CREATE INDEX "expense_categories_restaurant_id_is_active_idx" ON "expense_categories"("restaurant_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_restaurant_id_key_key" ON "expense_categories"("restaurant_id", "key");

-- CreateIndex
CREATE INDEX "inventory_categories_restaurant_id_is_active_idx" ON "inventory_categories"("restaurant_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_categories_restaurant_id_name_key" ON "inventory_categories"("restaurant_id", "name");

-- CreateIndex
CREATE INDEX "sales_restaurant_id_business_date_status_idx" ON "sales"("restaurant_id", "business_date", "status");

-- CreateIndex
CREATE INDEX "sales_restaurant_id_source_business_date_idx" ON "sales"("restaurant_id", "source", "business_date");

-- CreateIndex
CREATE INDEX "sales_recorded_by_user_id_idx" ON "sales"("recorded_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_restaurant_id_transaction_number_key" ON "sales"("restaurant_id", "transaction_number");

-- CreateIndex
CREATE UNIQUE INDEX "sales_restaurant_id_client_id_key" ON "sales"("restaurant_id", "client_id");

-- CreateIndex
CREATE INDEX "sale_items_sale_id_idx" ON "sale_items"("sale_id");

-- CreateIndex
CREATE INDEX "sale_items_product_id_idx" ON "sale_items"("product_id");

-- CreateIndex
CREATE INDEX "sale_payments_sale_id_idx" ON "sale_payments"("sale_id");

-- CreateIndex
CREATE INDEX "sale_payments_payment_method_id_idx" ON "sale_payments"("payment_method_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_sequences_restaurant_id_document_type_period_key_key" ON "document_sequences"("restaurant_id", "document_type", "period_key");

-- CreateIndex
CREATE INDEX "expenses_restaurant_id_business_date_status_idx" ON "expenses"("restaurant_id", "business_date", "status");

-- CreateIndex
CREATE INDEX "expenses_recorded_by_user_id_idx" ON "expenses"("recorded_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_restaurant_id_expense_number_key" ON "expenses"("restaurant_id", "expense_number");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_restaurant_id_client_id_key" ON "expenses"("restaurant_id", "client_id");

-- CreateIndex
CREATE INDEX "expense_items_expense_id_idx" ON "expense_items"("expense_id");

-- CreateIndex
CREATE INDEX "expense_items_expense_category_id_idx" ON "expense_items"("expense_category_id");

-- CreateIndex
CREATE INDEX "stock_purchases_restaurant_id_business_date_status_idx" ON "stock_purchases"("restaurant_id", "business_date", "status");

-- CreateIndex
CREATE INDEX "stock_purchases_recorded_by_user_id_idx" ON "stock_purchases"("recorded_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_purchases_restaurant_id_purchase_number_key" ON "stock_purchases"("restaurant_id", "purchase_number");

-- CreateIndex
CREATE UNIQUE INDEX "stock_purchases_restaurant_id_client_id_key" ON "stock_purchases"("restaurant_id", "client_id");

-- CreateIndex
CREATE INDEX "stock_purchase_items_stock_purchase_id_idx" ON "stock_purchase_items"("stock_purchase_id");

-- CreateIndex
CREATE INDEX "stock_purchase_items_inventory_item_id_idx" ON "stock_purchase_items"("inventory_item_id");

-- CreateIndex
CREATE INDEX "inventory_items_restaurant_id_is_active_idx" ON "inventory_items"("restaurant_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_restaurant_id_name_key" ON "inventory_items"("restaurant_id", "name");

-- CreateIndex
CREATE INDEX "stock_movements_inventory_item_id_occurred_at_idx" ON "stock_movements"("inventory_item_id", "occurred_at");

-- CreateIndex
CREATE INDEX "stock_movements_restaurant_id_business_date_type_idx" ON "stock_movements"("restaurant_id", "business_date", "type");

-- CreateIndex
CREATE INDEX "stock_movements_reference_type_reference_id_idx" ON "stock_movements"("reference_type", "reference_id");

-- CreateIndex
CREATE INDEX "recipes_restaurant_id_is_active_idx" ON "recipes"("restaurant_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "recipes_product_id_version_key" ON "recipes"("product_id", "version");

-- CreateIndex
CREATE INDEX "recipe_ingredients_inventory_item_id_idx" ON "recipe_ingredients"("inventory_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_ingredients_recipe_id_inventory_item_id_key" ON "recipe_ingredients"("recipe_id", "inventory_item_id");

-- CreateIndex
CREATE INDEX "daily_closings_restaurant_id_status_idx" ON "daily_closings"("restaurant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "daily_closings_restaurant_id_business_date_key" ON "daily_closings"("restaurant_id", "business_date");

-- CreateIndex
CREATE INDEX "owner_transactions_restaurant_id_business_date_type_status_idx" ON "owner_transactions"("restaurant_id", "business_date", "type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "owner_transactions_restaurant_id_client_id_key" ON "owner_transactions"("restaurant_id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "opening_balances_restaurant_id_as_of_date_key" ON "opening_balances"("restaurant_id", "as_of_date");

-- CreateIndex
CREATE INDEX "audit_logs_restaurant_id_created_at_idx" ON "audit_logs"("restaurant_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_user_id_dedupe_key_key" ON "notifications"("user_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "devices_user_id_last_seen_at_idx" ON "devices"("user_id", "last_seen_at");

-- CreateIndex
CREATE INDEX "sync_records_restaurant_id_device_id_status_idx" ON "sync_records"("restaurant_id", "device_id", "status");

-- CreateIndex
CREATE INDEX "sync_records_client_id_idx" ON "sync_records"("client_id");

-- AddForeignKey
ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_users" ADD CONSTRAINT "restaurant_users_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_price_history" ADD CONSTRAINT "product_price_history_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_price_history" ADD CONSTRAINT "product_price_history_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_categories" ADD CONSTRAINT "inventory_categories_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_voided_by_user_id_fkey" FOREIGN KEY ("voided_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_voided_by_user_id_fkey" FOREIGN KEY ("voided_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_items" ADD CONSTRAINT "expense_items_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_items" ADD CONSTRAINT "expense_items_expense_category_id_fkey" FOREIGN KEY ("expense_category_id") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_purchases" ADD CONSTRAINT "stock_purchases_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_purchases" ADD CONSTRAINT "stock_purchases_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_purchases" ADD CONSTRAINT "stock_purchases_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_purchases" ADD CONSTRAINT "stock_purchases_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_purchases" ADD CONSTRAINT "stock_purchases_voided_by_user_id_fkey" FOREIGN KEY ("voided_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_purchases" ADD CONSTRAINT "stock_purchases_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_purchase_items" ADD CONSTRAINT "stock_purchase_items_stock_purchase_id_fkey" FOREIGN KEY ("stock_purchase_id") REFERENCES "stock_purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_purchase_items" ADD CONSTRAINT "stock_purchase_items_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "inventory_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_default_supplier_id_fkey" FOREIGN KEY ("default_supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_closings" ADD CONSTRAINT "daily_closings_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_closings" ADD CONSTRAINT "daily_closings_closed_by_user_id_fkey" FOREIGN KEY ("closed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_closings" ADD CONSTRAINT "daily_closings_reopened_by_user_id_fkey" FOREIGN KEY ("reopened_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_transactions" ADD CONSTRAINT "owner_transactions_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_transactions" ADD CONSTRAINT "owner_transactions_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_transactions" ADD CONSTRAINT "owner_transactions_voided_by_user_id_fkey" FOREIGN KEY ("voided_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_balances" ADD CONSTRAINT "opening_balances_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_balances" ADD CONSTRAINT "opening_balances_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_records" ADD CONSTRAINT "sync_records_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_records" ADD CONSTRAINT "sync_records_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_records" ADD CONSTRAINT "sync_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Partial unique index: only one active recipe per product
CREATE UNIQUE INDEX "recipes_product_id_active_key" ON "recipes"("product_id") WHERE "is_active" = true;

-- Financial and inventory integrity checks
ALTER TABLE "products" ADD CONSTRAINT "products_selling_price_non_negative" CHECK ("selling_price_minor" >= 0);
ALTER TABLE "sales" ADD CONSTRAINT "sales_totals_non_negative" CHECK ("subtotal_minor" >= 0 AND "total_minor" >= 0);
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_unit_price_non_negative" CHECK ("unit_price_minor" >= 0);
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_line_total_non_negative" CHECK ("line_total_minor" >= 0);
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_amount_positive" CHECK ("amount_minor" > 0);
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_total_non_negative" CHECK ("total_minor" >= 0);
ALTER TABLE "expense_items" ADD CONSTRAINT "expense_items_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "expense_items" ADD CONSTRAINT "expense_items_unit_price_non_negative" CHECK ("unit_price_minor" >= 0);
ALTER TABLE "expense_items" ADD CONSTRAINT "expense_items_line_total_non_negative" CHECK ("line_total_minor" >= 0);
ALTER TABLE "stock_purchases" ADD CONSTRAINT "stock_purchases_total_non_negative" CHECK ("total_minor" >= 0);
ALTER TABLE "stock_purchase_items" ADD CONSTRAINT "stock_purchase_items_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "stock_purchase_items" ADD CONSTRAINT "stock_purchase_items_unit_price_non_negative" CHECK ("unit_price_minor" >= 0);
ALTER TABLE "stock_purchase_items" ADD CONSTRAINT "stock_purchase_items_line_total_non_negative" CHECK ("line_total_minor" >= 0);
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_quantity_non_negative" CHECK ("current_quantity" >= 0);
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_minimum_non_negative" CHECK ("minimum_level" >= 0);
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_average_cost_non_negative" CHECK ("average_cost_minor_per_unit" >= 0);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_quantity_delta_non_zero" CHECK ("quantity_delta" <> 0);
ALTER TABLE "owner_transactions" ADD CONSTRAINT "owner_transactions_amount_positive" CHECK ("amount_minor" > 0);
ALTER TABLE "opening_balances" ADD CONSTRAINT "opening_balances_non_negative" CHECK ("cash_minor" >= 0 AND "bank_minor" >= 0 AND "inventory_value_minor" >= 0);

