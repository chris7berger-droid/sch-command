# Row Level Security (RLS) — Critical Rules

This project uses Supabase RLS to control database access. Get this wrong
and customer data leaks. Read carefully.

## The anti-pattern that caused incident 2026-04-26 (sales-command)

Policies that grant anon access based only on a column being non-null:

    FOR SELECT TO anon
    USING (signing_token IS NOT NULL)

This is INSECURE. The publishable anon key ships in the browser bundle.
Anyone holding it can call PostgREST directly without the WHERE clause
the React app adds, and read every row where the column is non-null.

NEVER write a policy in this shape. The frontend filtering the query
client-side does NOT count as enforcement.

## The correct pattern for token-gated public access

If sch-command ever adds public-facing pages (customer schedule view,
appointment confirmation, etc.), pass the token via a custom request
header and match it inside the policy:

    FOR SELECT TO anon
    USING (
      <token_column> IS NOT NULL
      AND <token_column>::text = public.request_<name>_token()
    )

Helper functions live in the shared database. They read the relevant
header from current_setting('request.headers'). The pattern is established
in sales-command — see sales-command/src/lib/supabasePublic.js for the
client-side companion.

## The correct pattern for authenticated user access

Use auth.uid() to scope rows to the current user:

    FOR SELECT TO authenticated
    USING (tenant_id = public.get_user_tenant_id())

Or for user-owned rows directly:

    FOR SELECT TO authenticated
    USING (user_id = auth.uid())

## When this rule applies

Any time you write or modify SQL touching:
  - Files in supabase/migrations/ or sql/
  - Anything mentioning RLS, policies, anon access, public access, or
    token-gated reads
  - Any new public-facing page (schedule confirmation, technician portal, etc.)

## Deploy gates for any RLS or auth change

The 6-gate deploy pattern from the 2026-04-26 incident is non-negotiable:

  1. Build all changes on a branch (do NOT touch main)
  2. Vercel preview deploy auto-builds
  3. Test on preview URL in incognito (real anon conditions)
  4. Merge PR — frontend deploys; old policies still active
  5. Test on PRODUCTION before tightening any DB policies
  6. Apply additive migration (new policies alongside old)
  7. Test on production again (overlap window)
  8. Apply drop migration (old policies removed)
  9. Test on production a third time (strict enforcement only)
  10. Commit drop migration + rollback to main as a record

Do not skip gates.

## Cross-repo impact

The Supabase database is SHARED across all 4 Command Suite repos:
  sales-command, sch-command, field-command, AR-Command-Center

Tables most likely to be affected by cross-repo RLS work:
  proposals, proposal_wtc, proposal_recipients, proposal_signatures,
  invoices, invoice_lines, call_log, customers, customer_contacts,
  team_members, tenant_config, jobs, job_work_types

Any policy change here must be checked against the other 3 repos:

    cd ../sales-command && grep -rn "<table_name>" src/
    cd ../field-command && grep -rn "<table_name>" src/

If sibling repos query the same table as anon WITHOUT the new pattern,
they will break or remain vulnerable.

## Reference implementation

The token-gated public access pattern was implemented in sales-command
on 2026-04-27. See:
  sales-command/CLAUDE_RLS.md
  sales-command/src/lib/supabasePublic.js
  sales-command/supabase/migrations/20260427180000_add_token_gated_policies.sql
