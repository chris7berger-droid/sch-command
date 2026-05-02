import Billing from '../../views/Billing'

// Billing tab — currently embeds the existing /billing 3-column RTB pipeline.
// The mockup (jobs-screen-mockup.html) shows Billing as completed-job cards
// with amount + wait-time + a single "Send to Finance" action. Embed retained
// for now; converting to per-job card list is deferred follow-up.
export default function BillingTab() {
  return <Billing />
}
