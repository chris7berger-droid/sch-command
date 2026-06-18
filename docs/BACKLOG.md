# Schedule Command — Backlog

**Single source of truth for all outstanding work.** Update on every session that
completes, defers, or discovers an item. Status values: `Open`, `In Progress`,
`Blocked`, `Done` (move Done items to the Completed Log at the bottom within a
session or two).

Created: 2026-06-17 — first entries are the 6 adjacent findings from the
`billing_forecast_integration.md` plan↔audit loop (rounds 1–3). "Adjacent" =
surfaced by, but not caused by, the billing-forecast work; filed here rather than
folded into the build per audit scope discipline.

## Tier definitions

- **T0** — Drop everything. Active prod breakage / security incident.
- **T1** — This session. High-severity-and-likely × low-cost.
- **T2** — This sprint. High strategic leverage, or unblocks T1/T2 work.
- **T3** — When convenient. Low-severity bugs, refactor, polish.
- **T4** — Only if forced. Needs a re-trigger before it can move.

---

## Active

| ID    | Tier | Status | Item                                                  | Source                          | Notes                                                                                                                                                                                                                                                                                                |
|-------|------|--------|-------------------------------------------------------|---------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| ADJ-1 | T2   | **Verified (forecast-safe) 2026-06-18** | Two retention conventions coexist on `invoices`       | billing-forecast audit r1 (Med) | **Repo: sales-command.** Active `retention_*` (`20260420170000`/`20260601120000`) vs legacy `retainage_*` (`20260416175646`). If any invoice carries values in the legacy set, net-of-retention forecast math reads the wrong/null column and miscomputes inflow. **Fix:** confirm the `20260505140000` pay-app backfill populated `retention_*` (not `retainage_*`) across live invoices, then treat `retention_*` as canonical suite-wide. Load-bearing for the forecast's net math. **VERIFIED at billing-forecast build start (T3, 2026-06-18, service-role count):** of 70 live invoices, 10 carry `retention_amount>0` and only 2 also carry legacy `retainage_amount>0` — and BOTH of those also have a populated `retention_amount` (id 10004: retainage 1561.64 = retention 1561.64; id 10024: retainage 2154.53 but retention 3211.25 = correct 5%×amount). **Zero live invoices have retainage without a populated, canonical-correct retention_amount**, so the forecast's `− COALESCE(retention_amount,0)` never counts gross. `retention_*` confirmed canonical suite-wide for the forecast. Residual (out of scope): 10024's stale legacy `retainage_amount` disagrees with its retention — data-quality curiosity; nothing in scope reads `retainage_*`. |
| ADJ-3 | T2   | Open   | `/billing` redirects carry no tab param               | billing-forecast audit r1 (Low) | **Repo: sch-command. Coupled to the billing-forecast build** — builder should pick this up when `/billing` becomes two tabs. `TAB_REDIRECTS` (`Jobs.jsx:18-19`) and the Ready-to-Bill tile (`JobsPicker.jsx:75` `goBilling`) route to `/billing` with no tab; once it's Worklist + Forecast they land on the undefined default. **Fix:** name the default tab and deep-link the RTB tile (e.g. `/billing?tab=worklist`).                                              |
| ADJ-2 | T3   | Open   | Forecast stale until manual reload                    | billing-forecast audit r1 (Low) | **Repo: sch-command (reads sales-command data).** No Supabase realtime subscription on `invoices`, so "Paid removes the row" and new-invoice inflow only reflect on next manual reload — §4.6's "now automatic" overstates. **Fix:** add a realtime subscription on `invoices` (or a refresh affordance) so the forecast updates without a manual reload. `Billing.jsx` load is a one-shot `useEffect` (~line 101).                                              |
| ADJ-4 | T3   | Open   | `terms_override` redundant in §4.2 fallback COALESCE  | billing-forecast audit r2 (Low) | **Repo: sch-command (plan).** In the expected-pay-date resolution, `terms_override` is both step 1 (wins over `due_date`) AND inside the step-3 fallback COALESCE; the step-3 occurrence is dead but invites a precedence inversion if a builder reads step 3 as primary. **Fix:** drop `terms_override` from the step-3 COALESCE — leave it only as step 1; step 3 is a pure customer/tenant/30 fallback. Trivial plan edit; worth doing before build to avoid builder confusion. |
| ADJ-5 | T3   | Open   | JobDetail billing history stale post-cutover          | billing-forecast audit r2 (Low) | **Repo: sch-command.** Once `billing_log` writes stop, the per-job billing history (`JobDetail.jsx:76`, read-only `billing_log` consumer) shows only frozen pre-cutover percent rows with no new entries — misleading if users expect new invoices there. **Fix:** label it "legacy progress log; invoices live in [new tool]", or point the history at the invoice source.                                              |
| ADJ-6 | T3   | Open   | Past-due bucket is gross-of-partials                  | billing-forecast audit r3 (Low) | **Repo: cross-repo** (column is sales-command `invoices`; consumed by sch-command forecast). `invoices` has no `amount_paid`/`balance_due` column (`paid_at` is binary), so an invoice partially paid out-of-system still shows full net in the highest-trust past-due bucket, overstating collectable inflow. **Fix:** add `invoices.amount_paid`/`balance_due` and subtract in the bucket. **Interim (in v1):** keep the gross-of-partials label so the number isn't trusted as net-collectable.                                              |

---

## Completed Log

(none yet)
