import { test, expect } from '@playwright/test';

const baselinePlan = {
  sessionId: 'session-demo',
  origin: { id: 'origin', name: 'Tiong Bahru MRT', category: 'station', lat: 1.2869, lng: 103.8272 },
  destination: { id: 'dest', name: 'Singapore General Hospital', category: 'hospital', lat: 1.2787, lng: 103.8331 },
  comfortStop: null,
  bypassStop: null,
  summary: {
    etaMinutes: 24,
    distanceMeters: 1750,
    strategy: 'baseline',
    strategyLabel: 'baseline route selected',
    narration: 'Safe route ready for walker. 24 minutes over 1.75 km.',
    agentMode: 'tool-calling'
  },
  mapData: {
    selectedRouteId: 'route-1',
    routeChoices: [
      { id: 'route-1', durationMinutes: 24, distanceMeters: 1750, blockedByHazard: false, selected: true },
      { id: 'route-2', durationMinutes: 22, distanceMeters: 1610, blockedByHazard: true, selected: false }
    ],
    route: {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [103.8272, 1.2869],
          [103.8302, 1.2831],
          [103.8331, 1.2787]
        ]
      }
    }
  },
  trace: [
    { type: 'decision', title: 'agent_mode', detail: 'Using gpt-4.1-mini with Responses API tool calling.' },
    { type: 'decision', title: 'agent_final', detail: 'Selected the baseline route.', data: { strategy: 'baseline' } }
  ]
};

const obstaclePlan = {
  ...baselinePlan,
  summary: {
    ...baselinePlan.summary,
    strategy: 'safe-alternative',
    strategyLabel: 'safe alternative selected over the fastest blocked route',
    narration: 'Agent-planned safe route for walker. 24 minutes over 1.75 km.'
  },
  trace: [
    ...baselinePlan.trace,
    { type: 'decision', title: 'guardrail_override', detail: 'Rejected a bad detour and kept the safe route.' },
    { type: 'decision', title: 'agent_final', detail: 'Selected the safe alternative route.', data: { strategy: 'safe-alternative' } }
  ]
};

const obstacleResult = {
  sessionId: 'session-demo',
  obstacle: {
    id: 'hazard-1',
    analysis: {
      obstacle_type: 'construction_barrier',
      analysis_mode: 'vision',
      severity: 'high',
      recommended_action: 'reroute',
      confidence: 0.94,
      short_reason: 'Construction barriers leave too little safe walking width for an elderly pedestrian.'
    }
  },
  updatedPlan: obstaclePlan
};

test('demo frontend supports baseline and obstacle flows', async ({ page }) => {
  await page.route('**/api/plan', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(baselinePlan)
    });
  });

  await page.route('**/api/obstacle', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(obstacleResult)
    });
  });

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Silver Route Agent' })).toBeVisible();
  await expect(page.getByRole('button', { name: '1. Baseline' })).toBeVisible();
  await expect(page.getByRole('button', { name: '3. Obstacle ahead' })).toBeVisible();

  await page.getByRole('button', { name: '1. Baseline' }).click();
  await expect(page.getByText('Decision style')).toBeVisible();
  await expect(page.getByText('Route choice')).toBeVisible();
  await expect(page.getByText('AI agent with live tools')).toBeVisible();
  await expect(page.getByText('No extra stop was needed for the selected route.')).toBeVisible();

  await page.getByRole('button', { name: '3. Obstacle ahead' }).click();
  await expect(page.getByText('construction barrier')).toBeVisible();
  await expect(page.getByText('Vision analysis succeeded')).toBeVisible();
  await expect(page.getByText('decision: guardrail_override')).toBeVisible();
});
