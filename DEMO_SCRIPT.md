# Demo Script

## 60-Second Version

### Opening

“Silver Route Agent is a safety-first route planner for older pedestrians. It uses GrabMaps for live routing and place context, an AI planning layer for route decisions, and vision to respond to new hazards from a phone photo.”

### Step 1: Baseline

Click `1. Baseline`.

Say:

“We start with a normal journey from Tiong Bahru MRT to Singapore General Hospital. Instead of just showing the shortest route, the planner considers the walking profile and budget for an older user.”

Point to:
- ETA and route summary
- live GrabMaps route on the map

### Step 2: Include Toilet Stop

Click `2. Include toilet stop`.

Say:

“Now the user needs a toilet stop. The planner searches nearby support POIs from GrabMaps, compares route options, and updates the path to include a comfort stop instead of sending the user straight through.”

Point to:
- comfort-stop marker
- updated route line
- route summary showing the selected stop

### Step 3: Report Hazard

Click `3. Report hazard`.

Say:

“Now the world changes. We upload a walkway hazard photo. The vision model classifies the obstacle, attaches it to the active route, and the planner re-evaluates whether the current path is still safe.”

Pause briefly for the result, then say:

“Once the blockage is detected, the route changes. So this is not just route search. It is route adaptation based on both user need and real-world disruption.”

Point to:
- hazard image
- hazard marker
- rerouted path / blocked path comparison

### Closing

“GrabMaps gives us the route and place primitives. Silver Route Agent adds the accessibility reasoning layer on top: comfort stops, hazard awareness, and safer route updates for older pedestrians.”

## 90-Second Version

### Opening

“Silver Route Agent helps older pedestrians get somewhere safely, not just quickly. We built it on GrabMaps routing, search, nearby POIs, and the live basemap. Then we added an AI planning layer and vision-based hazard reporting.”

### Step 1: Baseline

Click `1. Baseline`.

“This is the default trip from Tiong Bahru MRT to Singapore General Hospital. The app starts with the user’s mobility profile and walking budget, then chooses a safe walking route.”

### Step 2: Include Toilet Stop

Click `2. Include toilet stop`.

“If the user now needs a toilet, we search nearby support POIs from GrabMaps, compare route options through those stops, and update the route to include the best comfort stop.”

“What matters here is that we are not inventing a stop. We are using real nearby places and routing through them.”

### Step 3: Report Hazard

Click `3. Report hazard`.

“Next, the user reports a new hazard with a photo. The vision model classifies the obstacle, estimates severity, and tells the planner whether it should warn or reroute.”

“Because GrabMaps knows the route and we know where the hazard affects it, the agent can switch strategy and produce a safer updated path.”

### Close

“So the demo shows three things: baseline safe routing, comfort-stop planning, and live hazard-aware rerouting. That is the core value of Silver Route Agent.”

## Judge Q&A Lines

### What makes this different from a normal route app?

“A normal route app gives the fastest path. This one adapts to elderly walking needs, support stops, and newly observed hazards.”

### What is the role of GrabMaps here?

“GrabMaps provides the live route, nearby places, place search, reverse-geo, and the map itself. We built the accessibility and hazard-response layer on top.”

### Is the hazard detection live?

“In this demo it is triggered by a photo submission, not passive continuous monitoring.”

### Is it really agentic?

“Yes, in the sense that the planner uses tool-calling over route and place search to compare options and switch strategies. We also keep deterministic guardrails under it for demo reliability.”
