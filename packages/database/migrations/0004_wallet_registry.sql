CREATE TABLE "indexed_transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"wallet_id" uuid NOT NULL,
	"cluster" "cluster" NOT NULL,
	"signature" text NOT NULL,
	"slot" bigint NOT NULL,
	"block_time" timestamp with time zone,
	"status" text NOT NULL,
	"confirmation_status" text,
	"memo" text,
	"fee_lamports" numeric(39, 0),
	"sol_change_lamports" numeric(39, 0),
	"details_retrieved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "indexed_transactions_wallet_signature_unique" UNIQUE("wallet_id","signature"),
	CONSTRAINT "indexed_transactions_status_check" CHECK ("indexed_transactions"."status" in ('succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "managed_wallets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"address" text NOT NULL,
	"cluster" "cluster" NOT NULL,
	"label" text NOT NULL,
	"purpose" text,
	"category" text NOT NULL,
	"custody_type" text NOT NULL,
	"notes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "managed_wallets_org_address_cluster_unique" UNIQUE("organization_id","address","cluster"),
	CONSTRAINT "managed_wallets_status_check" CHECK ("managed_wallets"."status" in ('active', 'archived')),
	CONSTRAINT "managed_wallets_category_check" CHECK ("managed_wallets"."category" in ('TREASURY', 'TRADING', 'OPERATIONS', 'DEVELOPMENT', 'TOKEN_ISSUANCE', 'RESEARCH', 'COLD_STORAGE', 'WATCH_ONLY')),
	CONSTRAINT "managed_wallets_custody_type_check" CHECK ("managed_wallets"."custody_type" in ('BROWSER_WALLET', 'LOCAL_ENCRYPTED', 'WATCH_ONLY')),
	CONSTRAINT "managed_wallets_watch_only_category_check" CHECK ("managed_wallets"."category" <> 'WATCH_ONLY' or "managed_wallets"."custody_type" = 'WATCH_ONLY')
);
--> statement-breakpoint
CREATE TABLE "wallet_assignments" (
	"wallet_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"assigned_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_assignments_wallet_id_user_id_role_pk" PRIMARY KEY("wallet_id","user_id","role"),
	CONSTRAINT "wallet_assignments_role_check" CHECK ("wallet_assignments"."role" in ('CREATOR', 'FUNDER', 'CONTROLLER', 'VIEWER'))
);
--> statement-breakpoint
CREATE TABLE "wallet_ownership_challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"address" text NOT NULL,
	"cluster" "cluster" NOT NULL,
	"nonce" text NOT NULL,
	"message" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "wallet_ownership_challenges_nonce_unique" UNIQUE("nonce")
);
--> statement-breakpoint
CREATE TABLE "wallet_sync_state" (
	"wallet_id" uuid PRIMARY KEY NOT NULL,
	"newest_signature" text,
	"oldest_signature" text,
	"backfill_complete" boolean DEFAULT false NOT NULL,
	"indexed_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"last_failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_tags" (
	"wallet_id" uuid NOT NULL,
	"tag" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_tags_wallet_id_tag_pk" PRIMARY KEY("wallet_id","tag")
);
--> statement-breakpoint
ALTER TABLE "indexed_transactions" ADD CONSTRAINT "indexed_transactions_wallet_id_managed_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."managed_wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_wallets" ADD CONSTRAINT "managed_wallets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_wallets" ADD CONSTRAINT "managed_wallets_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_assignments" ADD CONSTRAINT "wallet_assignments_wallet_id_managed_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."managed_wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_assignments" ADD CONSTRAINT "wallet_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_assignments" ADD CONSTRAINT "wallet_assignments_assigned_by_user_id_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_ownership_challenges" ADD CONSTRAINT "wallet_ownership_challenges_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_ownership_challenges" ADD CONSTRAINT "wallet_ownership_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_sync_state" ADD CONSTRAINT "wallet_sync_state_wallet_id_managed_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."managed_wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_tags" ADD CONSTRAINT "wallet_tags_wallet_id_managed_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."managed_wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "indexed_transactions_wallet_slot_idx" ON "indexed_transactions" USING btree ("wallet_id","slot");--> statement-breakpoint
CREATE INDEX "managed_wallets_org_cluster_created_idx" ON "managed_wallets" USING btree ("organization_id","cluster","created_at");--> statement-breakpoint
CREATE INDEX "wallet_assignments_user_id_idx" ON "wallet_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "wallet_ownership_challenges_expires_at_idx" ON "wallet_ownership_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "wallet_tags_tag_idx" ON "wallet_tags" USING btree ("tag");