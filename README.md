A self-hosted SvelteKit newsletter studio with PostgreSQL, Better Auth, MJML,
and persistent image storage. No managed-service subscription is required.

## Hosted workspace

Users sign in to private projects. Each project has editable MJML templates,
newsletter editions, a reusable image library, and live HTML export permalinks.
Any project member can share a project with other provisioned accounts as editors
from the project's **Sharing** tab. Access covers all editions, templates, and
images in the project; newly added editors can also share it with others.
The Sharing tab lists everyone with access by name, email, and project role,
including the owner. The list updates after adding a member; use **Refresh members**
to check for access granted by others.
The server checks project membership for every project operation. Public
registration is blocked; administrators invite users from Admin settings or
create accounts with the provisioning script.

Images are intentionally public so email recipients can view them without
signing in. Project management, templates, and newsletter editing are private.
Each saved edition has an unlisted public HTML URL for Mailchimp import; anyone
with that link can fetch the latest saved newsletter without signing in.
Uploads accept static JPEG, PNG, and WebP images up to **5 MB / 20 megapixels**,
decode and normalize them to WebP, strip metadata, and create immutable URLs.
External HTTP(S) image URLs remain supported. Typed image fields store delivery
URLs, and the server verifies that hosted images belong to the
project and are available in the selected edition. Per-item alt text is supported
via a typed field such as `{{text:photo_alt}}`.

Use **Project images** in the project views or open an edition and use
**Edition images**. Uploads go to the library shown by that tab.
Project images are available
in every edition; edition images appear only in that edition's image choices
and its clones. Open and save an edition before uploading edition-only images.
Both scopes appear as separate groups in typed image selectors.
Direct item uploads also offer a project/edition destination.
Existing images remain project-wide after upgrading.

Edition scope controls editing and image selection, not private delivery:
the image URLs are still public so email recipients can load them.

In either image-library tab, **Upload images** accepts multiple files in one selection.
Files upload one at a time, with progress and a result for each filename.
Successful uploads immediately join the library; a failed file does not prevent
the remaining files from uploading. The size/type limits apply to each file,
and the existing thirty-uploads-per-user-per-minute limit still applies.
Retry failed files by selecting them again. Direct item uploads still select a
single image for that item.

Use **Delete image** on a library card to remove an unused image, with confirmation.
Images referenced by current saved edition content or project templates cannot
be deleted; local unsaved uses are protected as well. Clear draft references
and save first. Old HTML exports and imported Mailchimp campaigns do not protect
images: deleting an unused file can break images in a previously imported or
sent campaign.
For an unused edition image shared with clones, removal affects only the selected
edition library. The stored file is permanently removed only after its last
library association is removed. Shared project images are removed project-wide.
Deletion failures are reported explicitly and can be retried.

Saving newsletters or templates uses revision checks to prevent overwriting
another user's edits. Drafts stay in memory while switching projects; save them
to persist across refreshes. JSON export remains available for portable data
backups; the newsletter JSON import UI is not currently exposed in the workspace.
Templates can be imported from `.mjml` files.

The edition **Content** tab offers two editor layouts:
- **Split** keeps the full content form beside the live desktop/mobile preview.
- **Dynamic** lets you type directly into template-driven text in the preview.
  Click an image or link to select its field in the focused panel; the field
  selector also exposes URLs, alt text, numbers, and fields not visible in the
  rendered layout. **All fields & items** opens the full form for adding,
  removing, reordering, and uploading images to items.

Both layouts edit the same unsaved draft. Text is plain text (multiline fields
preserve line breaks), not arbitrary HTML. The preview refreshes after leaving
an inline text field so typing does not interrupt the cursor. Static template
content and styling stay in the Templates tab. Preview links do not navigate,
and template scripts remain disabled. Use **Save newsletter** to persist changes;
editor-only field markers are never included in saved content or HTML exports.
The layout preference is stored with each user account and restored across
editions, projects, browser refreshes, and sign-ins, including other devices.
Failed preference saves are shown explicitly and restore the previous layout.
Rename newsletters in the edition **Settings** tab alongside UTM settings.
The account panel at the bottom of the sidebar shows the user's profile and
button-style actions for **Admin settings** (administrators only),
**Change password**, and **Sign out**.
On screens up to 1100px wide, navigation starts collapsed behind **Menu** in the
workspace header. The drawer includes projects and account actions; selecting a
project or starting a new project closes it. Use its close button, Escape, or
the backdrop to dismiss it. Desktop navigation remains visible.

Action feedback appears as dismissible toasts instead of banners in the editor.
Success notifications disappear after five seconds, with the timer paused while
hovered or keyboard-focused. Errors remain until dismissed. The same notification
system is used for administrator and password actions; inline validation, preview
errors, save state, and detailed upload results remain beside their controls.

### Test and publish editions

The **Test & publish** tab can send a test of the latest saved edition, including
saved project templates and UTM settings. Unsaved content/template edits are not
sent. Configure the shared SMTP sender in **Admin settings → Email settings** first.
The same SMTP configuration is used for account emails and newsletter tests.

Enter up to **20 comma-separated email addresses** in **Project test recipients**
and click **Save recipients**, then **Send test email**. The recipient list is
stored in PostgreSQL for the whole project, shared across its editions and project
members, and restored on later visits. Revision checks prevent overwriting another
member's recipient edits or sending to a list changed since you loaded it;
reload the project if a conflict is reported. Saving an
empty list clears it. Addresses are normalized and duplicates are removed.

Each recipient receives a separate HTML email with a `[Test]` subject; the other
recipients' addresses are not exposed. The HTML uses the same renderer as the
public permalink. Tests are limited to five sends per user and per project per
minute. Success means SMTP acceptance, not confirmed inbox delivery. Partial or
failed deliveries produce explicit errors; check SMTP logs before retrying because
some recipients may already have received the test. Tests do not send campaigns.

### Live HTML permalinks for Mailchimp

Save an edition to create its **Public HTML permalink**, available in the edition's
**Test & publish** tab. Use **Copy link**, **Open HTML**, or **Download HTML**.
The Content, Settings, and Edition images tabs keep these controls out of the
editing area. Breadcrumbs show the current project and edition; click the project
to return to its editions overview without discarding drafts. Edition save status
and the save button are in the header beside the breadcrumbs.
The URL ends in `.html` and has its own random identifier, independent of the
edition id. It remains the same across saves; clones receive separate links.
Unsaved drafts have no public link.

The permalink renders the latest saved edition content, UTM settings, and
project templates on every request. Unsaved edits do not affect it. Responses
are ordinary UTF-8 HTML with caching disabled, so Mailchimp can fetch the same
URL again for updates. No sign-in, publish step, or snapshot is required.
Invalid saved MJML or missing template placeholders produce an explicit error
instead of serving stale HTML. HTML fetches are limited to 240 per edition
per minute. Deleting an edition makes its permalink return 404.

Mailchimp needs an internet-accessible deployment URL, normally HTTPS.
`127.0.0.1` and `localhost` URLs work only for local testing and cannot be
fetched by Mailchimp. Re-fetch/import the link in Mailchimp after saving changes;
this app does not automatically update Mailchimp campaigns or send campaigns.
Test emails are available separately in **Test & publish**.

The snapshot interface and creation endpoint have been removed. Existing legacy
snapshot records are retained without modification and their authenticated
read/download endpoints remain available for compatibility. They no longer
protect image files from deletion.
The image library can also be reused for future hero/header features; dedicated
hero/header controls are not included yet.

## Self-hosting with Docker Compose

Requirements: Docker with Compose, a domain pointed at the server, and open
ports 80/443. Copy `.env.example` to `.env` and configure:

```dotenv
POSTGRES_PASSWORD=<generated-hex-password>
POSTROOM_DB_PASSWORD=<independent-generated-hex-password>
BETTER_AUTH_SECRET=<generated-secret-at-least-32-characters>
APP_DOMAIN=newsletters.your-domain.com
APP_ORIGIN=https://newsletters.your-domain.com
```

Generate independent values for both database passwords and the auth secret locally with:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Use hex database passwords so they can safely be embedded in the Compose
connection URL. Never commit `.env`. Compose supplies its internal database
connection and upload directory; the local-development `DATABASE_URL` setting
is not used by the containers.

```sh
docker compose up --build -d
docker compose run --rm -it migrate npm run user:create -- person@example.com "Person Name"
```

The provisioning command prompts for a password without exposing it in command
arguments. Passwords must contain at least 12 characters. Provision additional
users the same way, or provision an administrator with `--admin`, configure SMTP
in **Admin settings**, and invite users there. Add their email addresses from a
project's **Sharing** tab to grant project access. Public self-service registration
remains blocked.

Compose runs migrations before starting the app. Caddy terminates HTTPS, serves
public images directly, and proxies the application. Only Caddy is exposed
publicly; PostgreSQL's optional host port binds to loopback. Database data,
uploaded images, and Caddy certificates use persistent named volumes.
The app runs as a non-root user with a separate, non-superuser PostgreSQL role.
Only the migration service uses database-owner credentials. The application role
cannot change image content/metadata or update/delete published snapshots.
Column-level grants allow marking unused images and library associations as
removed without deleting their metadata history.
The database image includes its initialization script, avoiding host bind-mount
execution permissions. Its health check verifies a TCP connection using the
application role before migrations start.
Projects and newsletters are stored in PostgreSQL; there is no browser-folder workspace.

The origin must match the browser URL exactly, without a trailing slash. It
controls authentication, origin checks, and absolute image URLs. Keep the image
hostname stable after sending emails. `/healthz` verifies database connectivity.
Sign-in attempts are limited to five per minute; uploads are limited to thirty
per user per minute and rendering to 240 per user per minute.

### VPS with an existing host-level reverse proxy

Use Docker Compose 2.24.4 or newer. If Caddy or Nginx already runs directly on
the VPS, use [compose.vps.yaml](./compose.vps.yaml) alongside the base Compose
file. This override keeps PostgreSQL internal, publishes the app only on
`127.0.0.1:3002`, and puts bundled Caddy behind the `bundled-proxy` profile so it
does not start by default. Check that host port 3002 is free before starting.
No changes to other applications' Docker networks are needed.

Keep deployment secrets in an untracked `.env.vps` file, configured with the
same variables shown above. Start and provision the application with:

```sh
docker compose --env-file .env.vps -p postroom -f compose.yaml -f compose.vps.yaml config --quiet
docker compose --env-file .env.vps -p postroom -f compose.yaml -f compose.vps.yaml up -d --build db migrate app
curl --fail --show-error http://127.0.0.1:3002/healthz
docker compose --env-file .env.vps -p postroom -f compose.yaml -f compose.vps.yaml run --rm -it migrate npm run user:create -- person@example.com "Person Name" --admin
```

If using `.env` instead, omit `--env-file .env.vps`. Keep the same project name,
environment file, and Compose files for status, logs, backups, and updates.
For published images, add `-f compose.registry.yaml` before
`-f compose.vps.yaml` and use the registry pull/no-build workflow below.
Do not enable the `bundled-proxy` profile on a host where ports 80/443 are
already in use.

For host-level Caddy, add a separate site block to its existing configuration,
preserving all other sites:

```caddyfile
newsletters.your-domain.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3002
}
```

Point the domain at the VPS and match it to `APP_DOMAIN` and `APP_ORIGIN`.
Validate the host's Caddy configuration before reloading it:

```sh
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
curl --fail --show-error https://newsletters.your-domain.com/healthz
```

Only reload after validation succeeds. Caddy manages HTTPS certificates.
For host-level Nginx, configure the HTTPS virtual host to proxy to
`http://127.0.0.1:3002`, preserve the original Host header, and allow request
bodies up to 13 MB. The app serves public images itself, so the existing proxy
does not need access to the uploads volume.

### Backups and updates

Back up **both** PostgreSQL and the uploads volume. Database backups alone cannot
restore images in sent newsletters. For example:

```sh
docker compose exec -T db pg_dump -U postroom_owner -d postroom -Fc > postroom.dump
docker compose run --rm --no-deps --entrypoint sh app -c 'tar -C /data/uploads -czf - .' > postroom-images.tgz
```

Store backups outside the server and verify restoration before relying on them.
Back up before upgrades, then rebuild with `docker compose up --build -d`;
application migrations are versioned and repeatable. Do not remove the named
volumes when updating. The local storage adapter is isolated so another storage
backend can be added later without changing newsletter item editing.

#### VPS update script

For the source-built host-proxy deployment above, run from the repository:

```sh
bash scripts/update-vps.sh
```

The default updates to `origin/main`. To install a specific release instead:

```sh
bash scripts/update-vps.sh v1.2.3
```

Replace the example tag with the actual release tag. The script refuses dirty
working trees, downgrades, and divergent updates. Release tags must include
`compose.vps.yaml`. It runs Git as your current user and uses sudo only for
Docker when necessary; do not run the entire script with sudo.

The script uses `.env`, project name `postroom`, and the base plus VPS Compose
files. It does not support registry-image deployments. Override the environment
filename or backup location when needed:

```sh
POSTROOM_ENV_FILE=.env.vps POSTROOM_BACKUP_DIR="$HOME/backups/postroom" bash scripts/update-vps.sh
```

Backups must be outside the repository. The script stops the app to back up the
database and images consistently, records the previous commit, and saves the
deployment environment and Compose files in a private timestamped directory.
It checks that both archives can be listed, but this is not a restoration test.
Backup exports run without interactive stdin or password prompts. PostgreSQL
exports fail explicitly if a table lock cannot be acquired within 30 seconds.
Progress messages identify each backup and deployment stage.
The private backup umask is restored before Git updates the source files.
Docker copies source files with ownership readable by the non-root tools user,
and makes the runtime package manifest readable regardless of checkout permissions.
The app remains unavailable during backups, rebuilding, and migrations.
Other applications and the host proxy are not changed.

Successful updates require a healthy app and a passing internal `/healthz`
request. Verify your public HTTPS URL separately afterward. Backups are retained
without automatic deletion; copy them off the VPS and protect `deployment.env`,
which contains secrets. On failure the script exits without an automatic
rollback, and the app may remain stopped. Failed Compose deployments print the
migration and application logs automatically. Inspect the error and migration logs
before restarting or restoring. An interrupted update can leave a
`.update-lock` directory in the backup root; remove it only after confirming no
update is running.

### Published release images on GitHub Container Registry

Publishing a GitHub release runs the **Publish release images** workflow. It
builds the released tag, not the current `main` branch, and publishes three
images for both Linux amd64 and arm64:

| Image | Purpose |
| --- | --- |
| `ghcr.io/team-switch-reclamebureau/newsletter-tool` | Application |
| `ghcr.io/team-switch-reclamebureau/newsletter-tool-tools` | Migrations and user provisioning |
| `ghcr.io/team-switch-reclamebureau/newsletter-tool-db` | PostgreSQL with the application-role initialization script |

Each image receives the release tag, for example `:v1.2.3`. After all three
images have been published successfully, the workflow also updates `:latest`
if this is GitHub's latest stable release. Prereleases get their version tag
without changing `:latest`. Wait for the workflow to finish successfully before
updating the VPS. A failed publication can be retried using **Re-run failed jobs**
in GitHub Actions.

Commit and push the workflow before creating the first release. The workflow
uses GitHub's built-in `GITHUB_TOKEN`; no registry password or VPS secrets need
to be added to the repository. GitHub Actions must be enabled and organization
policies must allow package publishing and the referenced actions.

#### Deploy or update the VPS without building from source

Use Docker Compose 2.24.4 or newer. Keep `compose.yaml`, `compose.registry.yaml`,
`Caddyfile`, and your private `.env` in the same deployment directory. The
registry override removes local builds but preserves the original service
configuration, migration dependencies, and persistent volumes.

GHCR packages are private by default. For private images, sign in on the VPS:

```sh
docker login ghcr.io -u YOUR_GITHUB_USERNAME
```

At the password prompt, enter a GitHub personal access token (classic) with
`read:packages` and access to this organization's packages. Authorize it for
organization SSO if required. Alternatively, make **all three** packages public
in their GitHub package settings to allow unauthenticated pulls.

After configuring the existing deployment environment variables, run:

```sh
docker compose -f compose.yaml -f compose.registry.yaml pull
docker compose -f compose.yaml -f compose.registry.yaml up -d --no-build
docker compose -f compose.yaml -f compose.registry.yaml ps
```

The default is `:latest`. To pin a specific release, set
`POSTROOM_VERSION=v1.2.3` in `.env`; the same version is used for the app,
migrations, and database. `POSTROOM_IMAGE` can override the image prefix for a
fork. Always use both Compose files for registry-based deployment, including
backups and provisioning:

```sh
docker compose -f compose.yaml -f compose.registry.yaml run --rm -it migrate npm run user:create -- person@example.com "Person Name" --admin
```

Back up the database and uploads before upgrades. Keep the same deployment
directory/Compose project name to reuse existing volumes, and never run
`down -v` during an update. PostgreSQL stays on major version 18; application
migrations run before the app starts. Do not downgrade after a database
migration without a compatible backup. The original `docker compose up --build -d`
workflow remains available for local source builds.

## Development

Use Node.js 24+, and PostgreSQL 18 (an existing server or the Compose database).
For the hosted app, copy `.env.example` to `.env`, set `DATABASE_URL`,
`BETTER_AUTH_SECRET`, and `APP_ORIGIN=http://localhost:5173`, then run:

```sh
npm install
npm run db:migrate
npm run user:create -- person@example.com "Person Name"
npm run dev -- --open
```

For the Compose database, the local administrative connection uses
`postgresql://postroom_owner:<POSTGRES_PASSWORD>@localhost:5432/postroom`.
Provisioning and migrations require the owner connection; a deployed application
should use `postroom_app` with `POSTROOM_DB_PASSWORD`, as Compose does automatically.
The database bootstrap script runs only on the first initialization of a new
database volume; changing passwords in `.env` alone does not rotate existing roles.

### Administrator settings

Application administrators are separate from project owners. No account becomes
an administrator automatically. Using the database-owner connection, provision
an administrator or grant that role to an existing account:

```sh
npm run user:create -- person@example.com "Person Name" --admin
npm run user:role -- person@example.com admin
# Remove administrator access without changing their project memberships:
npm run user:role -- person@example.com user
```

For Compose, run these commands through the `migrate` service, for example
`docker compose run --rm -it migrate npm run user:role -- person@example.com admin`.
These commands remain available for initial setup and recovery. Administrators
can also grant or revoke another user's administrator access in the UI.

Administrators see **Admin settings** in the workspace sidebar. The branding
section changes the application name, base color, and accent color for all accounts,
including the sign-in screen, with a preview and an explicit **Save settings**
action. Other sessions receive the updated branding on refresh. Changes do not
alter newsletter content, templates, image files, or newsletter HTML exports.
Concurrent settings edits use revision checks. **Restore defaults** fills in
the original branding; save to apply it.

**Base color** controls the overall interface palette (backgrounds, panels,
borders, and text). **Accent color** is used for primary buttons and the
application logo, with automatically contrasting button text. Both colors
appear in the live branding preview. Upgrading from the single-color setting
initializes both colors to the previously saved interface color.

### Account email and user management

In **Admin settings → Email settings**, save the SMTP hostname, port, security,
optional username/password, and sender address/name. Use STARTTLS (usually 587)
or implicit TLS (usually 465). TLS certificates are verified; unencrypted mode
is only for a trusted internal relay. The app must be able to reach the SMTP
server, and your provider must permit the chosen sender address.
**Send test email to me** sends using the saved settings.

SMTP passwords are encrypted in PostgreSQL using a key derived from
`BETTER_AUTH_SECRET`; they are never returned to the browser. Blank password
input preserves the current password; **Clear saved SMTP password** removes it.
If you rotate the auth secret, re-enter and save the SMTP password.
SMTP configuration edits use revision checks to prevent lost updates.

**User management** lists users and their invitation status. Invite a user by
name/email; they receive a one-hour link to choose their own password.
Pending invitations can be resent. If delivery fails, the pending account
remains in the list: refresh it, fix SMTP, then resend.
Grant/revoke administrator access separately from project membership.
Administrators cannot change their own role in the UI; another administrator
or the recovery CLI must do that. Role changes apply on subsequent requests.

Users can select **Forgot your password?** on the sign-in screen or **Change
password** in the workspace sidebar. Passwords must contain 12–128 characters.
Password recovery responses do not disclose whether an address has an account.
Reset/invitation links expire after one hour, are single-use, and sign out all
existing sessions when used. Completing a reset also invalidates other outstanding
password links for that user. Password changes require the current password and
sign out other sessions. Recovery requests and administrator email actions are
rate-limited. SMTP/delivery failures are reported rather than treated as success.

The same saved SMTP settings also deliver newsletter tests from **Test & publish**;
newsletter HTML exports do not send campaigns. Migrations run automatically during the normal deployment
update; no SMTP environment variables or update-script changes are required.

### Local testing with Docker PostgreSQL

Keep the database in Docker and run the development server on your computer.
Use these local settings in your ignored `.env`, along with independent generated
database passwords and an auth secret as described above:

```dotenv
COMPOSE_PROJECT_NAME=postroom-dev
POSTGRES_PORT=5432
APP_ORIGIN=http://127.0.0.1:5173
APP_DOMAIN=localhost
UPLOAD_DIR=./data/uploads
DATABASE_URL=postgresql://postroom_owner:<POSTGRES_PASSWORD>@127.0.0.1:5432/postroom
```

Replace `<POSTGRES_PASSWORD>` with the actual owner password. Restrict `.env`
permissions with `chmod 600 .env`, then start only the database service:

```sh
docker compose up -d --build --wait db
npm run db:migrate
# Run once to provision a local account:
npm run user:create -- developer@example.test "Local Developer"
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open **http://127.0.0.1:5173** and sign in with your provisioned account.
Use this exact address rather than `localhost` so authentication and image URLs
match `APP_ORIGIN`. If `.env` already contains `POSTROOM_TEST_EMAIL` and
`POSTROOM_TEST_PASSWORD`, they record local test credentials, not app settings.
Do not reuse test credentials in production or commit them.

Stop the development server with Ctrl+C. Use `docker compose stop db` to stop
PostgreSQL without removing its data; `docker compose up -d --wait db` restarts it.
Run the validation commands below to check the app. Integration tests use a
separate temporary database and do not modify this local workspace.

Without database and authentication configuration, the main page explains the
required setup. Preview rendering requires a configured server and a signed-in user.
The application uses the mutually supported SvelteKit 2 / Better Auth releases;
a targeted cookie dependency override supplies its patched serializer.

## Newsletter data and templates

Selecting a project opens an **Editions** overview table with edition names,
item counts, save status, and last-saved times. Search by name and sort by name
or saved time to manage larger sets of variations. Click **Open** to edit an
edition; **All editions** returns to the overview without discarding drafts.
Project views show **Editions**, **Templates**, and **Project images**.
Opening an edition shows only **Content**, **Settings**, and **Edition images**.
Its HTML permalink is visible above those views. Returning
with **All editions** restores the project views and keeps unsaved draft edits.
The assembled **MJML** source tab is not shown; template editing remains available.

### Edition UTM link tracking

Open an edition and use its **Settings** tab to enter **utm_source**, **utm_medium**,
**utm_campaign**, and **utm_term**, then click **Save edition settings**.
New editions start with blank values (tracking disabled).
For example, `mail`, `mail`, `nieuwsbrief`, and `october_26` produce
`?utm_source=mail&utm_medium=mail&utm_campaign=nieuwsbrief&utm_term=october_26`.
Values are editable text up to 200 characters and are URL-encoded.

Filled values replace the corresponding UTM parameters on HTTP(S) hyperlinks
throughout that edition, including literal template links and links
from edition fields. Other query parameters and URL fragments are preserved.
Blank fields leave existing parameters unchanged. Image URLs, image sources,
mailto links, relative links, and anchor links are unchanged. Both preview and
live HTML exports include tracking; newsletter data and original
templates retain their original URLs.
Saving edition settings also saves pending content changes in that edition,
using its revision check. Other editions keep their own independent values.
UTM settings are included in edition JSON exports and copied independently
when cloning. Upgrading from project-level UTM settings carries the project's
saved values into its existing editions.

Use **Delete** in the editions table or **Delete edition** in the editor.
Deletion requires confirmation and discards the edition's content and unsaved
changes. Unsaved editions are discarded locally; saved editions are removed
from the workspace with a revision check, and their HTML permalinks return 404.
Unused edition-only images are permanently removed; images used by clones,
other current saved content or templates are retained. Project images are
not removed. Save or discard dependent unsaved clones and image references
before deleting their source edition.
If physical image cleanup fails, the error is explicit: retry deletion before
reloading, or contact an administrator. Deletion markers and association history
are retained internally for history and cleanup retries.

Click **Clone** in a table row (or **Clone edition** in the editor), choose a new
name, and confirm **Clone newsletter**. The copy includes current content,
newsletter/item custom fields, item order, and selected images, including any
unsaved edits in the source. It gets fresh newsletter and item ids and timestamps.
It is a new unsaved draft: use **Save newsletter** to persist it. On its first
save, the clone gets its own associations to the source edition's image library,
reusing stored files and keeping their URLs unchanged. Later uploads remain
specific to their destination edition; they do not appear in existing clones.
Editing the copy does not change the source. Project templates remain shared
and the clone gets its own HTML permalink when saved.

Choose a project, click **New newsletter**, and give the edition a name. Each
edition has its own ordered list of items. Add, edit, remove, or reorder items
without changing other editions or the project templates. All content inputs
come from typed placeholders in the project template and item snippet.

Place exactly one `{{items}}` inside `mj-body` in the project template, where your
repeated item sections should appear. You can also use `{{newsletter_name}}`.

```xml
<mjml>
  <mj-body>
    <mj-section>
      <mj-column><mj-text>{{newsletter_name}}</mj-text></mj-column>
    </mj-section>
    {{items}}
  </mj-body>
</mjml>
```

An optional item snippet controls each repeated item's layout using typed
placeholders such as `{{text:title}}` and `{{image:photo}}`.

### Dynamic template fields

Use `{{type:name}}` to define input fields directly in MJML:

```xml
<!-- Main template: one set of fields for the newsletter -->
<mj-text>{{text:headline}}</mj-text>
<mj-text>{{textarea:introduction}}</mj-text>
{{items}}

<!-- Item snippet: a separate set of values for every repeated item -->
<mj-section>
  <mj-column>
    <mj-image src="{{image:photo}}" alt="{{text:photo_alt}}" />
    <mj-text>{{text:heading}}</mj-text>
    <mj-text>{{textarea:description}}</mj-text>
    <mj-text>Price: {{number:price}}</mj-text>
    <mj-button href="{{url:destination}}">{{text:link_label}}</mj-button>
  </mj-column>
</mj-section>
```

Types are `text` (single line), `textarea` (multiline), `url`, `image` (image URL),
and `number`. Image fields also offer the project's uploaded image library;
upload new images in the **Images** tab. URL/image values must be absolute HTTP(S)
URLs and numbers must be finite. All dynamic fields are optional; empty values
render as empty strings. Content is escaped, with textarea line breaks rendered
as `<br />`; user input is never interpreted as more placeholders.

For example, `<mj-image src="{{ image:hero_image }}" />` creates an image URL
input and an **Uploaded image for hero image** picker. Selecting an uploaded
image fills the URL automatically. The picker is disabled with an upload hint
when the project library is empty. This works in both template scopes.

Names start with an ASCII letter and may contain letters, digits, underscores,
hyphens, and dots. Repeating a tag reuses one input; assigning different types to
the same name in one scope is an error. Main-template and item-snippet names are
independent. Tags in comments do not create inputs.

The editor updates fields when you change templates. Values are saved in an optional
newsletter `fields` map and a required `fields` map on each item, including JSON exports
and rendered HTML exports. Changing or removing a tag does not delete its saved
value; restoring the tag restores the input. Renaming a tag creates a new field.
Items contain only `id` and `fields` in the editor. Legacy item properties are
ignored when loading saved editions; items without a `fields`
map start with an empty one, and existing typed values are preserved. Legacy
properties are not copied into typed values and are omitted from subsequent
saves and exports. Invalid typed field maps still produce an explicit error.
Untyped content placeholders such as `{{title}}` are not rendered; they produce
a template validation error, but do not prevent opening the project to update
its template. No automatic content migration or legacy editor is provided.
The structural template tokens `{{items}}`
and `{{newsletter_name}}` remain supported. Newsletter names are edited in
edition **Settings**, not in either content editor layout.
For example:

```xml
<mj-section>
  <mj-column>
    <mj-image src="{{image:photo}}" alt="{{text:photo_alt}}" />
    <mj-text font-size="24px">{{text:title}}</mj-text>
    <mj-text>{{textarea:body}}</mj-text>
    <mj-button href="{{url:destination}}">{{text:button_label}}</mj-button>
  </mj-column>
</mj-section>
```

When the item snippet is unset, the app supplies a typed standard layout with
image, image_alt, title, text, button, and url field names. It omits empty images
and incomplete buttons. Custom snippets should be designed for the fields you use.
Content is escaped rather than interpreted as HTML; text line breaks are preserved.
Unknown placeholders, invalid fields, and missing template slots are shown as
preview errors. The preview updates automatically as you edit, and the MJML view
shows the assembled source.

**Save newsletter** persists the edition in PostgreSQL. **Export JSON** in Test & publish downloads
versioned data containing all fields, item order, ids, and timestamps. JSON parsing
and serialization remain available for future import workflows, but there is no
newsletter import control in the current workspace.

Templates, newsletter data, and assembled previews are limited to 1 MB each.
Preview HTML is isolated in a sandboxed iframe
without script execution or top-level navigation permissions. Remote images may still
be fetched by your browser.

Use self-contained MJML templates: `mj-include` is not supported. Use absolute
image URLs or uploaded library images. Rendering requires the authenticated
SvelteKit server; this is not a static-only application.

## Validation

```sh
npm run check
npm test
npm run build
npm run test:integration
```

Integration tests start a temporary, real PostgreSQL cluster using bundled
development binaries and the built Node server. They require no Docker or
production credentials, and remove their test database and image files afterwards.
They verify login, membership isolation, image normalization/public delivery,
revision conflicts, stable public HTML permalinks, live export updates, deletion,
UTM tracking, and legacy read-only export compatibility.

## Roadmap

- [ ] Creating a release makes the new version available for download and deployment via ghcr.io