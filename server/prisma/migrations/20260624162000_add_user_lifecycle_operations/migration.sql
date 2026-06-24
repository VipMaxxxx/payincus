CREATE TYPE "UserLifecycleTagKey" AS ENUM ('new_user', 'paid_user', 'high_value', 'expiring_soon', 'churn_risk', 'risk_flag');
CREATE TYPE "UserLifecycleEventType" AS ENUM ('registered', 'first_login', 'first_recharge', 'first_purchase', 'renewed', 'expiring', 'churn_risk', 'winback');
CREATE TYPE "UserLifecycleActionType" AS ENUM ('add_tag', 'remove_tag', 'assign_segment', 'remove_segment', 'issue_redeem_code', 'send_reminder');
CREATE TYPE "UserLifecycleActionStatus" AS ENUM ('success', 'failed');

ALTER TABLE "redeem_codes"
  ADD COLUMN "target_user_id" INTEGER;

CREATE TABLE "user_lifecycle_tags" (
  "id" SERIAL NOT NULL,
  "user_id" INTEGER NOT NULL,
  "tag_key" "UserLifecycleTagKey" NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "note" TEXT,
  "assigned_by_user_id" INTEGER,
  "assigned_by_username" TEXT,
  "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removed_at" TIMESTAMP(3),
  CONSTRAINT "user_lifecycle_tags_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_lifecycle_segment_rules" (
  "id" SERIAL NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "rule" JSONB NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_lifecycle_segment_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_lifecycle_segment_members" (
  "id" SERIAL NOT NULL,
  "segment_rule_id" INTEGER NOT NULL,
  "user_id" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "matched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_lifecycle_segment_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_lifecycle_events" (
  "id" SERIAL NOT NULL,
  "user_id" INTEGER NOT NULL,
  "event_type" "UserLifecycleEventType" NOT NULL,
  "event_key" TEXT NOT NULL,
  "source_type" TEXT,
  "source_id" INTEGER,
  "metadata" JSONB,
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_lifecycle_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_lifecycle_actions" (
  "id" SERIAL NOT NULL,
  "action_type" "UserLifecycleActionType" NOT NULL,
  "status" "UserLifecycleActionStatus" NOT NULL DEFAULT 'success',
  "target_user_id" INTEGER,
  "actor_user_id" INTEGER NOT NULL,
  "actor_username" TEXT NOT NULL,
  "payload" JSONB,
  "result" JSONB,
  "message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_lifecycle_actions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_lifecycle_tags_user_id_tag_key_key" ON "user_lifecycle_tags"("user_id", "tag_key");
CREATE INDEX "user_lifecycle_tags_tag_key_active_idx" ON "user_lifecycle_tags"("tag_key", "active");
CREATE INDEX "user_lifecycle_tags_assigned_by_user_id_idx" ON "user_lifecycle_tags"("assigned_by_user_id");

CREATE UNIQUE INDEX "user_lifecycle_segment_rules_key_key" ON "user_lifecycle_segment_rules"("key");
CREATE INDEX "user_lifecycle_segment_rules_enabled_idx" ON "user_lifecycle_segment_rules"("enabled");

CREATE UNIQUE INDEX "user_lifecycle_segment_members_segment_rule_id_user_id_key" ON "user_lifecycle_segment_members"("segment_rule_id", "user_id");
CREATE INDEX "user_lifecycle_segment_members_user_id_idx" ON "user_lifecycle_segment_members"("user_id");
CREATE INDEX "user_lifecycle_segment_members_matched_at_idx" ON "user_lifecycle_segment_members"("matched_at");

CREATE UNIQUE INDEX "user_lifecycle_events_event_key_key" ON "user_lifecycle_events"("event_key");
CREATE INDEX "user_lifecycle_events_user_id_event_type_idx" ON "user_lifecycle_events"("user_id", "event_type");
CREATE INDEX "user_lifecycle_events_event_type_occurred_at_idx" ON "user_lifecycle_events"("event_type", "occurred_at");
CREATE INDEX "user_lifecycle_events_source_type_source_id_idx" ON "user_lifecycle_events"("source_type", "source_id");

CREATE INDEX "user_lifecycle_actions_action_type_created_at_idx" ON "user_lifecycle_actions"("action_type", "created_at");
CREATE INDEX "user_lifecycle_actions_target_user_id_created_at_idx" ON "user_lifecycle_actions"("target_user_id", "created_at");
CREATE INDEX "user_lifecycle_actions_actor_user_id_idx" ON "user_lifecycle_actions"("actor_user_id");

CREATE INDEX "redeem_codes_target_user_id_idx" ON "redeem_codes"("target_user_id");

ALTER TABLE "user_lifecycle_tags"
  ADD CONSTRAINT "user_lifecycle_tags_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_lifecycle_segment_members"
  ADD CONSTRAINT "user_lifecycle_segment_members_segment_rule_id_fkey" FOREIGN KEY ("segment_rule_id") REFERENCES "user_lifecycle_segment_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_lifecycle_segment_members"
  ADD CONSTRAINT "user_lifecycle_segment_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_lifecycle_events"
  ADD CONSTRAINT "user_lifecycle_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_lifecycle_actions"
  ADD CONSTRAINT "user_lifecycle_actions_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "user_lifecycle_actions"
  ADD CONSTRAINT "user_lifecycle_actions_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
