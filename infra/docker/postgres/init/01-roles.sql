-- Local development roles (docs/architecture/database.md §2). Passwords are local-only.
-- sct_migrator owns the schema and runs migrations; sct_app is the least-privilege runtime role.
CREATE ROLE sct_migrator LOGIN PASSWORD 'change-me';
CREATE ROLE sct_app LOGIN PASSWORD 'change-me';

ALTER DATABASE solana_terminal OWNER TO sct_migrator;
CREATE DATABASE solana_terminal_test OWNER sct_migrator;

\connect solana_terminal
ALTER SCHEMA public OWNER TO sct_migrator;
GRANT USAGE ON SCHEMA public TO sct_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

\connect solana_terminal_test
ALTER SCHEMA public OWNER TO sct_migrator;
GRANT USAGE ON SCHEMA public TO sct_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
