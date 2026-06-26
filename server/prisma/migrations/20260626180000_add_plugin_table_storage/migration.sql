CREATE TABLE "plugin_table_rows" (
    "id" SERIAL NOT NULL,
    "plugin_id" TEXT NOT NULL,
    "table_name" TEXT NOT NULL,
    "scope_type" TEXT NOT NULL,
    "scope_id" TEXT NOT NULL DEFAULT '_',
    "row_key" TEXT NOT NULL,
    "value_json" JSONB NOT NULL DEFAULT '{}',
    "created_by_user_id" INTEGER,
    "updated_by_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plugin_table_rows_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "plugin_table_migrations" (
    "id" SERIAL NOT NULL,
    "plugin_id" TEXT NOT NULL,
    "table_name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "applied_by_user_id" INTEGER NOT NULL,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plugin_table_migrations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plugin_table_rows_plugin_id_table_name_scope_type_scope_id_row_key_key" ON "plugin_table_rows"("plugin_id", "table_name", "scope_type", "scope_id", "row_key");
CREATE INDEX "plugin_table_rows_plugin_id_idx" ON "plugin_table_rows"("plugin_id");
CREATE INDEX "plugin_table_rows_plugin_id_table_name_idx" ON "plugin_table_rows"("plugin_id", "table_name");
CREATE INDEX "plugin_table_rows_scope_type_scope_id_idx" ON "plugin_table_rows"("scope_type", "scope_id");
CREATE INDEX "plugin_table_rows_created_by_user_id_idx" ON "plugin_table_rows"("created_by_user_id");
CREATE INDEX "plugin_table_rows_updated_by_user_id_idx" ON "plugin_table_rows"("updated_by_user_id");

CREATE UNIQUE INDEX "plugin_table_migrations_plugin_id_table_name_version_key" ON "plugin_table_migrations"("plugin_id", "table_name", "version");
CREATE INDEX "plugin_table_migrations_plugin_id_idx" ON "plugin_table_migrations"("plugin_id");
CREATE INDEX "plugin_table_migrations_plugin_id_table_name_idx" ON "plugin_table_migrations"("plugin_id", "table_name");
CREATE INDEX "plugin_table_migrations_applied_by_user_id_idx" ON "plugin_table_migrations"("applied_by_user_id");
CREATE INDEX "plugin_table_migrations_applied_at_idx" ON "plugin_table_migrations"("applied_at");

ALTER TABLE "plugin_table_rows" ADD CONSTRAINT "plugin_table_rows_plugin_id_fkey" FOREIGN KEY ("plugin_id") REFERENCES "plugins"("plugin_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "plugin_table_migrations" ADD CONSTRAINT "plugin_table_migrations_plugin_id_fkey" FOREIGN KEY ("plugin_id") REFERENCES "plugins"("plugin_id") ON DELETE CASCADE ON UPDATE CASCADE;
