import OpenAI from 'openai';
import { z } from 'zod';
import { addHazard, listHazards } from './hazard-store.js';
import { buildRoutePlan } from './planner.js';
import { findBestPlace, getDirections, getRoutePoint, nearbySearch, reverseGeocode, searchPlaces } from './grabmaps.js';
import { analyzeObstacleImage } from './vlm.js';
import {
  buildVisualBypassGeometry,
  buildVisualPoiDetourGeometry,
  distanceMeters,
  lineTouchesHazard,
  midpointFromGeometry,
  nearestPointOnRoute,
  rankRoutes
} from './route-scoring.js';

const profileSchema = z.object({
  mobilityAid: z.enum(['walker', 'wheelchair', 'cane', 'slow-walk', 'unaided']).default('walker'),
  maxContinuousMeters: z.number().min(50).max(2000).default(250)
});

const COMFORT_QUERY_PRESETS = {
  toilet: ['public toilet', 'toilet', 'restroom', 'mall toilet'],
  bench: ['bench', 'shelter', 'cafe'],
  clinic: ['clinic', 'pharmacy', 'shelter'],
  shelter: ['shelter', 'cafe', 'clinic']
};
const MAX_ROUTE_INFLATION_RATIO = 2;
const MAX_COMFORT_ROUTE_OFFSET_METERS = 180;
const MAX_COMFORT_ENDPOINT_DISTANCE_METERS = 420;

function hasOpenAIKey() {
  return Boolean(process.env.OPENAI_API_KEY);
}

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

function strategyLabel(strategy) {
  switch (strategy) {
    case 'comfort-stop':
      return 'comfort stop inserted after tool-guided candidate comparison';
    case 'hazard-bypass':
      return 'hazard bypass selected after the model rejected blocked routes';
    case 'safe-alternative':
      return 'safe alternative selected over the fastest blocked route';
    default:
      return 'baseline route selected';
  }
}

function formatHazardName(hazard) {
  return String(hazard.analysis.obstacle_type || 'hazard').replaceAll('_', ' ');
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

function buildNarration({ route, profile, strategy, comfortStop, hazardCount }) {
  const minutes = Math.round(route.durationSeconds / 60);
  const distanceKm = (route.distanceMeters / 1000).toFixed(2);
  const stopLine = comfortStop ? ` via ${comfortStop.name}` : '';
  const hazardLine = hazardCount ? ` Watching ${hazardCount} active hazard flag(s).` : '';
  return `Agent-planned safe route for ${profile.mobilityAid}. ${minutes} minutes over ${distanceKm} km${stopLine}. Strategy: ${strategyLabel(strategy)}.${hazardLine}`;
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

function extractJson(text) {
  if (!text) {
    throw new Error('Agent returned empty text.');
  }
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {}

  const match = trimmed.match(/\{[\s\S]*\}$/);
  if (!match) {
    throw new Error('Agent did not return valid JSON.');
  }
  return JSON.parse(match[0]);
}

function findOutputText(response) {
  if (response.output_text) {
    return response.output_text;
  }

  const texts = [];
  for (const item of response.output ?? []) {
    if (item.type === 'message') {
      for (const content of item.content ?? []) {
        if (content.type === 'output_text') {
          texts.push(content.text);
        }
      }
    }
  }
  return texts.join('\n');
}

function buildToolDefinitions() {
  return [
    {
      type: 'function',
      name: 'resolve_place',
      description: 'Resolve a place query into a normalized point for origin or destination.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          role: { type: 'string', enum: ['origin', 'destination'] }
        },
        required: ['query', 'role'],
        additionalProperties: false
      }
    },
    {
      type: 'function',
      name: 'get_route_options',
      description: 'Get ranked route candidates between two known places. Use after resolving origin and destination.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          origin_place_id: { type: 'string' },
          destination_place_id: { type: 'string' }
        },
        required: ['origin_place_id', 'destination_place_id'],
        additionalProperties: false
      }
    },
    {
      type: 'function',
      name: 'search_support_places',
      description: 'Search for comfort or bypass places near the active route midpoint or current position.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          need_category: { type: 'string', enum: ['toilet', 'bench', 'clinic', 'shelter'] },
          route_set_id: { type: 'string' }
        },
        required: ['need_category', 'route_set_id'],
        additionalProperties: false
      }
    },
    {
      type: 'function',
      name: 'get_route_via_stop',
      description: 'Compare route options that go via a specific stop or bypass anchor.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          origin_place_id: { type: 'string' },
          stop_place_id: { type: 'string' },
          destination_place_id: { type: 'string' }
        },
        required: ['origin_place_id', 'stop_place_id', 'destination_place_id'],
        additionalProperties: false
      }
    }
  ];
}

function makeAgentTrace(toolName, args, result) {
  return {
    type: 'tool',
    title: `agent:${toolName}`,
    detail: result.summary || 'Tool executed.',
    data: args
  };
}

function makeAgentDecision(title, detail, data) {
  return {
    type: 'decision',
    title,
    detail,
    data
  };
}

export async function buildRoutePlanWithAgent(payload) {
  if (!hasOpenAIKey()) {
    const fallback = await buildRoutePlan(payload);
    return {
      ...fallback,
      trace: [
        makeAgentDecision('agent_fallback', 'No OpenAI key found. Used deterministic planner fallback.'),
        ...(fallback.trace ?? [])
      ],
      summary: {
        ...fallback.summary,
        agentMode: 'fallback'
      }
    };
  }

  const profile = profileSchema.parse(payload.profile ?? {});
  const sessionId = payload.sessionId || makeSessionId();
  const currentLocation = payload.currentLocation ?? null;
  const hazards = listHazards(sessionId);
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_AGENT_MODEL || 'gpt-4.1-mini';

  const placeStore = new Map();
  const routeStore = new Map();
  const stopStore = new Map();
  const trace = [makeAgentDecision('agent_mode', `Using ${model} with Responses API tool calling.`)];
  let routeCounter = 0;
  let stopCounter = 0;

  async function resolvePlace(query, role) {
    const place = role === 'origin' && !query && currentLocation
      ? await reverseGeocode(currentLocation)
      : await findBestPlace(query, currentLocation);
    placeStore.set(place.id, place);
    return {
      place_id: place.id,
      name: place.name,
      category: place.category,
      lat: place.location.latitude,
      lng: place.location.longitude,
      summary: `Resolved ${role} to ${place.name}.`
    };
  }

  async function getRouteOptions(originId, destinationId) {
    const origin = placeStore.get(originId);
    const destination = placeStore.get(destinationId);
    if (!origin || !destination) {
      throw new Error('Unknown origin or destination id.');
    }

    const rankedRoutes = rankRoutes(
      await getDirections([
        getRoutePoint(origin),
        getRoutePoint(destination)
      ]),
      profile,
      hazards
    );

    const routeSetId = `route-set-${++routeCounter}`;
    routeStore.set(routeSetId, {
      routeSetId,
      type: 'direct',
      originId,
      destinationId,
      rankedRoutes
    });

    return {
      route_set_id: routeSetId,
      routes: rankedRoutes.map((route) => ({
        route_id: route.id,
        score: Math.round(route.score),
        duration_minutes: Math.round(route.durationSeconds / 60),
        distance_meters: route.distanceMeters,
        blocked_by_hazard: hazards.some((hazard) => lineTouchesHazard(route.geometry, hazard, 50))
      })),
      hazard_count: hazards.length,
      summary: `Computed ${rankedRoutes.length} route option(s).`
    };
  }

  async function searchSupportPlaces(needCategory, routeSetId) {
    const routeSet = routeStore.get(routeSetId);
    if (!routeSet) {
      throw new Error('Unknown route set id.');
    }

    const anchor =
      needCategory === 'toilet'
        ? midpointFromGeometry(routeSet.rankedRoutes[0].geometry)
        : currentLocation || midpointFromGeometry(routeSet.rankedRoutes[0].geometry);
    const queries = COMFORT_QUERY_PRESETS[needCategory] ?? [needCategory];
    const candidates = [];

    for (const query of queries) {
      const nearby = await nearbySearch(anchor, query);
      candidates.push(...nearby.slice(0, 3));
      const searched = await searchPlaces(query, anchor);
      candidates.push(...searched.slice(0, 2));
    }

    const deduped = [];
    const seen = new Set();
    for (const candidate of candidates) {
      if (seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      deduped.push(candidate);
    }

    const origin = placeStore.get(routeSet.originId);
    const destination = placeStore.get(routeSet.destinationId);
    const enriched = deduped.map((place) => {
      const point = {
        lat: place.location.latitude,
        lng: place.location.longitude
      };
      return {
        place,
        approachMeters: Math.round(distanceMeters(anchor, point)),
        routeOffsetMeters: Math.round(minDistanceToRoute(routeSet.rankedRoutes[0].geometry, point)),
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
        toiletLike: isToiletLikePlace(place)
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

    const stopSetId = `stop-set-${++stopCounter}`;
    stopStore.set(
      stopSetId,
      prioritized.slice(0, 4).map(({ place }) => {
        placeStore.set(place.id, place);
        return place;
      })
    );

    return {
      stop_set_id: stopSetId,
      stops: (stopStore.get(stopSetId) ?? []).map((place) => ({
        place_id: place.id,
        name: place.name,
        category: place.category,
        approach_meters: Math.round(
          distanceMeters(anchor, { lat: place.location.latitude, lng: place.location.longitude })
        )
      })),
      summary: `Found ${(stopStore.get(stopSetId) ?? []).length} support place candidate(s) for ${needCategory}.`
    };
  }

  async function getRouteViaStop(originId, stopId, destinationId) {
    const origin = placeStore.get(originId);
    const stop = placeStore.get(stopId);
    const destination = placeStore.get(destinationId);
    if (!origin || !stop || !destination) {
      throw new Error('Unknown origin, stop, or destination id.');
    }

    const rankedRoutes = rankRoutes(
      await getDirections([
        getRoutePoint(origin),
        getRoutePoint(stop),
        getRoutePoint(destination)
      ]),
      profile,
      hazards
    );

    const routeSetId = `route-set-${++routeCounter}`;
    routeStore.set(routeSetId, {
      routeSetId,
      type: 'via-stop',
      originId,
      destinationId,
      stopId,
      rankedRoutes
    });

    return {
      route_set_id: routeSetId,
      stop_place_id: stopId,
      routes: rankedRoutes.map((route) => ({
        route_id: route.id,
        score: Math.round(route.score),
        duration_minutes: Math.round(route.durationSeconds / 60),
        distance_meters: route.distanceMeters,
        blocked_by_hazard: hazards.some((hazard) => lineTouchesHazard(route.geometry, hazard, 50))
      })),
      summary: `Computed ${rankedRoutes.length} route option(s) via ${stop.name}.`
    };
  }

  const toolImpls = {
    resolve_place: async ({ query, role }) => resolvePlace(query, role),
    get_route_options: async ({ origin_place_id, destination_place_id }) =>
      getRouteOptions(origin_place_id, destination_place_id),
    search_support_places: async ({ need_category, route_set_id }) =>
      searchSupportPlaces(need_category, route_set_id),
    get_route_via_stop: async ({ origin_place_id, stop_place_id, destination_place_id }) =>
      getRouteViaStop(origin_place_id, stop_place_id, destination_place_id)
  };

  const instructions = [
    'You are the route-planning agent for Silver Route Agent.',
    'Your job is to plan the safest elderly-friendly route using tools.',
    'Always resolve origin and destination first, then get direct route options.',
    'If the user has an immediate need, search support places and compare at least one route-via-stop option before deciding.',
    'If any route is blocked by hazard, prefer a clear alternative. For severe hazards, use shelter or clinic bypass anchors.',
    'Return only JSON with keys: strategy, selected_route_set_id, selected_route_id, selected_stop_place_id, selected_origin_place_id, selected_destination_place_id, user_message.',
    'Allowed strategy values: baseline, comfort-stop, safe-alternative, hazard-bypass.'
  ].join(' ');

  try {
    let response = await openai.responses.create({
      model,
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: instructions
            }
          ]
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: JSON.stringify({
                origin: payload.origin || 'Tiong Bahru MRT',
                destination: payload.destination || 'Singapore General Hospital',
                currentLocation,
                profile,
                need: payload.need || null,
                safetyPriority: Boolean(payload.safetyPriority),
                hazards: hazards.map((hazard) => ({
                  type: hazard.analysis.obstacle_type,
                  severity: hazard.analysis.severity,
                  recommended_action: hazard.analysis.recommended_action
                }))
              })
            }
          ]
        }
      ],
      tools: buildToolDefinitions()
    });

    for (let step = 0; step < 8; step += 1) {
      const toolCalls = (response.output ?? []).filter((item) => item.type === 'function_call');
      if (toolCalls.length === 0) {
        break;
      }

      const toolOutputs = [];
      for (const call of toolCalls) {
        const args = JSON.parse(call.arguments || '{}');
        const result = await toolImpls[call.name](args);
        trace.push(makeAgentTrace(call.name, args, result));
        toolOutputs.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: JSON.stringify(result)
        });
      }

      response = await openai.responses.create({
        model,
        previous_response_id: response.id,
        input: toolOutputs,
        tools: buildToolDefinitions()
      });
    }

    const finalDecision = extractJson(findOutputText(response));
    const origin = placeStore.get(finalDecision.selected_origin_place_id);
    const destination = placeStore.get(finalDecision.selected_destination_place_id);
    const selectedRouteSet = routeStore.get(finalDecision.selected_route_set_id);
    const selectedRoute =
      selectedRouteSet?.rankedRoutes.find((route) => route.id === finalDecision.selected_route_id) ??
      selectedRouteSet?.rankedRoutes[0];
    const baselineRouteSet = [...routeStore.values()].find((routeSet) => routeSet.type === 'direct');
    const baselineRoute = baselineRouteSet?.rankedRoutes?.[0];
    const selectedStop = finalDecision.selected_stop_place_id
      ? placeStore.get(finalDecision.selected_stop_place_id)
      : null;

    if (!origin || !destination || !selectedRouteSet || !selectedRoute) {
      throw new Error('Agent response referenced missing route-planning state.');
    }

    let effectiveDecision = finalDecision;
    let effectiveRouteSet = selectedRouteSet;
    let effectiveRoute = selectedRoute;
    let effectiveStop = selectedStop;
    let poiCandidates = [...stopStore.values()].flat().slice(0, 3);
    let previousRoute = null;
    const explicitNeedCategory = summarizeNeed(payload.need);
    const budgetNeedCategory = explicitNeedCategory ? '' : inferBudgetComfortNeed(effectiveRoute, profile);

    if (!effectiveStop && budgetNeedCategory && poiCandidates.length === 0) {
      const budgetStopSearch = await searchSupportPlaces(
        budgetNeedCategory,
        baselineRouteSet?.routeSetId ?? effectiveRouteSet.routeSetId
      );
      poiCandidates = (stopStore.get(budgetStopSearch.stop_set_id) ?? []).slice(0, 3);
      trace.push(
        makeAgentDecision(
          'budget_support_context',
          `Route exceeds the ${profile.maxContinuousMeters} m walking budget, so nearby rest-support POIs were checked.`
        )
      );
    }

    if (!isRouteWithinGuardrail(effectiveRoute, baselineRoute)) {
      effectiveDecision = {
        ...finalDecision,
        strategy: hazards.length > 0 ? 'safe-alternative' : 'baseline',
        user_message:
          'Rejected an inflated detour and kept the best direct safe route instead.'
      };
      effectiveRouteSet = baselineRouteSet ?? selectedRouteSet;
      effectiveRoute = effectiveRouteSet.rankedRoutes[0];
      effectiveStop = null;
      trace.push(
        makeAgentDecision(
          'guardrail_override',
          'Rejected the model-selected via-stop plan because ETA or distance exceeded the route inflation guardrail.',
          {
            selected_route_id: selectedRoute.id,
            baseline_route_id: baselineRoute?.id ?? null
          }
        )
      );
    }

    trace.push(
      makeAgentDecision(
        'agent_final',
        effectiveDecision.user_message || `Selected ${effectiveDecision.strategy} strategy.`,
        effectiveDecision
      )
    );

    const primaryHazard = hazards.find((hazard) => lineTouchesHazard(effectiveRoute.geometry, hazard, 50));
    if (primaryHazard && effectiveDecision.strategy !== 'baseline') {
      previousRoute = routeToFeature(effectiveRoute);
      effectiveRoute = {
        ...effectiveRoute,
        geometry: buildVisualBypassGeometry(effectiveRoute.geometry, primaryHazard)
      };
      trace.push(
        makeAgentDecision(
          'visual_bypass',
          'Rendered a local bypass around the blocked segment so the reroute is visible on the map.'
        )
      );
    }

    if (payload.demoForcePoiDetour && !effectiveStop && poiCandidates.length > 0) {
      effectiveStop = selectVisibleDemoPoi(
        poiCandidates,
        effectiveRoute.geometry,
        origin,
        destination
      );
      previousRoute = routeToFeature(effectiveRoute);
      effectiveRoute = {
        ...effectiveRoute,
        geometry: buildVisualPoiDetourGeometry(effectiveRoute.geometry, {
          lat: effectiveStop.location.latitude,
          lng: effectiveStop.location.longitude
        })
      };
      effectiveDecision = {
        ...effectiveDecision,
        strategy: 'comfort-stop',
        user_message: `Detouring via nearby support POI ${effectiveStop.name} so the stop is visible on the map.`
      };
      trace.push(
        makeAgentDecision(
          'demo_poi_detour',
          `Forced a visible demo detour via ${effectiveStop.name} so the toilet/support POI reroute is clear on the map.`
        )
      );
    }

    const displayPois = selectComfortDisplayPois(poiCandidates, effectiveStop, 2);

    return {
      sessionId,
      profile,
      origin: formatPlace(origin),
      destination: formatPlace(destination),
      comfortStop: effectiveDecision.strategy === 'comfort-stop' && effectiveStop
        ? formatPlace(effectiveStop)
        : null,
      bypassStop: effectiveDecision.strategy === 'hazard-bypass' && effectiveStop
        ? formatPlace(effectiveStop)
        : null,
      poiCandidates: displayPois.map(formatPlace),
      summary: {
        etaMinutes: Math.round(effectiveRoute.durationSeconds / 60),
        distanceMeters: effectiveRoute.distanceMeters,
        strategy: effectiveDecision.strategy,
        strategyLabel: strategyLabel(effectiveDecision.strategy),
        narration: buildNarration({
          route: effectiveRoute,
          profile,
          strategy: effectiveDecision.strategy,
          comfortStop: effectiveStop,
          hazardCount: hazards.length
        }),
        agentMode: 'tool-calling'
      },
      mapData: {
        center: [origin.location.longitude, origin.location.latitude],
        zoom: 15,
        selectedRouteId: effectiveRoute.id,
        previousRoute,
        markers: [
          { ...formatPlace(origin), kind: 'origin' },
          { ...formatPlace(destination), kind: 'destination' },
          ...(effectiveStop
            ? [
                {
                  ...formatPlace(effectiveStop),
                  kind: 'comfort-stop'
                }
              ]
            : []),
          ...displayPois
            .filter((candidate) => candidate.id !== effectiveStop?.id)
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
        route: routeToFeature(effectiveRoute),
        routeChoices: effectiveRouteSet.rankedRoutes.map((route) => ({
          id: route.id,
          durationMinutes: Math.round(route.durationSeconds / 60),
          distanceMeters: route.distanceMeters,
          score: Math.round(route.score),
          blockedByHazard: hazards.some((hazard) => lineTouchesHazard(route.geometry, hazard, 50)),
          selected: route.id === effectiveRoute.id
        }))
      },
      hazards,
      trace
    };
  } catch (error) {
    console.warn('Agentic planner fallback triggered.', error);
    const fallback = await buildRoutePlan({
      ...payload,
      sessionId
    });
    return {
      ...fallback,
      trace: [
        makeAgentDecision(
          'agent_fallback',
          'Tool-calling planner failed, so the deterministic planner took over.',
          { error: error instanceof Error ? error.message : String(error) }
        ),
        ...(fallback.trace ?? [])
      ],
      summary: {
        ...fallback.summary,
        agentMode: 'fallback'
      }
    };
  }
}

export async function analyzeObstacleAndMaybeReplanWithAgent(payload) {
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

  const updatedPlan = await buildRoutePlanWithAgent({
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
