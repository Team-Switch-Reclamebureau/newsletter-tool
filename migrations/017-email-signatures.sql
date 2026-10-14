CREATE TABLE email_signatures (
    id uuid PRIMARY KEY,
    user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
    revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_signatures_user_id ON email_signatures(user_id);

CREATE TABLE signature_variations (
    id uuid PRIMARY KEY,
    signature_id uuid NOT NULL REFERENCES email_signatures(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
    filename text NOT NULL,
    html text NOT NULL CHECK (octet_length(html) BETWEEN 1 AND 1048576),
    UNIQUE (signature_id, name)
);

CREATE TABLE signature_contacts (
    id uuid PRIMARY KEY,
    signature_id uuid NOT NULL REFERENCES email_signatures(id) ON DELETE CASCADE,
    fields jsonb NOT NULL CHECK (jsonb_typeof(fields) = 'object')
);
CREATE INDEX signature_contacts_signature_id ON signature_contacts(signature_id);
