import { Router } from 'express';
import { buildRoutePlanWithAgent } from '../services/agentic.js';

const router = Router();

router.post('/', async (req, res) => {
  try {
    const plan = await buildRoutePlanWithAgent(req.body ?? {});
    res.json(plan);
  } catch (error) {
    console.error('plan error', error);
    res.status(500).json({
      error: 'Failed to build route plan.',
      detail: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;
