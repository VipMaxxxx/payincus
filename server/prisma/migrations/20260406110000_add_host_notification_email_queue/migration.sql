CREATE TYPE "HostNotificationEmailTaskStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED');

CREATE TABLE "host_notification_email_tasks" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "host_id" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "host_name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" "HostNotificationEmailTaskStatus" NOT NULL DEFAULT 'PENDING',
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "host_notification_email_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "host_notification_email_tasks_status_scheduled_for_idx" ON "host_notification_email_tasks"("status", "scheduled_for");
CREATE INDEX "host_notification_email_tasks_user_id_idx" ON "host_notification_email_tasks"("user_id");
CREATE INDEX "host_notification_email_tasks_host_id_idx" ON "host_notification_email_tasks"("host_id");
CREATE INDEX "host_notification_email_tasks_started_at_idx" ON "host_notification_email_tasks"("started_at");

ALTER TABLE "host_notification_email_tasks" ADD CONSTRAINT "host_notification_email_tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "host_notification_email_tasks" ADD CONSTRAINT "host_notification_email_tasks_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
