# Security programme

> This file is the master copy. Reviewed yearly; update it in the same commit as any change it describes.

Oct 22, 2026 · Jet Zhu · Written for the children's data rules (US COPPA 16 CFR 312.8, as amended in 2025) and kept for the whole site. General information, not legal advice.

## Coordinator

The site owner (Jet Zhu, the operator in the privacy policy) coordinates this programme. Moderators help with account cases but have no access to the database beyond the review page.

## What we protect

| Data | Where | Who can read it |
| --- | --- | --- |
| Accounts, play, child profiles, consent records | Supabase (Postgres, US region) | The account's owner through row-level security; a child profile's parent through checked database functions; the owner with an access token |
| Emails and sign-in links | Gmail (sending) | The recipient |
| Encrypted weekly backups | GitHub Actions artifacts | The owner (the key is a repository secret) |
| Daily triage logs | The computer that runs the daily run | That computer's user |

## Safeguards

1. **Access rules in the database.**
   - Every table has row-level security, and nothing is open to the public API unless a migration grants it.
   - Children's tables are reachable only through functions that check the parent.
   - The PGlite test suite checks one user can't reach another's rows.
2. **Second steps** (M23b):
   - Moderators need an authenticator app for every moderator function.
   - Sensitive changes ask for "confirm it's you" plus the player's second step.
   - A new password needs the current one.
3. **Secrets** live in `~/.config` (mode 600) on the owner's computer, in GitHub secrets, or in Supabase Vault (the mailer's Gmail app password). Never in the repository.
4. **Data minimisation.**
   - Child profiles hold no email, name or photo.
   - Guest feedback keeps no network address, only a hash salted daily.
   - Links in emails are stored as hashes.
5. **Retention jobs** (pg_cron, listed in the moderator runbook) delete:
   - old feedback, mail, game records and summaries
   - unconfirmed or unused child profiles
   - consent records 3 years after a profile ends
6. **Encrypted backups**, weekly, kept as GitHub artifacts.
7. **Dependencies:** a lockfile, Dependabot alerts on the public repository, and updates reviewed before deploying.

## Processors

See [processors.md](processors.md) for each service that processes data for us, and the terms that bind them.

## Yearly review (each October)

- Re-read this file, the [children's impact assessment](children-impact-assessment.md) and the privacy policy against what the code does.
- **Test:**
  - sign in as a test account and try to read another account's rows through the API (it must fail)
  - restore last week's backup into the staging project
  - check that the retention jobs ran (`select * from cron.job_run_details order by start_time desc limit 50`)
- **Rotate:** the Supabase access token, the Gmail app password (`scripts/mail-setup.mjs`), and the backup key.
- Note the date and any changes at the end of this file.

## Incidents

If personal data may have been exposed:
1. Contain it: rotate keys, sign everyone out (`delete from auth.sessions`), switch off the affected feature.
2. Work out what was exposed and whose.
3. Tell the affected players (parents, for child profiles) by email within 72 hours, and regulators where the law asks.
4. Write down what happened and what changed.

## Reviews

- 2026-10-22: first version.
