#!/bin/sh
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
	--set=app_password="$POSTROOM_DB_PASSWORD" <<'SQL'
CREATE ROLE postroom_app LOGIN PASSWORD :'app_password';
GRANT CONNECT ON DATABASE postroom TO postroom_app;
GRANT USAGE ON SCHEMA public TO postroom_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO postroom_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO postroom_app;
SQL
