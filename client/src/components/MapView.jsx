import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';

const EMPTY_GEOJSON = {
  type: 'FeatureCollection',
  features: []
};
const MAP_API_BASE = import.meta.env.DEV ? 'http://localhost:8787' : '';
const DEFAULT_PITCH = 62;
const DEFAULT_BEARING = -18;

function markerAsset(kind) {
  switch (kind) {
    case 'origin':
      return '/markers/origin.svg';
    case 'destination':
      return '/markers/destination.svg';
    case 'comfort-stop':
      return '/markers/comfort-stop.svg';
    case 'poi-candidate':
      return '/markers/comfort-stop.svg';
    case 'hazard':
      return '/markers/hazard.svg';
    default:
      return '/markers/origin.svg';
  }
}

function ensureThreeDBuildings(map) {
  if (map.getLayer('demo-3d-buildings')) {
    return;
  }

  const labelLayer = map
    .getStyle()
    ?.layers?.find((layer) => layer.type === 'symbol' && layer.layout?.['text-field']);

  map.addLayer(
    {
      id: 'demo-3d-buildings',
      type: 'fill-extrusion',
      source: 'grabmaptiles',
      'source-layer': 'building',
      minzoom: 15,
      paint: {
        'fill-extrusion-color': [
          'interpolate',
          ['linear'],
          ['zoom'],
          15,
          '#d9d9d9',
          18,
          '#f2efe8'
        ],
        'fill-extrusion-height': [
          'coalesce',
          ['get', 'render_height'],
          ['get', 'height'],
          12
        ],
        'fill-extrusion-base': [
          'coalesce',
          ['get', 'render_min_height'],
          ['get', 'min_height'],
          0
        ],
        'fill-extrusion-opacity': 0.84
      }
    },
    labelLayer?.id
  );
}

function ensureRouteLayers(map) {
  if (!map.getSource('route')) {
    map.addSource('route', {
      type: 'geojson',
      data: EMPTY_GEOJSON
    });
  }

  if (!map.getSource('previous-route')) {
    map.addSource('previous-route', {
      type: 'geojson',
      data: EMPTY_GEOJSON
    });
  }

  if (!map.getLayer('previous-route')) {
    map.addLayer({
      id: 'previous-route',
      type: 'line',
      source: 'previous-route',
      layout: {
        'line-cap': 'round',
        'line-join': 'round'
      },
      paint: {
        'line-color': '#d7263d',
        'line-width': 6,
        'line-opacity': 0.72,
        'line-dasharray': [1.3, 1.1]
      }
    });
  }

  if (!map.getLayer('route-outline')) {
    map.addLayer({
      id: 'route-outline',
      type: 'line',
      source: 'route',
      layout: {
        'line-cap': 'round',
        'line-join': 'round'
      },
      paint: {
        'line-color': '#fff7ef',
        'line-width': 12,
        'line-opacity': 0.95
      }
    });
  }

  if (!map.getLayer('route-line')) {
    map.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'route',
      layout: {
        'line-cap': 'round',
        'line-join': 'round'
      },
      paint: {
        'line-color': '#f36f38',
        'line-width': 7.5,
        'line-opacity': 0.98
      }
    });
  }
}

function boundsFromCoordinates(coordinates = []) {
  if (!coordinates.length) {
    return null;
  }

  let minLng = coordinates[0][0];
  let maxLng = coordinates[0][0];
  let minLat = coordinates[0][1];
  let maxLat = coordinates[0][1];

  for (const [lng, lat] of coordinates) {
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }

  return new maplibregl.LngLatBounds([minLng, minLat], [maxLng, maxLat]);
}

function boundsFromMarkers(markers = []) {
  if (!markers.length) {
    return null;
  }

  const coordinates = markers.map((marker) => [marker.lng, marker.lat]);
  return boundsFromCoordinates(coordinates);
}

function expandBoundsWith(targetBounds, nextBounds) {
  if (!targetBounds) {
    return nextBounds;
  }
  if (!nextBounds) {
    return targetBounds;
  }

  const merged = new maplibregl.LngLatBounds(targetBounds.getSouthWest(), targetBounds.getNorthEast());
  merged.extend(nextBounds.getSouthWest());
  merged.extend(nextBounds.getNorthEast());
  return merged;
}

function markerOffset(markerData, allMarkers) {
  const overlappingMarkers = allMarkers.filter((other) => {
    if (other === markerData) {
      return false;
    }
    const lngClose = Math.abs(other.lng - markerData.lng) < 0.0002;
    const latClose = Math.abs(other.lat - markerData.lat) < 0.0002;
    return lngClose && latClose;
  });

  if (markerData.kind === 'comfort-stop') {
    return overlappingMarkers.length > 0 ? [28, -34] : [0, -30];
  }

  if (markerData.kind === 'poi-candidate') {
    return overlappingMarkers.length > 0 ? [-24, -16] : [0, -10];
  }

  if (markerData.kind === 'hazard') {
    return overlappingMarkers.length > 0 ? [22, -28] : [0, -18];
  }

  return [0, -18];
}

function absolutizeStyleUrls(value) {
  if (typeof value === 'string') {
    if (value.startsWith('/')) {
      return `${MAP_API_BASE}${value}`;
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(absolutizeStyleUrls);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, absolutizeStyleUrls(nestedValue)])
    );
  }

  return value;
}

export default function MapView({ mapData }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    let disposed = false;

    async function initMap() {
      const response = await fetch(`${MAP_API_BASE}/api/grab/style`);
      const rawStyle = await response.json();
      const style = absolutizeStyleUrls(rawStyle);

      if (disposed || !containerRef.current) {
        return;
      }

      const map = new maplibregl.Map({
        container: containerRef.current,
        style,
        center: [103.827183, 1.286972],
        zoom: 14,
        pitch: DEFAULT_PITCH,
        bearing: DEFAULT_BEARING
      });

      map.addControl(new maplibregl.NavigationControl(), 'top-right');
      map.on('load', () => {
        ensureThreeDBuildings(map);
        ensureRouteLayers(map);
      });

      mapRef.current = map;
    }

    initMap().catch((error) => {
      console.error('Map initialization failed', error);
    });

    return () => {
      disposed = true;
      for (const marker of markersRef.current) {
        marker.remove();
      }
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapData) {
      return;
    }

    const updateMap = () => {
      ensureRouteLayers(map);

      const source = map.getSource('route');
      if (source) {
        source.setData(
          mapData.route
            ? {
                type: 'FeatureCollection',
                features: [mapData.route]
              }
            : EMPTY_GEOJSON
        );
      }

      const previousSource = map.getSource('previous-route');
      if (previousSource) {
        previousSource.setData(
          mapData.previousRoute
            ? {
                type: 'FeatureCollection',
                features: [mapData.previousRoute]
              }
            : EMPTY_GEOJSON
        );
      }

      for (const marker of markersRef.current) {
        marker.remove();
      }
      markersRef.current = [];

      const markers = mapData.markers ?? [];

      for (const markerData of markers) {
        const markerNode = document.createElement('div');
        markerNode.className = `map-marker map-marker-${markerData.kind ?? 'default'}`;
        markerNode.style.backgroundImage = `url(${markerAsset(markerData.kind)})`;
        markerNode.title = markerData.name;
        markerNode.setAttribute('aria-label', markerData.name);

        const markerLabel = document.createElement('span');
        markerLabel.className = 'map-marker-label';
        markerLabel.textContent = markerData.name;
        markerNode.appendChild(markerLabel);

        const marker = new maplibregl.Marker({
          element: markerNode,
          anchor: 'bottom',
          offset: markerOffset(markerData, markers)
        })
          .setLngLat([markerData.lng, markerData.lat])
          .addTo(map);
        markersRef.current.push(marker);
      }

      const routeCoordinates = mapData.route?.geometry?.coordinates ?? [];
      const routeBounds = boundsFromCoordinates(routeCoordinates);
      const markerBounds = boundsFromMarkers(markers);
      const combinedBounds = expandBoundsWith(routeBounds, markerBounds);

      if (combinedBounds) {
        map.fitBounds(combinedBounds, {
          padding: { top: 90, right: 72, bottom: 90, left: 72 },
          maxZoom: mapData.zoom || 16,
          pitch: DEFAULT_PITCH,
          bearing: DEFAULT_BEARING,
          duration: 1400,
          essential: true
        });
      } else if (mapData.center) {
        map.flyTo({
          center: mapData.center,
          zoom: mapData.zoom || 15,
          pitch: DEFAULT_PITCH,
          bearing: DEFAULT_BEARING,
          essential: true
        });
      }
    };

    if (map.loaded()) {
      updateMap();
    } else {
      map.once('load', updateMap);
    }
  }, [mapData]);

  return (
    <section className="panel map-panel">
      <div className="map-caption">
        <div>
          <p className="eyebrow">Live Map</p>
          <h2>Route, comfort stops, and hazards</h2>
        </div>
      </div>
      <div className="map-shell" ref={containerRef} />
    </section>
  );
}
