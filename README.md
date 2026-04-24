# Silver Route Agent

Silver Route Agent is a GrabMaps hackathon demo for safer elderly-friendly route planning in Singapore.

The app combines:
- GrabMaps routing, search, nearby, reverse-geo, and live basemap rendering
- OpenAI tool-calling for route-planning orchestration
- OpenAI vision for obstacle classification from photos
- comfort-stop insertion for toilets and other support POIs
- hazard-aware re-routing when the current path becomes unsafe

## Demo Flow

The frontend is built around three quick flows:
- `1. Baseline`
- `2. Include toilet stop`
- `3. Report hazard`

The app opens on a baseline route from Tiong Bahru MRT to Singapore General Hospital. From there it can insert a comfort stop or classify a newly reported hazard and update the route.

## Stack

- React + Vite
- Express
- MapLibre GL JS
- GrabMaps HTTP APIs
- OpenAI Responses API
- Playwright for frontend smoke testing

## Run Locally

```bash
npm install
npm run dev
```

Open `http://localhost:5174`.

## Environment

Create `.env` with:

```bash
GRABMAPS_API_KEY=...
OPENAI_API_KEY=...
OPENAI_AGENT_MODEL=gpt-4.1-mini
```

Notes:
- without `OPENAI_API_KEY`, the app falls back to the deterministic planner
- without `GRABMAPS_API_KEY`, live GrabMaps routing and styling will not work

## Scripts

```bash
npm run dev
npm run build
npm run test:e2e
```

## Project Structure

```text
client/   React frontend
server/   Express API and planner services
tests/    Playwright tests
PLAN.md   Hackathon plan and architecture notes
```

## Current Behavior

- baseline route planning with walking-budget support context
- explicit toilet-stop routing for demo visibility
- obstacle photo analysis with hazard-aware re-planning
- live GrabMaps basemap through backend proxying

## Notes

This repo is optimized for demo reliability rather than perfect accessibility coverage. It should be presented as an agentic accessibility layer on top of current GrabMaps primitives, not as a full accessibility routing product.
