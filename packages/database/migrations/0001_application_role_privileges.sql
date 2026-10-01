-- Least-privilege grants for the runtime role (docs/architecture/database.md §2, FND-AC-07, AUD-AC-02).
-- The sct_app role must exist in every environment before migrations run.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sct_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sct_app;
--> statement-breakpoint
-- The audit log is append-only for the application.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE audit_events FROM sct_app;
--> statement-breakpoint
-- Reference data is managed by migrations and seeds only.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE permissions, role_permissions FROM sct_app;
