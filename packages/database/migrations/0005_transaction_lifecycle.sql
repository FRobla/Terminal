CREATE TABLE "idempotency_keys" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_organization_id_user_id_scope_key_pk" PRIMARY KEY("organization_id","user_id","scope","key")
);
--> statement-breakpoint
CREATE TABLE "transaction_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"initiated_by_user_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"cluster" "cluster" NOT NULL,
	"purpose" text NOT NULL,
	"state" text NOT NULL,
	"fee_payer" text NOT NULL,
	"signers" jsonb NOT NULL,
	"intent" jsonb NOT NULL,
	"expected_effects" jsonb NOT NULL,
	"review" jsonb,
	"simulation_result" jsonb,
	"message_bytes" "bytea" NOT NULL,
	"message_hash" "bytea" NOT NULL,
	"unsigned_transaction" "bytea" NOT NULL,
	"signed_transaction" "bytea",
	"recent_blockhash" text NOT NULL,
	"last_valid_block_height" bigint NOT NULL,
	"signature" text,
	"failure" jsonb,
	"reconciliation" jsonb,
	"idempotency_key" text NOT NULL,
	"last_sent_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_records_signature_unique" UNIQUE("signature")
);
--> statement-breakpoint
CREATE TABLE "transaction_state_transitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"transaction_id" uuid NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"request_id" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_records" ADD CONSTRAINT "transaction_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_records" ADD CONSTRAINT "transaction_records_initiated_by_user_id_users_id_fk" FOREIGN KEY ("initiated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_records" ADD CONSTRAINT "transaction_records_wallet_id_managed_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."managed_wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_state_transitions" ADD CONSTRAINT "transaction_state_transitions_transaction_id_transaction_records_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transaction_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transaction_records_org_created_idx" ON "transaction_records" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "transaction_records_wallet_idx" ON "transaction_records" USING btree ("wallet_id");--> statement-breakpoint
CREATE INDEX "transaction_records_open_state_idx" ON "transaction_records" USING btree ("state") WHERE "transaction_records"."state" in ('SUBMITTED', 'CONFIRMING', 'CONFIRMED', 'RECONCILIATION_REQUIRED');--> statement-breakpoint
CREATE INDEX "transaction_state_transitions_tx_idx" ON "transaction_state_transitions" USING btree ("transaction_id","occurred_at");--> statement-breakpoint
-- The transition history is append-only for the application (SPEC-004 §3).
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE transaction_state_transitions FROM sct_app;
