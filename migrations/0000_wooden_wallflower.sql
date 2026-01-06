CREATE TABLE "acquisitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"listing_id" integer NOT NULL,
	"status" text NOT NULL,
	"notes" text,
	"contacted_at" timestamp DEFAULT now() NOT NULL,
	"result_date" timestamp
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"company" text,
	"phone" text,
	"email" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovered_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"category" text,
	"region" text,
	"phone_number" text,
	"discovered_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "discovered_links_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "listing_contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"listing_id" integer NOT NULL,
	"contact_id" integer NOT NULL,
	"assigned_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"price" integer NOT NULL,
	"location" text NOT NULL,
	"area" numeric(10, 2),
	"eur_per_m2" numeric(10, 2),
	"description" text,
	"phone_number" text,
	"images" json DEFAULT '[]'::json,
	"url" text NOT NULL,
	"scraped_at" timestamp DEFAULT now() NOT NULL,
	"akquise_erledigt" boolean DEFAULT false NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deletion_reason" text,
	"price_evaluation" text,
	"category" text NOT NULL,
	"region" text NOT NULL,
	CONSTRAINT "listings_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "price_mirror_data" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"region" text NOT NULL,
	"average_price" integer,
	"average_area" integer,
	"price_per_sqm" integer,
	"sample_size" integer,
	"scraped_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scraper_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"state_key" text NOT NULL,
	"next_page" integer NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scraper_state_state_key_unique" UNIQUE("state_key")
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"login_time" timestamp DEFAULT now() NOT NULL,
	"logout_time" timestamp,
	"session_duration" integer,
	"ip_address" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"last_login" timestamp,
	"total_logins" integer DEFAULT 0,
	"total_session_time" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "acquisitions" ADD CONSTRAINT "acquisitions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acquisitions" ADD CONSTRAINT "acquisitions_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_contacts" ADD CONSTRAINT "listing_contacts_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_contacts" ADD CONSTRAINT "listing_contacts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "price_mirror_category_region_unique" ON "price_mirror_data" USING btree ("category","region");