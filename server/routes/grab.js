import { Router } from 'express';
import { getMapStyle, proxyMapAsset } from '../services/grabmaps.js';

const router = Router();

router.get('/style', async (_req, res) => {
  try {
    const style = await getMapStyle();
    res.json(style);
  } catch (error) {
    console.error('style error', error);
    res.status(500).json({
      error: 'Failed to load map style.',
      detail: error instanceof Error ? error.message : String(error)
    });
  }
});

router.get('/proxy/*', async (req, res) => {
  try {
    const targetPath = `/${req.params[0]}${req.url.includes('?') ? `?${req.url.split('?')[1]}` : ''}`;
    const response = await proxyMapAsset(targetPath);

    const contentType = response.headers.get('content-type');
    const cacheControl = response.headers.get('cache-control');
    if (contentType) {
      res.setHeader('content-type', contentType);
    }
    if (cacheControl) {
      res.setHeader('cache-control', cacheControl);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);
  } catch (error) {
    console.error('map proxy error', error);
    res.status(500).json({
      error: 'Failed to load map asset.',
      detail: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;
