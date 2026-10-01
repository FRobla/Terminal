-- Owner console (SPEC-026 OWN-AC-12): the application role may read which migrations were applied.
GRANT USAGE ON SCHEMA drizzle TO sct_app;
--> statement-breakpoint
GRANT SELECT ON TABLE drizzle.__drizzle_migrations TO sct_app;
--> statement-breakpoint
-- Explicit grants for the Iteration 01.5 tables (the default privileges from 0001 also cover them).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE user_preferences, platform_settings TO sct_app;
