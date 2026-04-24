import { useState } from 'react';

function obstacleLabel(obstacleType = '') {
  const normalized = String(obstacleType).toLowerCase();
  if (normalized === 'construction_barrier') {
    return 'walking hazard';
  }
  return normalized.replaceAll('_', ' ');
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function ObstacleCapture({
  onSubmit,
  loading,
  lastObstacle,
  lastObstacleImage
}) {
  const [note, setNote] = useState('Construction barrier blocking most of the walkway');
  const [file, setFile] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();
    const imageBase64 = file ? await fileToDataUrl(file) : '';
    onSubmit({ note, imageBase64 });
  }

  return (
    <section className="panel">
      <p className="eyebrow">Obstacle VLM</p>
      <h2>Report a new hazard</h2>
      <p className="panel-copy">
        Use the obstacle demo image first, or upload a new walkway photo to trigger a live re-check.
      </p>

      <div className="obstacle-demo-card">
        <span className="obstacle-demo-label">Demo Image</span>
        <img
          className="obstacle-preview"
          src={lastObstacleImage || '/obstacle-demo.jpg'}
          alt="Construction barrier image used in the obstacle demo"
        />
      </div>

      <form className="planner-form" onSubmit={handleSubmit}>
        <label>
          Upload a different photo
          <input
            type="file"
            accept="image/*"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>

        <label>
          Optional note
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows="3"
            placeholder="stairs, crowd blockage, flooded walkway..."
          />
        </label>

        <button className="secondary-button" disabled={loading} type="submit">
          {loading ? 'Analyzing...' : 'Analyze obstacle'}
        </button>
      </form>

      {lastObstacle ? (
        <div className="obstacle-card">
          {lastObstacleImage ? (
            <img
              className="obstacle-preview"
              src={lastObstacleImage}
              alt="Obstacle image used for VLM analysis"
            />
          ) : null}
          <strong>{obstacleLabel(lastObstacle.analysis.obstacle_type)}</strong>
          <span>
            {lastObstacle.analysis.analysis_mode === 'vision'
              ? 'Vision analysis succeeded'
              : 'Heuristic fallback used'}
          </span>
          <span>Severity: {lastObstacle.analysis.severity}</span>
          <span>Recommended action: {lastObstacle.analysis.recommended_action}</span>
          <span>Confidence: {Math.round(lastObstacle.analysis.confidence * 100)}%</span>
          <p>{lastObstacle.analysis.short_reason}</p>
        </div>
      ) : null}
    </section>
  );
}
