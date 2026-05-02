import Schedule from '../../views/Schedule'

// Ready tab — currently embeds the existing /schedule weekly crew grid.
// The mockup (jobs-screen-mockup.html) shows Ready as Scheduled-status job
// cards with date + crew, not the weekly grid. Embed retained for now;
// converting to status-filtered card list is deferred follow-up.
export default function ReadyTab() {
  return <Schedule />
}
