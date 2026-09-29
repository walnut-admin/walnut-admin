# Database & seed data

## What it takes to run

MongoDB **replica set** (transactions require one; a single-node replica set is fine —
`rs.initiate()`) plus Redis 7+. Connection parameters come from the server env file
(`apps/server/env-local/.env.${NODE_ENV ?? development}`, the `DATABASE_*` group) — not from a single
URI, which is why the tooling below connects through that same env.

## Seed data

```bash
pnpm db:seed                     # idempotent: upsert by _id, safe to re-run
pnpm db:seed --dry-run           # report only, writes nothing
pnpm db:seed --only sys_role     # only some collections
pnpm db:seed --with-areas <file> # import administrative areas (see below)
```

The data lives in `apps/server/db/seed/` — one JSON array per collection, keeping Extended JSON
(`{"$oid": …}` / `{"$date": …}`) so it stays lossless and still works with Compass /
`mongoimport --jsonArray`.

The repository is the single source of truth, and the data is **reproducible**:

```bash
pnpm db:export                   # export the live database back into apps/server/db/seed/
pnpm lint:seed                   # shape gate: required/forbidden collections, size, credentials, refs
```

Export and the committed files are **byte-for-byte comparable**, so `git diff` is the check.

## What is deliberately *not* in the repository

| Not shipped | Why | How to get it |
|-------------|-----|---------------|
| `app_key` | Real key material (RSA private keys, AES keys). Committing it leaks them — and the repo's own credential gate rejects it | `db:seed` generates a fresh ACTIVE AES + RSA pair per install |
| `sys_user_identity` | The OPAQUE registration record is bound to the server's `AUTH_OPAQUE_SECRET` (that secret *is* the OPAQUE `serverSetup`), so it cannot work in another environment | Register through the app to create the first admin |
| MFA / OAuth rows | Encrypted with env keys (undecryptable elsewhere) and plainly private | Created while using the app |
| Device rows | Device / IP / geolocation history — runtime state and personal data | Created while using the app |
| `shared_area` | Hundreds of thousands of rows; it is reference data, not configuration | Shipped as a release asset; import with `pnpm db:seed --with-areas <file>` (`.json` or `.json.gz`) |

## It is not a "reset the database" tool

`db:seed` only upserts — it never deletes documents that are already there. Point `--db` at a fresh
database if you want a clean environment.
