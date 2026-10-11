# @xq/db — the Supabase project

Accounts (v0.2) run on [Supabase](https://supabase.com). This package holds everything the
project needs, so it can be rebuilt from the repository:

| Path | What |
| --- | --- |
| `supabase/migrations/` | Tables, row-level security, triggers. Applied in name order, never edited once applied: add a new file instead. |
| `supabase/templates/` | Sign-up, password-reset and email-change emails, in English and Chinese. |
| `supabase/functions/record/` | The `record` edge function: checks a finished bot game or puzzle attempt (with `@xq/records`) and saves it with the new rating. |
| `scripts/apply.mjs` | Applies new migrations and the auth settings (redirect URLs, email confirmation, password length, templates). |
| `scripts/functions.mjs` | Bundles the edge functions with the workspace code they use and deploys them. |
| `test/rls.test.ts` | Runs the migrations in an in-memory Postgres (PGlite) and checks one user can't reach another's rows. |

## Apply to a project

Needs a personal access token from <https://supabase.com/dashboard/account/tokens>, kept
outside the repository (e.g. `~/.config/xiangqi-supabase-token`, mode 600):

```sh
export SUPABASE_ACCESS_TOKEN=$(cat ~/.config/xiangqi-supabase-token)
pnpm --filter @xq/db apply -- --dry-run   # show what would change
pnpm --filter @xq/db apply
```

The project is the one in `apps/web/.env`, or `SUPABASE_PROJECT_REF=<ref>`.

The edge functions deploy the same way (the token needs the edge-functions write permission):

```sh
pnpm --filter @xq/db functions -- --dry-run   # bundle only, into dist/functions/
pnpm --filter @xq/db functions
```

Account deletion runs as a daily `pg_cron` job (`purge-deleted-accounts`, 03:17 UTC), set up by
migration `20261011000000_account_deletion.sql`.

## Keys

- **Publishable key** (`sb_publishable_…`): built into the site (`apps/web/.env`). Public by design.
- **Secret / service-role key**: bypasses row-level security. Only the edge functions may
  hold it, as a Supabase secret. Never in this repository, the site, or chat.

## Running on the free plan

The project stays on Supabase's free plan. Three things make that work:

**Keep-alive.** Supabase pauses a free project after about a week with no activity.
`.github/workflows/keepalive.yml` asks the database one public question every three days. A
failed run means the project is paused or down: restore it from the Supabase dashboard (free),
then re-run the workflow. GitHub turns scheduled workflows off after 60 days without a commit;
it emails first, and one click in the Actions tab turns them back on.

**Backups.** The free plan has none. `.github/workflows/backup.yml` dumps the `auth` and
`public` schemas every Sunday, encrypts the dump (artifacts of a public repository are
downloadable by anyone signed in to GitHub) and keeps it for 90 days. It needs two repository
secrets: `SUPABASE_DB_URL` (dashboard → Connect → Session pooler, password filled in) and
`BACKUP_PASSPHRASE` (keep a copy outside GitHub).

To restore into a new, empty project:

```sh
gpg --decrypt xiangqi-db-YYYY-MM-DD.dump.gpg > backup.dump
SUPABASE_PROJECT_REF=<new ref> pnpm --filter @xq/db apply      # tables, functions, auth settings
pg_restore --data-only --schema=auth --schema=public --file=data.sql backup.dump
psql "$NEW_DB_URL" -c "SET session_replication_role = replica" -f data.sql
```

`session_replication_role = replica` keeps triggers (such as the one that makes a profile for
each new user) from firing while rows are copied in. Then deploy the functions
(`pnpm --filter @xq/db functions`) and set the providers' client secrets again in the dashboard.

**Email sender.** Supabase's built-in sender allows only a few emails an hour and no custom
templates. A Gmail account sends up to about 500 a day for free:

1. On the Google account, turn on 2-Step Verification, then create an app password
   (Google Account → Security → App passwords).
2. Supabase dashboard → Authentication → Emails → SMTP Settings → enable custom SMTP:
   host `smtp.gmail.com`, port `465`, username and sender email = the Gmail address,
   password = the app password, sender name `Xiangqi School 象棋学堂`.
3. Run `pnpm --filter @xq/db apply` to install the bilingual email templates (it skips them
   while the built-in sender is in use).
