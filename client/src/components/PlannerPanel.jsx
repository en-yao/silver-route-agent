export default function PlannerPanel({
  form,
  onChange,
  onSubmit,
  loading,
  onRunScenario,
  onRunObstacleScenario,
  demoBusy,
  status
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Agent Planner</p>
          <h2>Safe route over shortest route</h2>
        </div>
      </div>

      <div className="demo-strip">
        <p className="eyebrow">Demo Flow</p>
        <p className="demo-copy">
          Start with these demo buttons. The manual planner is still available below for custom route checks.
        </p>
        <div className="scenario-row">
          <button
            className="scenario-button"
            disabled={demoBusy}
            onClick={() => onRunScenario('baseline')}
            type="button"
          >
            1. Baseline
          </button>
          <button
            className="scenario-button"
            disabled={demoBusy}
            onClick={() => onRunScenario('toilet')}
            type="button"
          >
            2. Include toilet stop
          </button>
          <button
            className="scenario-button"
            disabled={demoBusy}
            onClick={onRunObstacleScenario}
            type="button"
          >
            3. Report hazard
          </button>
        </div>
        {status ? <p className="demo-status">{status}</p> : null}
      </div>

      <div className="manual-section">
        <div className="manual-header">
          <p className="eyebrow">Manual Controls</p>
          <span>Use this after the demo flow.</span>
        </div>
        <form className="planner-form" onSubmit={onSubmit}>
          <label>
            Origin
            <input
              name="origin"
              value={form.origin}
              onChange={onChange}
              placeholder="Tiong Bahru MRT"
            />
          </label>

          <label>
            Destination
            <input
              name="destination"
              value={form.destination}
              onChange={onChange}
              placeholder="Singapore General Hospital"
            />
          </label>

          <label>
            Immediate need
            <select name="need" value={form.need} onChange={onChange}>
              <option value="">None</option>
              <option value="rest">Need rest</option>
              <option value="toilet">Need toilet</option>
              <option value="clinic">Need clinic</option>
              <option value="shelter">Need shelter</option>
            </select>
          </label>

          <div className="two-up">
            <label>
              Mobility aid
              <select name="mobilityAid" value={form.mobilityAid} onChange={onChange}>
                <option value="walker">Walker</option>
                <option value="cane">Cane</option>
                <option value="slow-walk">Slow walk</option>
                <option value="wheelchair">Wheelchair</option>
                <option value="unaided">Unaided</option>
              </select>
            </label>

            <label>
              Walking budget (m)
              <input
                name="maxContinuousMeters"
                type="number"
                min="50"
                step="10"
                value={form.maxContinuousMeters}
                onChange={onChange}
              />
            </label>
          </div>

          <button className="primary-button" disabled={loading} type="submit">
            {loading ? 'Planning...' : 'Plan route'}
          </button>
        </form>
      </div>
    </section>
  );
}
