export default function TraceLog({ trace = [] }) {
  return (
    <section className="panel subdued-panel">
      <p className="eyebrow">Agent Trace</p>
      <h2>Tool calls and decisions</h2>
      <p className="panel-copy">Useful for technical judges. The product story is already captured in the route summary above.</p>
      <div className="trace-list">
        {trace.length === 0 ? (
          <p>No tool trace yet.</p>
        ) : (
          trace.map((item, index) => (
            <div className="trace-item" key={`${item.title}-${index}`}>
              <strong>
                {item.type === 'tool' ? 'tool' : 'decision'}: {item.title}
              </strong>
              <span>{item.detail}</span>
              {item.data ? (
                <code className="trace-data">{JSON.stringify(item.data)}</code>
              ) : null}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
