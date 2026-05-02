import Billing from '../../views/Billing'

// Embed the existing /billing 3-column RTB pipeline as a tab on the Jobs lifecycle.
// Billing.jsx owns its own data fetch and chrome — do not fork it.
export default function ReadyToBillTab() {
  return <Billing />
}
