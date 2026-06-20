ALTER TABLE "instances"
ADD COLUMN "display_order" INTEGER NOT NULL DEFAULT 0;

WITH ordered_instances AS (
  SELECT
    "id",
    (ROW_NUMBER() OVER (
      PARTITION BY "user_id"
      ORDER BY "created_at" DESC, "id" ASC
    ) - 1) * 1000 AS "initial_display_order"
  FROM "instances"
)
UPDATE "instances"
SET "display_order" = ordered_instances."initial_display_order"
FROM ordered_instances
WHERE "instances"."id" = ordered_instances."id";

CREATE INDEX "instances_user_id_display_order_created_at_idx"
ON "instances"("user_id", "display_order", "created_at" DESC);
