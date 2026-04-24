import { useEffect, useState } from 'react';
import PlannerPanel from './components/PlannerPanel.jsx';
import RouteSummaryCard from './components/RouteSummaryCard.jsx';
import ObstacleCapture from './components/ObstacleCapture.jsx';
import TraceLog from './components/TraceLog.jsx';
import MapView from './components/MapView.jsx';
import { analyzeObstacle, requestPlan } from './lib/api.js';

const DEFAULT_LOCATION = {
  lat: 1.286972,
  lng: 103.827183
};

function midpointFromCoordinates(coordinates = []) {
  if (!coordinates.length) {
    return DEFAULT_LOCATION;
  }
  const midpoint = coordinates[Math.floor(coordinates.length / 2)];
  return { lat: midpoint[1], lng: midpoint[0] };
}

const DEMO_SCENARIOS = {
  baseline: {
    origin: 'Tiong Bahru MRT',
    destination: 'Singapore General Hospital',
    mobilityAid: 'walker',
    maxContinuousMeters: 500,
    need: '',
    demoForcePoiDetour: false
  },
  toilet: {
    origin: 'Tiong Bahru MRT',
    destination: 'Singapore General Hospital',
    mobilityAid: 'walker',
    maxContinuousMeters: 500,
    need: 'toilet',
    demoForcePoiDetour: true
  },
  caution: {
    origin: 'Tiong Bahru MRT',
    destination: 'Singapore General Hospital',
    mobilityAid: 'cane',
    maxContinuousMeters: 180,
    need: 'rest',
    demoForcePoiDetour: false
  }
};

export default function App() {
  const [form, setForm] = useState({
    ...DEMO_SCENARIOS.baseline
  });
  const [sessionId, setSessionId] = useState('');
  const [plan, setPlan] = useState(null);
  const [lastObstacle, setLastObstacle] = useState(null);
  const [lastObstacleImage, setLastObstacleImage] = useState('');
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [loadingObstacle, setLoadingObstacle] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  async function loadDemoObstacleImage() {
    const response = await fetch('/obstacle-demo.jpg');
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  async function runPlan(nextForm = form, event, nextSessionId = sessionId) {
    event?.preventDefault();
    setLoadingPlan(true);
    setError('');
    setStatus(nextForm.need ? `Checking safer routes with a ${nextForm.need} stop.` : 'Comparing safer route options.');
    try {
      const nextPlan = await requestPlan({
        sessionId: nextSessionId,
        origin: nextForm.origin,
        destination: nextForm.destination,
        need: nextForm.need,
        demoForcePoiDetour: Boolean(nextForm.demoForcePoiDetour),
        currentLocation: DEFAULT_LOCATION,
        profile: {
          mobilityAid: nextForm.mobilityAid,
          maxContinuousMeters: Number(nextForm.maxContinuousMeters)
        }
      });
      setSessionId(nextPlan.sessionId);
      setPlan(nextPlan);
      setLastObstacle(null);
      setLastObstacleImage('');
      setStatus('Route ready.');
      return nextPlan;
    } catch (nextError) {
      setError(nextError.message);
      setStatus('');
      return null;
    } finally {
      setLoadingPlan(false);
    }
  }

  async function submitPlan(event) {
    await runPlan(form, event);
  }

  async function handleObstacle({ note, imageBase64, currentLocationOverride }) {
    setLoadingObstacle(true);
    setError('');
    setStatus('Analyzing the obstacle photo and checking a safer route.');
    try {
        const result = await analyzeObstacle({
          sessionId,
          origin: form.origin,
          destination: form.destination,
          need: form.need,
          currentLocation: currentLocationOverride || DEFAULT_LOCATION,
          currentRouteId: plan?.mapData?.selectedRouteId,
          currentRouteGeometry: plan?.mapData?.route?.geometry?.coordinates ?? [],
          imageBase64,
          note,
          profile: {
            mobilityAid: form.mobilityAid,
            maxContinuousMeters: Number(form.maxContinuousMeters)
        }
      });
      setSessionId(result.sessionId);
      setLastObstacle(result.obstacle);
      setLastObstacleImage(imageBase64 || '');
      setPlan(result.updatedPlan);
      setStatus('Obstacle processed. Safer route updated.');
    } catch (nextError) {
      setError(nextError.message);
      setStatus('');
    } finally {
      setLoadingObstacle(false);
    }
  }

  useEffect(() => {
    runPlan(DEMO_SCENARIOS.baseline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: value
    }));
  }

  async function runScenario(scenarioKey) {
    const nextForm = DEMO_SCENARIOS[scenarioKey];
    if (!nextForm) {
      return;
    }

    setForm(nextForm);
    setSessionId('');
    setStatus(
      scenarioKey === 'toilet'
        ? 'Running the forced comfort-stop demo.'
        : 'Running the walking-budget baseline demo.'
    );
    await runPlan(nextForm, undefined, '');
  }

  async function runObstacleScenario() {
    const baseForm = DEMO_SCENARIOS.baseline;
    setForm(baseForm);
    setSessionId('');
    setStatus('Running the obstacle demo.');
    const baselinePlan = await runPlan(baseForm, undefined, '');
    const demoImage = await loadDemoObstacleImage();
    const routeMidpoint = midpointFromCoordinates(baselinePlan?.mapData?.route?.geometry?.coordinates ?? []);
    await handleObstacle({
      note: 'Construction barrier blocks the walkway',
      imageBase64: demoImage,
      currentLocationOverride: routeMidpoint
    });
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">GrabMaps Hackathon Demo</p>
        <h1>Silver Route Agent</h1>
        <p className="hero-copy">
          A safety-first route planner for older pedestrians that compares comfort-stop
          detours, watches for new walkway hazards, and switches strategy when the path
          stops being safe.
        </p>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}
      {status && !error ? <div className="status-banner">{status}</div> : null}

      <div className="layout">
        <aside className="column-left">
          <PlannerPanel
            form={form}
            onChange={handleChange}
            onSubmit={submitPlan}
            loading={loadingPlan}
            onRunScenario={runScenario}
            onRunObstacleScenario={runObstacleScenario}
            demoBusy={loadingPlan || loadingObstacle}
            status={status}
          />
        </aside>
        <section className="column-right stage-column">
          <RouteSummaryCard plan={plan} />
          <MapView mapData={plan?.mapData} />
        </section>
      </div>

      <section className="support-layout">
        <ObstacleCapture
          onSubmit={handleObstacle}
          loading={loadingObstacle}
          lastObstacle={lastObstacle}
          lastObstacleImage={lastObstacleImage}
        />
        <TraceLog trace={plan?.trace ?? []} />
      </section>
    </main>
  );
}
