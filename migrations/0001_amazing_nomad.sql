ALTER TABLE "listings" ADD COLUMN "last_changed_at" timestamp;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "deleted_by_user_id" integer;