# @xq/db — the Supabase project

Accounts (v0.2) run on [Supabase](https://supabase.com). This package holds everything the
project needs, so it can be rebuilt from the repository:

| Path | What |
| --- | --- |
| `supabase/migrations/` | Tables, row-level security, triggers. Applied in name order, never edited once applied: add a new file instead. |
| `supabase/templates/` | Sign-up, password-reset and email-change emails, in English and Chinese. |
| `scripts/apply.mjs` | Applies new migrations and the auth settings (redirect URLs, email confirmation, password length, templates). |
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

## Keys

- **Publishable key** (`sb_publishable_…`): built into the site (`apps/web/.env`). Public by design.
- **Secret / service-role key**: bypasses row-level security. Only server functions (M12) may
  hold it, as a Supabase secret. Never in this repository, the site, or chat.
