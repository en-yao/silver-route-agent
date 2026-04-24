import { decodePolyline6 } from './polyline6.js';
import {
  findFixturePlace,
  getFixtureDirections,
  getFixtureNearby,
  searchFixturePlaces
} from './fixtures.js';

const baseUrl = process.env.GRABMAPS_BASE_URL || 'https://maps.grab.com';
const apiKey = process.env.GRABMAPS_API_KEY;
const proxyPrefix = '/api/grab/proxy';

function authHeaders() {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

function hasGrabMapsKey() {
  return Boolean(apiKey);
}

function osmFallbackStyle() {
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: [
          'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'
        ],
        tileSize: 256,
        attribution: '&copy; OpenStreetMap contributors'
      }
    },
    layers: [
      {
        id: 'osm',
        type: 'raster',
        source: 'osm'
      }
    ]
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...authHeaders()
    }
  });

  if (!response.ok) {
    throw new Error(`GrabMaps request failed with ${response.status}`);
  }

  return response.json();
}

async function fetchResponse(url) {
  const response = await fetch(url, {
    headers: {
      ...authHeaders()
    }
  });

  if (!response.ok) {
    throw new Error(`GrabMaps request failed with ${response.status}`);
  }

  return response;
}

function rewriteStyleUrls(value) {
  if (typeof value === 'string') {
    return value.startsWith(baseUrl)
      ? `${proxyPrefix}${value.slice(baseUrl.length)}`
      : value;
  }

  if (Array.isArray(value)) {
    return value.map(rewriteStyleUrls);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, rewriteStyleUrls(nestedValue)])
    );
  }

  return value;
}

function centroidFromPolygon(points = []) {
  if (!points.length) {
    return null;
  }

  const total = points.reduce(
    (sum, point) => ({
      lat: sum.lat + point.lat,
      lng: sum.lng + point.lng
    }),
    { lat: 0, lng: 0 }
  );

  return {
    latitude: total.lat / points.length,
    longitude: total.lng / points.length
  };
}

function extractEntrance(raw) {
  const entranceArea = (raw.areas ?? []).find((area) => area.type === 'ENTRANCE');
  const firstRing = entranceArea?.polygons?.[0]?.[0] ?? [];
  const centroid = centroidFromPolygon(firstRing);
  if (!centroid) {
    return null;
  }

  return {
    source: entranceArea.source ?? 'ENTRANCE',
    centroid,
    polygon: firstRing
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

function normalizePlace(raw) {
  const latitude = raw.location?.latitude ?? raw.location?.[0] ?? 1.3521;
  const longitude = raw.location?.longitude ?? raw.location?.[1] ?? 103.8198;
  return {
    id: raw.poi_id ?? raw.id ?? raw.name,
    name: raw.name,
    category: raw.category ?? raw.business_type ?? raw.place_type ?? 'place',
    formatted_address: raw.formatted_address ?? raw.address ?? '',
    location: { latitude, longitude },
    entrance: extractEntrance(raw),
    raw
  };
}

function routeToGeo(route, index = 0) {
  const geometry = route.geometry ? decodePolyline6(route.geometry) : [];
  return {
    id: `route-${index + 1}`,
    distanceMeters: route.distance ?? 0,
    durationSeconds: route.duration ?? 0,
    trafficLights: route.traffic_light ?? 0,
    geometry
  };
}

export async function getMapStyle() {
  if (!hasGrabMapsKey()) {
    return osmFallbackStyle();
  }

  try {
    const style = await fetchJson(`${baseUrl}/api/style.json?theme=basic`);
    return rewriteStyleUrls(style);
  } catch (error) {
    console.warn('Falling back to OSM style.', error);
    return osmFallbackStyle();
  }
}

export async function proxyMapAsset(assetPathAndQuery) {
  const normalizedPath = assetPathAndQuery.startsWith('/')
    ? assetPathAndQuery
    : `/${assetPathAndQuery}`;
  return fetchResponse(`${baseUrl}${normalizedPath}`);
}

export async function searchPlaces(keyword, bias) {
  if (!hasGrabMapsKey()) {
    return searchFixturePlaces(keyword).map(normalizePlace);
  }

  const params = new URLSearchParams({
    keyword,
    country: 'SGP',
    limit: '5'
  });
  if (bias) {
    params.set('location', `${bias.lat},${bias.lng}`);
  }

  const data = await fetchJson(`${baseUrl}/api/v1/maps/poi/v1/search?${params}`);
  return (data.places ?? []).map(normalizePlace);
}

export async function findBestPlace(query, bias) {
  const results = await searchPlaces(query, bias);
  return results[0] ?? normalizePlace(findFixturePlace(query));
}

export async function reverseGeocode(position) {
  if (!hasGrabMapsKey()) {
    return normalizePlace(findFixturePlace('Tiong Bahru MRT'));
  }

  const params = new URLSearchParams({
    location: `${position.lat},${position.lng}`
  });
  const data = await fetchJson(`${baseUrl}/api/v1/maps/poi/v1/reverse-geo?${params}`);
  return normalizePlace(data.places?.[0] ?? findFixturePlace('Tiong Bahru MRT'));
}

export async function nearbySearch(position, keyword) {
  if (!hasGrabMapsKey()) {
    return getFixtureNearby(keyword).map(normalizePlace);
  }

  const params = new URLSearchParams({
    location: `${position.lat},${position.lng}`,
    radius: '0.4',
    limit: '10',
    rankBy: 'distance'
  });

  const data = await fetchJson(`${baseUrl}/api/v1/maps/place/v2/nearby?${params}`);
  const places = (data.places ?? []).map(normalizePlace);
  if (!keyword) {
    return places;
  }

  const keywordPlaces = await searchPlaces(keyword, position);
  const normalized = keyword.toLowerCase();
  const rankedNearby = places
    .map((place) => ({
      place,
      matchScore:
        (place.name.toLowerCase().includes(normalized) ? 2 : 0) +
        (String(place.category).toLowerCase().includes(normalized) ? 2 : 0)
    }))
    .sort((a, b) => b.matchScore - a.matchScore)
    .map((entry) => entry.place);

  return dedupePlaces([...rankedNearby, ...keywordPlaces]);
}

export function getRoutePoint(place) {
  if (place?.entrance?.centroid) {
    return {
      lat: place.entrance.centroid.latitude,
      lng: place.entrance.centroid.longitude
    };
  }

  return {
    lat: place.location.latitude,
    lng: place.location.longitude
  };
}

export async function getDirections(points) {
  const hasWaypoint = points.length > 2;
  if (!hasGrabMapsKey()) {
    return getFixtureDirections(hasWaypoint);
  }

  const params = new URLSearchParams();
  for (const point of points) {
    params.append('coordinates', `${point.lng},${point.lat}`);
  }
  params.set('profile', 'walking');
  params.set('overview', 'full');
  params.set('alternatives', '2');

  const data = await fetchJson(`${baseUrl}/api/v1/maps/eta/v1/direction?${params}`);
  return (data.routes ?? []).map((route, index) => routeToGeo(route, index));
}
