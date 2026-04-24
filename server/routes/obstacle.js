import { Router } from 'express';
import { analyzeObstacleAndMaybeReplanWithAgent } from '../services/agentic.js';

const router = Router();

router.post('/', async (req, res) => {
  try {
    const result = await analyzeObstacleAndMaybeReplanWithAgent(req.body ?? {});
    res.json(result);
  } catch (error) {
    console.error('obstacle error', error);
    res.status(500).json({
      error: 'Failed to analyze obstacle.',
      detail: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;
