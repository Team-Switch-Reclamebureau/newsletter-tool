ALTER TABLE email_signatures ADD COLUMN instruction_text text NOT NULL DEFAULT ''
    CHECK (length(instruction_text) <= 10000);

CREATE TABLE signature_downloads (
    id uuid PRIMARY KEY,
    signature_id uuid NOT NULL REFERENCES email_signatures(id) ON DELETE CASCADE,
    html text NOT NULL CHECK (octet_length(html) > 0),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX signature_downloads_signature_id ON signature_downloads(signature_id);
