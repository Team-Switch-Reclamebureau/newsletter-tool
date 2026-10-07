CREATE TABLE projects (
    id uuid PRIMARY KEY,
    name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
    template text NOT NULL CHECK (octet_length(template) <= 1048576),
    item_template text CHECK (octet_length(item_template) <= 1048576),
    revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_by text NOT NULL REFERENCES "user"(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE project_members (
    project_id uuid NOT NULL REFERENCES projects(id),
    user_id text NOT NULL REFERENCES "user"(id),
    role text NOT NULL CHECK (role IN ('owner', 'editor')),
    PRIMARY KEY (project_id, user_id)
);
CREATE INDEX project_members_user ON project_members(user_id);

CREATE TABLE newsletters (
    id uuid PRIMARY KEY,
    project_id uuid NOT NULL REFERENCES projects(id),
    content jsonb NOT NULL CHECK (octet_length(content::text) <= 1048576),
    revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_by text NOT NULL REFERENCES "user"(id),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX newsletters_project ON newsletters(project_id);

CREATE TABLE image_assets (
    id uuid PRIMARY KEY,
    project_id uuid NOT NULL REFERENCES projects(id),
    original_name text NOT NULL,
    width integer NOT NULL CHECK (width > 0),
    height integer NOT NULL CHECK (height > 0),
    bytes integer NOT NULL CHECK (bytes BETWEEN 1 AND 5242880),
    created_by text NOT NULL REFERENCES "user"(id),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX image_assets_project ON image_assets(project_id);

CREATE TABLE newsletter_publications (
    id uuid PRIMARY KEY,
    newsletter_id uuid NOT NULL REFERENCES newsletters(id),
    project_id uuid NOT NULL REFERENCES projects(id),
    content jsonb NOT NULL,
    mjml text NOT NULL,
    html text NOT NULL,
    created_by text NOT NULL REFERENCES "user"(id),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX newsletter_publications_project ON newsletter_publications(project_id);

CREATE TABLE api_rate_limits (
    key text PRIMARY KEY,
    window_start timestamptz NOT NULL,
    attempts integer NOT NULL
);
