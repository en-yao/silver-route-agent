const fixturePlaces = [
  {
    id: 'place-tbmrt',
    name: 'Tiong Bahru MRT Station',
    formatted_address: '300 Tiong Bahru Road, Singapore',
    category: 'station',
    location: { latitude: 1.286972, longitude: 103.827183 }
  },
  {
    id: 'place-sgh',
    name: 'Singapore General Hospital',
    formatted_address: 'Outram Road, Singapore',
    category: 'hospital',
    location: { latitude: 1.279432, longitude: 103.835685 }
  },
  {
    id: 'place-sgh-block3',
    name: 'SGH Block 3 Entrance',
    formatted_address: 'SGH Block 3, Singapore',
    category: 'hospital_entrance',
    location: { latitude: 1.279805, longitude: 103.836213 }
  },
  {
    id: 'place-toilet-outram',
    name: 'Public Toilet - Outram Community Point',
    formatted_address: 'Outram Road, Singapore',
    category: 'public_toilet',
    location: { latitude: 1.28293, longitude: 103.83239 }
  },
  {
    id: 'place-bench-1',
    name: 'Sheltered Bench - Jalan Bukit Merah',
    formatted_address: 'Jalan Bukit Merah, Singapore',
    category: 'bench',
    location: { latitude: 1.28444, longitude: 103.82963 }
  },
  {
    id: 'place-clinic-1',
    name: 'Bukit Merah Clinic',
    formatted_address: 'Bukit Merah, Singapore',
    category: 'clinic',
    location: { latitude: 1.28389, longitude: 103.83361 }
  },
  {
    id: 'place-cafe-1',
    name: 'Calm Corner Cafe',
    formatted_address: 'Eu Chin Street, Singapore',
    category: 'cafe',
    location: { latitude: 1.28185, longitude: 103.83473 }
  },
  {
    id: 'place-shelter-1',
    name: 'Covered Walkway Rest Point',
    formatted_address: 'Outram Park, Singapore',
    category: 'shelter',
    location: { latitude: 1.28327, longitude: 103.83128 }
  }
];

const fixtureRoutes = {
  direct: [
    [103.827183, 1.286972],
    [103.828226, 1.286102],
    [103.829989, 1.285301],
    [103.831277, 1.284587],
    [103.832694, 1.283512],
    [103.834425, 1.28195],
    [103.835685, 1.279432]
  ],
  scenic: [
    [103.827183, 1.286972],
    [103.826777, 1.285748],
    [103.828019, 1.28424],
    [103.829511, 1.283387],
    [103.831257, 1.282986],
    [103.833137, 1.281772],
    [103.835685, 1.279432]
  ],
  restStop: [
    [103.827183, 1.286972],
    [103.828374, 1.286026],
    [103.829631, 1.284999],
    [103.83128, 1.28327],
    [103.83289, 1.28251],
    [103.8341, 1.28145],
    [103.835685, 1.279432]
  ]
};

export function findFixturePlace(query = '') {
  const normalized = query.toLowerCase();
  return (
    fixturePlaces.find((place) => place.name.toLowerCase().includes(normalized)) ??
    fixturePlaces.find((place) => normalized.includes('hospital') && place.id === 'place-sgh-block3') ??
    fixturePlaces[0]
  );
}

export function searchFixturePlaces(keyword = '') {
  const normalized = keyword.toLowerCase();
  return fixturePlaces.filter((place) => {
    return (
      place.name.toLowerCase().includes(normalized) ||
      place.category.toLowerCase().includes(normalized) ||
      place.formatted_address.toLowerCase().includes(normalized)
    );
  });
}

export function getFixtureNearby(keyword = '') {
  const normalized = keyword.toLowerCase();
  if (!normalized) {
    return fixturePlaces.slice(2);
  }
  const exact = fixturePlaces.filter((place) => place.category.includes(normalized));
  return exact.length > 0 ? exact : searchFixturePlaces(normalized);
}

export function getFixtureDirections(withWaypoint = false) {
  const primary = withWaypoint ? fixtureRoutes.restStop : fixtureRoutes.direct;
  const alternative = fixtureRoutes.scenic;
  return [
    {
      id: withWaypoint ? 'fixture-rest' : 'fixture-direct',
      distanceMeters: withWaypoint ? 1180 : 960,
      durationSeconds: withWaypoint ? 1320 : 1020,
      trafficLights: withWaypoint ? 3 : 4,
      geometry: primary
    },
    {
      id: 'fixture-scenic',
      distanceMeters: 1090,
      durationSeconds: 1160,
      trafficLights: 2,
      geometry: alternative
    }
  ];
}
