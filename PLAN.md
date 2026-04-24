# Silver Route Agent Plan

## 1. Hackathon fit

### Event analysis

Based on `https://luma.com/srcfgry1`, this demo fits the **Intelligent Mobility** track directly:

- the event is the **GrabMaps API Hackathon** in Singapore,
- builders get roughly **7 hours of hacking time** between the morning workshop and submission cutoff,
- prizes include **Best Overall Project**, **Best Use of GrabMaps APIs**, and **Best Bug Hunter**,
- the event pitch explicitly invites **dynamic routing** and route planners that adapt to incidents.

This concept also has secondary fit with **Smarter Places** because the route planner reasons about accessible entrances, clinics, toilets, and shelters as place context rather than treating the map as a static line.

### Why this concept works for the brief

The demo is not "ask the map one question and show one route." It is an agent loop:

1. understand the user's mobility state,
2. search and route with GrabMaps,
3. enrich the path with comfort stops,
4. watch for new physical obstacles through camera input,
5. re-plan when the world changes.

That is the right level of visible agency for a hackathon judged on API usage and product usefulness.

## 2. Product concept

**Silver Route Agent** is a route-planning assistant for elderly users in Singapore.

Primary demo story:

- user: "Bring me from Tiong Bahru MRT to Singapore General Hospital."
- system chooses an elderly-friendly walking route instead of the shortest one,
- system inserts optional rest and toilet stops,
- user points the phone at a blocked path,
- VLM identifies the obstacle,
- agent decides whether to warn, slow down, or re-route.

### Core user promise

"Get me there safely, not just quickly."

### Narrow hackathon scope

One persona, one city, one main journey, three live adaptations:

- base route,
- "I need more rest stops",
- "there is a new obstacle ahead."

## 3. Confirmed GrabMaps capabilities from local docs

The local docs in `hackathons\grabmaps-api\docs` confirm these usable surfaces:

- `GET /api/v1/maps/eta/v1/direction` for routing, duration, distance, alternatives, geometry, and multi-waypoint routing,
- `GET /api/v1/maps/poi/v1/search` for destination lookup and keyword search,
- `GET /api/v1/maps/place/v2/nearby` for nearby POIs around the user,
- `GET /api/v1/maps/poi/v1/reverse-geo` for "where am I now?" recovery,
- `https://maps.grab.com/api/style.json` with Bearer auth for MapLibre basemap styling,
- `grab-maps` / `GrabMapsLib` for quick frontend map integration,
- optional MCP tools: `search_places`, `get_directions`, `nearby_search`.

### Important constraints from the docs

- directions use repeated `coordinates` values and default to `lng,lat`,
- nearby and reverse-geo use `lat,lng`,
- route geometry is available only when `overview=full`,
- nearby radius is in **kilometres**, not meters,
- the docs do not expose native accessibility tags such as ramps, stairs, lifts, benches, or obstruction layers,
- the routing API does not expose a documented "avoid polygon" parameter for ad hoc walking obstacles.

That means the accessibility layer has to be built by the agent, not read directly from the API.

## 4. Differentiation from the existing repo concepts

There is already an `accessibility-navigator` architecture note in this repo. The new demo should not just restate it.

This plan adds three things that are missing from the existing concept:

- a **camera-to-route** VLM loop for newly observed obstacles,
- a **hazard memory** that persists temporary path problems during the session,
- a clearer **fallback strategy** for routing around obstacles despite the limited raw routing controls.

## 5. Demo architecture

## Frontend

- React + Vite for fastest scaffold
- MapLibre GL JS or `grab-maps` for map rendering
- large-touch mobile-first UI
- voice input optional, text input required
- camera capture flow for obstacle reporting

## Backend

- Node.js + Express
- GrabMaps proxy service to keep API key server-side
- orchestration service for multi-step planning
- lightweight in-memory hazard store

## AI layer

- route agent: LLM with tool/function calling for planning and re-planning over the local GrabMaps HTTP service layer
- VLM step: model call with image input for obstacle classification
- deterministic scorer after each agent pass to keep results predictable

Current implementation note: the scaffold uses direct GrabMaps HTTP endpoints for routing and place search. MCP is documented and compatible with the concept, but it is not the active integration path in this scaffold.

## 6. Agent loop

### Initial planning loop

1. Resolve origin and destination with `search` or `reverse-geo`.
2. Fetch a baseline walking route with `direction`.
3. Search nearby places along the route for:
   - toilet
   - clinic
   - pharmacy
   - bench
   - shelter
   - cafe
4. Score candidate stops by detour cost and usefulness.
5. Inject 0 to 3 waypoints and request a revised route.
6. Render route, stops, and a short spoken/text summary.

### Re-planning loop

1. User reports fatigue or urgency:
   - "need toilet"
   - "too tired"
   - "need somewhere to sit"
2. Agent calls `nearby` around current location.
3. Agent updates route with the selected comfort stop.
4. Map and narration refresh in place.

### Obstacle loop

1. User opens camera and takes a photo.
2. VLM classifies the obstacle and returns structured JSON.
3. Backend maps the result to a hazard type and severity.
4. Hazard is attached to the nearest route segment or current position.
5. Planner chooses one of:
   - continue with warning,
   - slow route guidance,
   - re-route immediately.

## 7. VLM capability for new obstacles

This is the key addition.

### What the VLM should detect

- stairs or step-only access
- broken pavement
- construction barrier
- flooded walkway or large puddle
- steep curb
- fallen object
- very narrow passage
- crowd blockage
- poor lighting at night

### Required VLM output

Use structured JSON, not free text:

```json
{
  "obstacle_type": "construction_barrier",
  "severity": "high",
  "passable_for_elderly": false,
  "passable_for_wheelchair": false,
  "estimated_clear_width_m": 0.4,
  "recommended_action": "reroute",
  "confidence": 0.91,
  "short_reason": "barrier blocks most of the walkway"
}
```

### How to wire it

The phone sends:

- one camera image,
- current GPS position,
- current route id,
- user mobility profile.

The backend then:

1. calls the VLM with the image,
2. validates the JSON response,
3. stores a session hazard,
4. asks the route agent whether the current user can continue safely.

### Why this matters

GrabMaps gives strong routing and place primitives, but the docs do not show a temporary sidewalk-obstacle feed. The VLM closes that gap by turning real-world camera input into a routing signal.

## 8. Obstacle re-route strategy under GrabMaps limitations

The main technical problem is that the routing API does not document arbitrary obstacle exclusion for walking paths.

The workaround should be explicit in the implementation:

### Strategy A: request alternative routes first

- call `direction` with `alternatives=1` or `alternatives=2`,
- compare returned routes against the hazard position,
- switch to the best route that does not intersect the hazard buffer.

### Strategy B: insert a bypass waypoint

If all alternatives intersect the hazard:

- search nearby for a safe landmark or path-adjacent POI beyond the blocked segment,
- use that place as an intermediate waypoint,
- request a new route: origin -> bypass waypoint -> destination.

### Strategy C: short safety detour

If no good POI exists:

- ask the user to move to the nearest safe anchor point already on the map,
- re-route from that anchor point.

This is not perfect map semantics, but it is realistic for a hackathon and explainable to judges.

## 9. Recommended stack

### Frontend

- React
- Vite
- Tailwind CSS
- MapLibre GL JS or `grab-maps`

### Backend

- Node.js
- Express
- `undici` or native `fetch`
- `zod` for validating VLM JSON

### AI integration

- one reasoning model for tool orchestration,
- one vision-capable model for obstacle analysis,
- optionally the same API provider if that keeps integration simpler.

For the VLM stage, use an API path that accepts image input and returns structured JSON so the obstacle classifier produces machine-usable fields instead of narrative text.

## 10. Suggested folder structure

```text
silver-route-agent/
├── README.md
├── PLAN.md
├── package.json
├── .env.example
├── server/
│   ├── index.js
│   ├── routes/
│   │   ├── plan.js
│   │   ├── obstacle.js
│   │   └── grabmaps-proxy.js
│   ├── services/
│   │   ├── grabmaps.js
│   │   ├── planner.js
│   │   ├── vlm.js
│   │   ├── hazard-store.js
│   │   └── route-scoring.js
│   └── lib/
│       └── polyline6.js
└── client/
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── components/
        │   ├── MapView.jsx
        │   ├── PlannerPanel.jsx
        │   ├── ObstacleCapture.jsx
        │   ├── RouteSummaryCard.jsx
        │   └── TraceLog.jsx
        └── lib/
            └── api.js
```

## 11. Build plan for the hackathon

### Phase 1: baseline map and route

- load GrabMaps style correctly with Bearer auth,
- render origin and destination,
- fetch and draw one walking route,
- show distance and ETA.

### Phase 2: elderly-friendly route layer

- add mobility profile: walker, wheelchair, cane, slow-walk,
- add route scoring,
- inject comfort stops from search and nearby APIs,
- expose one-click re-plan buttons.

### Phase 3: obstacle intelligence

- add obstacle capture UI,
- send image + GPS to backend,
- classify obstacle with VLM,
- store session hazard,
- switch to an alternative or bypass waypoint route.

### Phase 4: demo polish

- trace panel showing agent steps,
- one-tap scripted demo states,
- large fonts and high-contrast UI,
- canned scenario data in case live calls degrade.

## 12. What to demo live

### Demo sequence

1. Start at Tiong Bahru MRT and search for SGH.
2. Generate a default elderly-friendly route.
3. Tap "Need toilet" and show a revised route.
4. Take or upload an obstacle photo.
5. Show the VLM classification result.
6. Re-route and explain why the path changed.

### Demo line

"The route does not just know where the hospital is. It notices when the real walkway stops being safe for the person holding the phone."

## 13. MVP success criteria

Ship if these work:

- route generation with GrabMaps,
- at least one comfort-stop re-route,
- one obstacle photo classified into structured JSON,
- one successful re-route triggered by that obstacle,
- visible step-by-step trace of the agent decisions.

## 14. Risks and mitigations

### Risk: no reliable bypass around obstacle

Mitigation:

- pre-script one hazard near a route with a known viable alternative,
- prefer alternatives before bypass search,
- keep one manual "safe checkpoint" fallback.

### Risk: VLM over-describes but does not classify cleanly

Mitigation:

- require JSON schema validation,
- keep obstacle taxonomy small,
- map uncertain predictions to `warning_only`.

### Risk: route quality is not truly accessibility-aware

Mitigation:

- pitch honestly: this is an agentic accessibility layer on top of current map primitives,
- focus the demo on dynamic adaptation, not on claiming perfect disability routing coverage.

## 15. Immediate next build steps

1. Scaffold `client/` and `server/` inside this folder.
2. Implement `grabmaps-proxy.js` and verify one route request.
3. Add a simple route-scoring heuristic and one rest-stop insertion flow.
4. Add `ObstacleCapture.jsx` and `server/services/vlm.js`.
5. Implement hazard-aware re-planning with alternatives first, waypoint bypass second.
