function toSentenceCase(text) {
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function summarizeSupportDecision(plan) {
  const need = plan?.trace?.find((item) => item.title === 'comfort_candidates' || item.title === 'comfort_deferred' || item.title === 'comfort_rejected');
  if (plan.comfortStop) {
    return `Selected nearby ${String(plan.comfortStop.category || 'support').replaceAll('_', ' ')} POI: ${plan.comfortStop.name}.`;
  }
  if (plan.bypassStop) {
    return `Selected nearby bypass POI: ${plan.bypassStop.name}.`;
  }
  if (need?.title === 'comfort_rejected') {
    return 'Comfort stop request was checked, but every detour was meaningfully worse than the direct safe route.';
  }
  if (need?.title === 'comfort_deferred') {
    return 'Comfort stop search was skipped because the planner prioritised a hazard re-route first.';
  }
  return 'No extra stop was needed for the selected route.';
}

function routeStatusLabel(choice) {
  if (choice.selected) {
    return 'selected';
  }
  return choice.blockedByHazard ? 'blocked by hazard' : 'clear alternative';
}

export default function RouteSummaryCard({ plan }) {
  if (!plan) {
    return (
      <section className="panel muted-panel">
        <p className="eyebrow">Route Summary</p>
        <h2>Waiting for first plan</h2>
        <p>
          Start with the default Tiong Bahru MRT to SGH route, then trigger a
          comfort stop or an obstacle re-route.
        </p>
      </section>
    );
  }

  return (
    <section className="panel">
      <p className="eyebrow">Route Summary</p>
      <h2>{plan.summary.etaMinutes} min ETA</h2>
      <p>{(plan.summary.distanceMeters / 1000).toFixed(2)} km</p>
      <div className="summary-grid">
        <div className="summary-metric">
          <span className="summary-label">Decision style</span>
          <strong>{plan.summary.agentMode === 'tool-calling' ? 'AI agent with live tools' : 'Deterministic fallback'}</strong>
        </div>
        <div className="summary-metric">
          <span className="summary-label">Route choice</span>
          <strong>{toSentenceCase(plan.summary.strategyLabel)}</strong>
        </div>
      </div>
      <p>{plan.summary.narration}</p>
      <p className="support-note">{summarizeSupportDecision(plan)}</p>

      <div className="pill-row">
        <span className="pill">From {plan.origin.name}</span>
        <span className="pill">To {plan.destination.name}</span>
        {plan.comfortStop ? <span className="pill accent">Selected POI: {plan.comfortStop.name}</span> : null}
        {plan.bypassStop ? <span className="pill accent">Bypass POI: {plan.bypassStop.name}</span> : null}
      </div>

      {plan.poiCandidates?.length ? (
        <div className="choice-list">
          {plan.poiCandidates.slice(0, 3).map((poi) => (
            <div className="choice-card" key={poi.id}>
              <strong>Nearby POI</strong>
              <span>{poi.name}</span>
              <span>{String(poi.category || 'support').replaceAll('_', ' ')}</span>
            </div>
          ))}
        </div>
      ) : null}

      {plan.mapData?.routeChoices?.length ? (
        <div className="choice-list">
          {plan.mapData.routeChoices.map((choice) => (
            <div className="choice-card" key={choice.id}>
              <strong>{choice.selected ? 'Chosen route' : 'Alternate route'}</strong>
              <span>{choice.durationMinutes} min</span>
              <span>{choice.distanceMeters} m</span>
              <span>{routeStatusLabel(choice)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
