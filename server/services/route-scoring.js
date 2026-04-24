function toRadians(value) {
  return (value * Math.PI) / 180;
}

export function distanceMeters(a, b) {
  const earthRadius = 6371000;
  const deltaLat = toRadians(b.lat - a.lat);
  const deltaLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const sinLat = Math.sin(deltaLat / 2);
  const sinLng = Math.sin(deltaLng / 2);
  const calc =
    sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * earthRadius * Math.atan2(Math.sqrt(calc), Math.sqrt(1 - calc));
}

export function midpointFromGeometry(geometry) {
  if (!geometry?.length) {
    return { lat: 1.3521, lng: 103.8198 };
  }
  const mid = geometry[Math.floor(geometry.length / 2)];
  return { lng: mid[0], lat: mid[1] };
}

export function lineTouchesHazard(routeGeometry, hazard, thresholdMeters = 40) {
  if (!routeGeometry?.length || !hazard?.position) {
    return false;
  }

  return routeGeometry.some(([lng, lat]) => {
    return (
      distanceMeters(
        { lat, lng },
        { lat: hazard.position.lat, lng: hazard.position.lng }
      ) <= thresholdMeters
    );
  });
}

export function nearestPointOnRoute(routeGeometry, position) {
  if (!routeGeometry?.length || !position) {
    return null;
  }

  let best = null;
  for (let index = 0; index < routeGeometry.length; index += 1) {
    const [lng, lat] = routeGeometry[index];
    const distance = distanceMeters({ lat, lng }, position);
    if (!best || distance < best.distanceMeters) {
      best = {
        index,
        point: { lat, lng },
        distanceMeters: distance
      };
    }
  }

  return best;
}

function metersToLatDegrees(meters) {
  return meters / 111320;
}

function metersToLngDegrees(meters, latitude) {
  return meters / (111320 * Math.cos(toRadians(latitude)));
}

export function buildVisualBypassGeometry(routeGeometry, hazard, offsetMeters = 45, spreadPoints = 6) {
  if (!routeGeometry?.length || !hazard?.position) {
    return routeGeometry ?? [];
  }

  const nearest = nearestPointOnRoute(routeGeometry, hazard.position);
  if (!nearest) {
    return routeGeometry;
  }

  const pivotIndex = nearest.index;
  const startIndex = Math.max(0, pivotIndex - spreadPoints);
  const endIndex = Math.min(routeGeometry.length - 1, pivotIndex + spreadPoints);
  const start = routeGeometry[startIndex];
  const end = routeGeometry[endIndex];

  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy) || 1;
  const perpX = -dy / length;
  const perpY = dx / length;

  const midLat = hazard.position.lat;
  const lngScale = metersToLngDegrees(offsetMeters, midLat);
  const latScale = metersToLatDegrees(offsetMeters);

  const detourA = [
    hazard.position.lng + perpX * lngScale,
    hazard.position.lat + perpY * latScale
  ];
  const detourB = [
    hazard.position.lng + perpX * lngScale * 1.2,
    hazard.position.lat + perpY * latScale * 1.2
  ];

  return [
    ...routeGeometry.slice(0, startIndex + 1),
    detourA,
    detourB,
    ...routeGeometry.slice(endIndex)
  ];
}

export function buildVisualPoiDetourGeometry(routeGeometry, poi, spreadPoints = 5) {
  if (!routeGeometry?.length || !poi?.lat || !poi?.lng) {
    return routeGeometry ?? [];
  }

  const nearest = nearestPointOnRoute(routeGeometry, poi);
  if (!nearest) {
    return routeGeometry;
  }

  const attachIndex = nearest.index;
  const startIndex = Math.max(0, attachIndex - spreadPoints);
  const rejoinIndex = Math.min(routeGeometry.length - 1, attachIndex + spreadPoints);
  const poiPoint = [poi.lng, poi.lat];

  return [
    ...routeGeometry.slice(0, startIndex + 1),
    routeGeometry[startIndex],
    poiPoint,
    routeGeometry[rejoinIndex],
    ...routeGeometry.slice(rejoinIndex)
  ];
}

export function scoreRouteForProfile(route, profile, hazards = []) {
  const pacePenalty = profile.mobilityAid === 'wheelchair' ? 0.9 : 1;
  const restPenalty =
    route.distanceMeters > profile.maxContinuousMeters
      ? Math.ceil(route.distanceMeters / profile.maxContinuousMeters) * 80
      : 0;
  const trafficPenalty = (route.trafficLights ?? 0) * 20;
  const hazardPenalty = hazards.reduce((sum, hazard) => {
    return sum + (lineTouchesHazard(route.geometry, hazard) ? 400 : 0);
  }, 0);

  return route.durationSeconds * pacePenalty + restPenalty + trafficPenalty + hazardPenalty;
}

export function rankRoutes(routes, profile, hazards = []) {
  return [...routes]
    .map((route) => ({
      ...route,
      score: scoreRouteForProfile(route, profile, hazards)
    }))
    .sort((a, b) => a.score - b.score);
}
