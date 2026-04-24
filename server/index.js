import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import planRouter from './routes/plan.js';
import obstacleRouter from './routes/obstacle.js';
import grabRouter from './routes/grab.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

const app = express();
const port = Number(process.env.PORT || 8787);

app.use(cors());
app.use(express.json({ limit: '12mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    app: 'silver-route-agent',
    hasGrabMapsKey: Boolean(process.env.GRABMAPS_API_KEY),
    hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
    openAIAgentModel: process.env.OPENAI_AGENT_MODEL || 'gpt-4.1-mini'
  });
});

app.use('/api/plan', planRouter);
app.use('/api/obstacle', obstacleRouter);
app.use('/api/grab', grabRouter);

app.use(express.static(distDir, { extensions: ['html'] }));

app.get('*', (req, res, next) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(distDir, 'index.html'), (error) => {
      if (error) {
        next();
      }
    });
    return;
  }
  next();
});

app.listen(port, () => {
  console.log(`Silver Route Agent server listening on http://localhost:${port}`);
});
