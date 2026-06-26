-- CreateTable
CREATE TABLE "plugin_storage_items" (
    "id" SERIAL NOT NULL,
    "plugin_id" TEXT NOT NULL,
    "scope_type" TEXT NOT NULL,
    "scope_id" TEXT NOT NULL DEFAULT '_',
    "key" TEXT NOT NULL,
    "value_json" JSONB NOT NULL DEFAULT '{}',
    "created_by_user_id" INTEGER,
    "updated_by_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plugin_storage_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plugin_storage_items_plugin_id_scope_type_scope_id_key_key" ON "plugin_storage_items"("plugin_id", "scope_type", "scope_id", "key");

-- CreateIndex
CREATE INDEX "plugin_storage_items_plugin_id_idx" ON "plugin_storage_items"("plugin_id");

-- CreateIndex
CREATE INDEX "plugin_storage_items_scope_type_scope_id_idx" ON "plugin_storage_items"("scope_type", "scope_id");

-- CreateIndex
CREATE INDEX "plugin_storage_items_created_by_user_id_idx" ON "plugin_storage_items"("created_by_user_id");

-- CreateIndex
CREATE INDEX "plugin_storage_items_updated_by_user_id_idx" ON "plugin_storage_items"("updated_by_user_id");

-- AddForeignKey
ALTER TABLE "plugin_storage_items" ADD CONSTRAINT "plugin_storage_items_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plugin_storage_items" ADD CONSTRAINT "plugin_storage_items_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
