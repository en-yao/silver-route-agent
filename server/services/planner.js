import { z } from 'zod';
import { addHazard, listHazards } from './hazard-store.js';
import { findBestPlace, getDirections, getRoutePoint, nearbySearch, reverseGeocode, searchPlaces } from './grabmaps.js';
import { analyzeObstacleImage } from './vlm.js';
import {
  buildVisualBypassGeometry,
  buildVisualPoiDetourGeometry,
  lineTouchesHazard,
  midpointFromGeometry,
  nearestPointOnRoute,
  rankRoutes,
  distanceMeters
} from './route-scoring.js';

const profileSchema = z.object({
  mobilityAid: z.enum(['walker', 'wheelchair', 'cane', 'slow-walk', 'unaided']).default('walker'),
  maxContinuousMeters: z.number().min(50).max(2000).default(250)
});

const COMFORT_QUERY_PRESETS = {
  toilet: ['public toilet', 'clinic', 'pharmacy', 'cafe'],
  bench: ['bench', 'shelter', 'cafe'],
  clinic: ['clinic', 'pharmacy', 'shelter'],
  shelter: ['shelter', 'cafe', 'clinic']
};

const BYPASS_QUERIES = ['shelter', 'clinic', 'cafe', 'bench'];
const MAX_ROUTE_INFLATION_RATIO = 2;
const MAX_COMFORT_ROUTE_OFFSET_METERS = 180;
const MAX_COMFORT_ENDPOINT_DISTANCE_METERS = 420;

function makeSessionId() {
  return `session-${Math.random().toString(36).slice(2, 10)}`;
}

function summarizeNeed(need) {
  const normalized = String(need || '').toLowerCase();
  if (normalized.includes('toilet')) return 'toilet';
  if (normalized.includes('rest')) return 'bench';
  if (normalized.includes('clinic')) return 'clinic';
  if (normalized.includes('shelter')) return 'shelter';
  return '';
}

function inferBudgetComfortNeed(route, profile) {
  if (!route) {
    return '';
  }
  return route.distanceMeters > profile.maxContinuousMeters ? 'bench' : '';
}

function makeTraceStep(type, title, detail, data) {
  return { type, title, detail, data };
}

function addDecision(trace, title, detail, data) {
  trace.push(makeTraceStep('decision', title, detail, data));
}

function addToolTrace(trace, tool, input, result) {
  trace.push(makeTraceStep('tool', tool, result, input));
}

function formatPlace(place) {
  return {
    id: place.id,
    name: place.name,
    address: place.formatted_address,
    category: place.category,
    lat: place.location.latitude,
    lng: place.location.longitude,
    entrance: place.entrance
      ? {
          lat: place.entrance.centroid.latitude,
          lng: place.entrance.centroid.longitude
        }
      : null
  };
}

function poiLabelFromCategory(category = '') {
  const value = String(category).toLowerCase();
  if (value.includes('toilet')) return 'toilet POI';
  if (value.includes('clinic') || value.includes('pharmacy')) return 'clinic POI';
  if (value.includes('shelter')) return 'shelter POI';
  if (value.includes('cafe')) return 'rest POI';
  if (value.includes('bench')) return 'bench POI';
  return 'support POI';
}

function routeToFeature(route) {
  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: route.geometry
    },
    properties: {
      id: route.id
    }
  };
}

function dedupePlaces(places) {
  const seen = new Set();
  return places.filter((place) => {
    if (seen.has(place.id)) {
      return false;
    }
    seen.add(place.id);
    return true;
  });
}

function isToiletLikePlace(place) {
  const text = `${place.name || ''} ${place.category || ''}`.toLowerCase();
  return (
    text.includes('toilet') ||
    text.includes('restroom') ||
    text.includes('washroom') ||
    text.includes('lavatory')
  );
}

function minDistanceToRoute(routeGeometry, point) {
  if (!routeGeometry?.length) {
    return Number.POSITIVE_INFINITY;
  }

  return routeGeometry.reduce((best, [lng, lat]) => {
    const distance = distanceMeters(point, { lat, lng });
    return Math.min(best, distance);
  }, Number.POSITIVE_INFINITY);
}

function utilityBias(candidate, needCategory) {
  const category = String(candidate.category).toLowerCase();
  if (needCategory === 'toilet' && category.includes('toilet')) return 220;
  if (needCategory === 'bench' && (category.includes('bench') || category.includes('shelter'))) return 180;
  if (needCategory === 'clinic' && category.includes('clinic')) return 200;
  if (needCategory === 'shelter' && category.includes('shelter')) return 180;
  return 90;
}

function hazardSeverityValue(hazard) {
  switch (hazard.analysis.severity) {
    case 'high':
      return 3;
    case 'medium':
      return 2;
    default:
      return 1;
  }
}

function routeHazardCount(route, hazards) {
  return hazards.filter((hazard) => lineTouchesHazard(route.geometry, hazard, 50)).length;
}

function pickBestRankedRoute(routes, hazards) {
  const clearRoute = routes.find((route) => routeHazardCount(route, hazards) === 0);
  return clearRoute ?? routes[0];
}

function selectVisibleDemoPoi(candidates, routeGeometry, origin, destination) {
  if (!candidates?.length) {
    return null;
  }

  const routeMidpoint = midpointFromGeometry(routeGeometry);
  const corridorCandidates = candidates.filter((candidate) => {
    const point = {
      lat: candidate.location.latitude,
      lng: candidate.location.longitude
    };
    const routeOffsetMeters = minDistanceToRoute(routeGeometry, point);
    const endpointDistanceMeters = Math.min(
      distanceMeters(point, {
        lat: origin.location.latitude,
        lng: origin.location.longitude
      }),
      distanceMeters(point, {
        lat: destination.location.latitude,
        lng: destination.location.longitude
      })
    );
    return (
      routeOffsetMeters <= MAX_COMFORT_ROUTE_OFFSET_METERS &&
      endpointDistanceMeters <= MAX_COMFORT_ENDPOINT_DISTANCE_METERS
    );
  });
  const scopedCandidates = corridorCandidates.length > 0 ? corridorCandidates : candidates;

  return [...scopedCandidates]
    .map((candidate) => {
      const point = {
        lat: candidate.location.latitude,
        lng: candidate.location.longitude
      };
      const midpointDistance = distanceMeters(point, routeMidpoint);
      const endpointClearance = Math.min(
        distanceMeters(point, {
          lat: origin.location.latitude,
          lng: origin.location.longitude
        }),
        distanceMeters(point, {
          lat: destination.location.latitude,
          lng: destination.location.longitude
        })
      );
      return {
        candidate,
        visibilityScore: endpointClearance - midpointDistance * 1.2
      };
    })
    .sort((a, b) => b.visibilityScore - a.visibilityScore)[0]?.candidate ?? candidates[0];
}

function selectComfortDisplayPois(candidates, selectedStop, limit = 2) {
  const remaining = (candidates ?? []).filter((candidate) => candidate.id !== selectedStop?.id);
  return [
    ...(selectedStop ? [selectedStop] : []),
    ...remaining.slice(0, Math.max(0, limit - (selectedStop ? 1 : 0)))
  ].slice(0, limit);
}

async function resolveEndpoints({ originQuery, destinationQuery, currentLocation, trace }) {
  let resolvedOrigin;
  if (originQuery) {
    resolvedOrigin = await findBestPlace(originQuery, currentLocation);
    addToolTrace(trace, 'search_places(origin)', originQuery, resolvedOrigin.name);
  } else if (currentLocation) {
    resolvedOrigin = await reverseGeocode(currentLocation);
    addToolTrace(trace, 'reverse_geo(origin)', currentLocation, resolvedOrigin.name);
  } else {
    resolvedOrigin = await findBestPlace('Tiong Bahru MRT');
    addToolTrace(trace, 'search_places(origin)', 'Tiong Bahru MRT', resolvedOrigin.name);
  }

  const resolvedDestination = destinationQuery
    ? await findBestPlace(destinationQuery, resolvedOrigin.location)
    : await findBestPlace('Singapore General Hospital', resolvedOrigin.location);
  addToolTrace(
    trace,
    'search_places(destination)',
    destinationQuery || 'Singapore General Hospital',
    resolvedDestination.name
  );

  return { resolvedOrigin, resolvedDestination };
}

async function fetchRankedRoutes({ points, profile, hazards, trace, label }) {
  const routes = await getDirections(points);
  addToolTrace(trace, 'get_directions', label, `${routes.length} route candidate(s)`);
  return rankRoutes(routes, profile, hazards);
}

async function buildComfortCandidates({
  needCategory,
  routeGeometry,
  origin,
  destination,
  currentLocation,
  preferMidpointAnchor = false,
  trace
}) {
  if (!needCategory) {
    return [];
  }

  const anchor =
    preferMidpointAnchor || needCategory === 'toilet'
      ? midpointFromGeometry(routeGeometry)
      : currentLocation || midpointFromGeometry(routeGeometry);
  const queries = COMFORT_QUERY_PRESETS[needCategory] ?? [needCategory];
  const places = [];

  for (const query of queries) {
    const nearby = await nearbySearch(anchor, query);
    addToolTrace(trace, 'nearby_search', { anchor, query }, `${nearby.length} nearby result(s)`);
    places.push(...nearby.slice(0, 3));

    if (nearby.length === 0) {
      const searched = await searchPlaces(query, anchor);
      addToolTrace(trace, 'search_places', { anchor, query }, `${searched.length} searched result(s)`);
      places.push(...searched.slice(0, 2));
    }
  }

  const deduped = dedupePlaces(places);
  const enriched = deduped.map((candidate) => {
    const point = {
      lat: candidate.location.latitude,
      lng: candidate.location.longitude
    };
    return {
      candidate,
      approachMeters: Math.round(
        distanceMeters(anchor, {
          lat: candidate.location.latitude,
          lng: candidate.location.longitude
        })
      ),
      routeOffsetMeters: Math.round(minDistanceToRoute(routeGeometry, point)),
      endpointDistanceMeters: Math.round(
        Math.min(
          distanceMeters(point, {
            lat: origin.location.latitude,
            lng: origin.location.longitude
          }),
          distanceMeters(point, {
            lat: destination.location.latitude,
            lng: destination.location.longitude
          })
        )
      ),
      toiletLike: isToiletLikePlace(candidate)
    };
  });

  const corridorCandidates = enriched.filter(
    (entry) =>
      entry.routeOffsetMeters <= MAX_COMFORT_ROUTE_OFFSET_METERS &&
      entry.endpointDistanceMeters <= MAX_COMFORT_ENDPOINT_DISTANCE_METERS
  );

  const filtered = corridorCandidates.length > 0 ? corridorCandidates : enriched;
  const corridorToiletLike = corridorCandidates.filter((entry) => entry.toiletLike);
  const allToiletLike = filtered.filter((entry) => entry.toiletLike);
  const prioritized =
    needCategory === 'toilet'
      ? corridorToiletLike.length > 0
        ? corridorToiletLike
        : corridorCandidates.length > 0
          ? corridorCandidates
          : allToiletLike.length > 0
            ? allToiletLike
            : filtered
      : filtered;

  return prioritized
    .sort((a, b) => a.approachMeters - b.approachMeters)
    .slice(0, 4);
}

async function evaluateComfortStopPlans({
  needCategory,
  candidates,
  origin,
  destination,
  profile,
  hazards,
  trace
}) {
  const evaluations = [];

  for (const entry of candidates.slice(0, 3)) {
    const rankedRoutes = await fetchRankedRoutes({
      points: [
        getRoutePoint(origin),
        getRoutePoint(entry.candidate),
        getRoutePoint(destination)
      ],
      profile,
      hazards,
      trace,
      label: `via ${entry.candidate.name}`
    });

    const bestRoute = pickBestRankedRoute(rankedRoutes, hazards);
    const compositeScore = bestRoute.score - utilityBias(entry.candidate, needCategory);
    evaluations.push({
      stop: entry.candidate,
      approachMeters: entry.approachMeters,
      route: bestRoute,
      rankedRoutes,
      compositeScore
    });
  }

  evaluations.sort((a, b) => a.compositeScore - b.compositeScore);
  return evaluations;
}

async function findBypassPlan({
  origin,
  destination,
  hazard,
  profile,
  hazards,
  trace
}) {
  const places = [];

  for (const query of BYPASS_QUERIES) {
    const nearby = await nearbySearch(hazard.position, query);
    addToolTrace(trace, 'nearby_search(bypass)', { at: hazard.position, query }, `${nearby.length} result(s)`);
    places.push(...nearby.slice(0, 2));
    const searched = await searchPlaces(query, hazard.position);
    addToolTrace(trace, 'search_places(bypass)', { at: hazard.position, query }, `${searched.length} result(s)`);
    places.push(...searched.slice(0, 2));
  }

  const candidates = dedupePlaces(places).slice(0, 4);
  const evaluations = [];

  for (const candidate of candidates) {
    const rankedRoutes = await fetchRankedRoutes({
      points: [
        getRoutePoint(origin),
        getRoutePoint(candidate),
        getRoutePoint(destination)
      ],
      profile,
      hazards,
      trace,
      label: `bypass via ${candidate.name}`
    });

    const clearRoute = rankedRoutes.find((route) => !lineTouchesHazard(route.geometry, hazard, 50));
    if (clearRoute) {
      evaluations.push({
        bypass: candidate,
        route: clearRoute,
        rankedRoutes
      });
    }
  }

  evaluations.sort((a, b) => a.route.score - b.route.score);
  return evaluations[0] ?? null;
}

function buildNarration({ route, comfortStop, hazardCount, profile, strategy }) {
  const minutes = Math.round(route.durationSeconds / 60);
  const distanceKm = (route.distanceMeters / 1000).toFixed(2);
  const stopLine = comfortStop ? ` with a ${comfortStop.category} stop` : '';
  const hazardLine = hazardCount > 0 ? ` Watching ${hazardCount} live obstacle flag(s).` : '';
  return `Safest route ready for ${profile.mobilityAid}. ${minutes} minutes over ${distanceKm} km${stopLine}. Strategy: ${strategy}.${hazardLine}`;
}

function strategyLabel(strategy) {
  switch (strategy) {
    case 'comfort-stop':
      return 'comfort stop inserted after comparing candidate detours';
    case 'hazard-bypass':
      return 'hazard bypass selected after rejecting blocked options';
    case 'safe-alternative':
      return 'safe alternative selected over the fastest blocked route';
    default:
      return 'baseline route selected';
  }
}

function formatHazardName(hazard) {
  return String(hazard.analysis.obstacle_type || 'hazard').replaceAll('_', ' ');
}

function choosePrimaryHazard(hazards, route) {
  const touching = hazards.filter((hazard) => lineTouchesHazard(route.geometry, hazard, 50));
  return touching.sort((a, b) => hazardSeverityValue(b) - hazardSeverityValue(a))[0] ?? null;
}

function isRouteWithinGuardrail(route, baselineRoute) {
  if (!route || !baselineRoute) {
    return true;
  }

  return (
    route.durationSeconds <= baselineRoute.durationSeconds * MAX_ROUTE_INFLATION_RATIO &&
    route.distanceMeters <= baselineRoute.distanceMeters * MAX_ROUTE_INFLATION_RATIO
  );
}

export async function buildRoutePlan(payload) {
  const profile = profileSchema.parse(payload.profile ?? {});
  const sessionId = payload.sessionId || makeSessionId();
  const currentLocation = payload.currentLocation ?? null;
  const hazards = listHazards(sessionId);
  const trace = [makeTraceStep('decision', 'profile', `Mobility aid: ${profile.mobilityAid}`)];

  const { resolvedOrigin, resolvedDestination } = await resolveEndpoints({
    originQuery: payload.origin,
    destinationQuery: payload.destination,
    currentLocation,
    trace
  });

  let rankedRoutes = await fetchRankedRoutes({
    points: [
      getRoutePoint(resolvedOrigin),
      getRoutePoint(resolvedDestination)
    ],
    profile,
    hazards,
    trace,
    label: `${resolvedOrigin.name} -> ${resolvedDestination.name}`
  });

  let selectedRoute = pickBestRankedRoute(rankedRoutes, hazards);
  const baselineRoute = selectedRoute;
  let strategy = 'baseline';
  let comfortStop = null;
  let bypassStop = null;
  let poiCandidates = [];
  let previousRoute = null;
  const safetyPriority = Boolean(payload.safetyPriority);

  if (rankedRoutes[0] && rankedRoutes[0].id !== selectedRoute.id) {
    strategy = 'safe-alternative';
    addDecision(
      trace,
      'safe_alternative',
      `Rejected ${rankedRoutes[0].id} because it intersects an active hazard. Selected ${selectedRoute.id} instead.`
    );
  } else {
    addDecision(trace, 'baseline_selection', `Selected ${selectedRoute.id} as the best starting route.`);
  }

  if (safetyPriority && hazards.length > 0) {
    addDecision(
      trace,
      'safety_replan',
      `Re-evaluated route choices against ${hazards.length} active hazard(s) before considering any comfort detours.`
    );
  }

  const explicitNeedCategory = summarizeNeed(payload.need);
  const budgetNeedCategory = explicitNeedCategory ? '' : inferBudgetComfortNeed(selectedRoute, profile);
  const needCategory = explicitNeedCategory || budgetNeedCategory;
  if (budgetNeedCategory) {
    addDecision(
      trace,
      'budget_support_context',
      `Route exceeds the ${profile.maxContinuousMeters} m walking budget, so nearby rest-support POIs were checked.`
    );
  }
  if (needCategory && !safetyPriority) {
    const comfortCandidates = await buildComfortCandidates({
      needCategory,
      routeGeometry: selectedRoute.geometry,
      origin: resolvedOrigin,
      destination: resolvedDestination,
      currentLocation,
      preferMidpointAnchor: Boolean(payload.demoForcePoiDetour),
      trace
    });

    if (comfortCandidates.length > 0) {
      poiCandidates = comfortCandidates.map((entry) => entry.candidate);
      addDecision(
        trace,
        'comfort_candidates',
        `Evaluating ${comfortCandidates.length} candidate stop(s) for ${needCategory}.`
      );

      const comfortPlans = await evaluateComfortStopPlans({
        needCategory,
        candidates: comfortCandidates,
        origin: resolvedOrigin,
        destination: resolvedDestination,
        profile,
        hazards,
        trace
      });

      const bestPlan = comfortPlans[0];
      if (
        bestPlan &&
        bestPlan.route.score <= selectedRoute.score + 400 &&
        isRouteWithinGuardrail(bestPlan.route, baselineRoute)
      ) {
        comfortStop = bestPlan.stop;
        rankedRoutes = bestPlan.rankedRoutes;
        selectedRoute = bestPlan.route;
        strategy = 'comfort-stop';
        addDecision(
          trace,
          'comfort_selection',
          `Selected ${comfortStop.name} after comparing ${comfortPlans.length} route-adjusted stop plan(s).`
        );
      } else {
        addDecision(trace, 'comfort_rejected', 'No comfort stop improved safety enough to justify the detour within the route inflation guardrail.');
      }
    }
  } else if (needCategory && safetyPriority) {
    addDecision(trace, 'comfort_deferred', 'Skipped comfort-stop search because a high-risk obstacle triggered safety-first replanning.');
  }

  const primaryHazard = choosePrimaryHazard(hazards, selectedRoute);
  if (primaryHazard && primaryHazard.analysis.recommended_action === 'reroute') {
    addDecision(
      trace,
      'hazard_block',
      `Hazard ${primaryHazard.analysis.obstacle_type} blocks the selected route. Trying bypass anchors.`
    );

    const bypassPlan = await findBypassPlan({
      origin: resolvedOrigin,
      destination: resolvedDestination,
      hazard: primaryHazard,
      profile,
      hazards,
      trace
    });

    if (bypassPlan) {
      if (isRouteWithinGuardrail(bypassPlan.route, baselineRoute)) {
        bypassStop = bypassPlan.bypass;
        rankedRoutes = bypassPlan.rankedRoutes;
        selectedRoute = bypassPlan.route;
        strategy = 'hazard-bypass';
        addDecision(
          trace,
          'bypass_selection',
          `Selected bypass anchor ${bypassStop.name} after rejecting blocked route options.`
        );
      } else {
        addDecision(trace, 'bypass_rejected', 'Rejected bypass plan because the detour exceeded the route inflation guardrail.');
      }
    } else {
      addDecision(trace, 'bypass_failed', 'No safe bypass anchor found. Keeping the least-risk route and warning the user.');
    }
  }

  if (primaryHazard && lineTouchesHazard(selectedRoute.geometry, primaryHazard, 50)) {
    previousRoute = routeToFeature(selectedRoute);
    selectedRoute = {
      ...selectedRoute,
      geometry: buildVisualBypassGeometry(selectedRoute.geometry, primaryHazard)
    };
    addDecision(
      trace,
      'visual_bypass',
      'Rendered a local bypass around the blocked segment so the reroute is visible on the map.'
    );
  }

  if (payload.demoForcePoiDetour && !comfortStop && poiCandidates.length > 0) {
    comfortStop = selectVisibleDemoPoi(
      poiCandidates,
      selectedRoute.geometry,
      resolvedOrigin,
      resolvedDestination
    );
    previousRoute = routeToFeature(selectedRoute);
    selectedRoute = {
      ...selectedRoute,
      geometry: buildVisualPoiDetourGeometry(selectedRoute.geometry, {
        lat: comfortStop.location.latitude,
        lng: comfortStop.location.longitude
      })
    };
    strategy = 'comfort-stop';
    addDecision(
      trace,
      'demo_poi_detour',
      `Forced a visible demo detour via ${comfortStop.name} so the toilet/support POI reroute is clear on the map.`
    );
  }

  const displayPois = selectComfortDisplayPois(poiCandidates, comfortStop || bypassStop, 2);

  const mapData = {
    center: [resolvedOrigin.location.longitude, resolvedOrigin.location.latitude],
    zoom: 15,
    selectedRouteId: selectedRoute.id,
    markers: [
      { ...formatPlace(resolvedOrigin), kind: 'origin' },
      { ...formatPlace(resolvedDestination), kind: 'destination' },
      ...(comfortStop ? [{ ...formatPlace(comfortStop), kind: 'comfort-stop' }] : []),
      ...(bypassStop ? [{ ...formatPlace(bypassStop), kind: 'comfort-stop' }] : []),
      ...displayPois
        .filter((candidate) => candidate.id !== comfortStop?.id && candidate.id !== bypassStop?.id)
        .slice(0, 1)
        .map((candidate) => ({
          ...formatPlace(candidate),
          name: `${poiLabelFromCategory(candidate.category)}: ${candidate.name}`,
          kind: 'poi-candidate'
        })),
      ...hazards.map((hazard, index) => ({
        id: hazard.id,
        name: `${formatHazardName(hazard)} ahead`,
        address: hazard.analysis.short_reason,
        category: hazard.analysis.obstacle_type,
        lat: hazard.position.lat,
        lng: hazard.position.lng,
        kind: 'hazard'
      }))
    ],
    previousRoute,
    route: routeToFeature(selectedRoute),
    routeChoices: rankedRoutes.map((route) => ({
      id: route.id,
      durationMinutes: Math.round(route.durationSeconds / 60),
      distanceMeters: route.distanceMeters,
      score: Math.round(route.score),
      blockedByHazard: hazards.some((hazard) => lineTouchesHazard(route.geometry, hazard, 50)),
      selected: route.id === selectedRoute.id
    }))
  };

  return {
    sessionId,
    profile,
    origin: formatPlace(resolvedOrigin),
    destination: formatPlace(resolvedDestination),
    comfortStop: comfortStop ? formatPlace(comfortStop) : null,
    bypassStop: bypassStop ? formatPlace(bypassStop) : null,
    poiCandidates: selectComfortDisplayPois(poiCandidates, comfortStop || bypassStop, 2).map(formatPlace),
    summary: {
      etaMinutes: Math.round(selectedRoute.durationSeconds / 60),
      distanceMeters: selectedRoute.distanceMeters,
      strategy,
      strategyLabel: strategyLabel(strategy),
      narration: buildNarration({
        route: selectedRoute,
        comfortStop: comfortStop || bypassStop,
        hazardCount: hazards.length,
        profile,
        strategy: strategyLabel(strategy)
      })
    },
    mapData,
    hazards,
    trace
  };
}

export async function analyzeObstacleAndMaybeReplan(payload) {
  const profile = profileSchema.parse(payload.profile ?? {});
  const sessionId = payload.sessionId || makeSessionId();
  const currentLocation = payload.currentLocation;
  const analysis = await analyzeObstacleImage({
    imageBase64: payload.imageBase64,
    note: payload.note,
    profile
  });

  const attachment = nearestPointOnRoute(payload.currentRouteGeometry ?? [], currentLocation);
  const hazard = {
    id: `hazard-${Date.now()}`,
    position: attachment?.point ?? currentLocation,
    attachedRouteId: payload.currentRouteId || null,
    attachedRoutePointIndex: attachment?.index ?? null,
    analysis
  };

  addHazard(sessionId, hazard);

  const updatedPlan = await buildRoutePlan({
    sessionId,
    profile,
    origin: payload.origin,
    destination: payload.destination,
    currentLocation,
    need: payload.need,
    safetyPriority: analysis.recommended_action === 'reroute'
  });

  return {
    sessionId,
    obstacle: hazard,
    updatedPlan
  };
}
