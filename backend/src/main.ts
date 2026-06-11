import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { json } from 'express';
import { AppModule } from './app.module';
import { loadConfig } from './config';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const log = new Logger('bootstrap');

  if (!config.anthropicApiKey) {
    log.warn('ANTHROPIC_API_KEY is empty — /chat will fail until it is set in the environment.');
  }
  if (!config.sitePassword) {
    log.warn('SITE_PASSWORD is empty — the password gate fails closed and rejects every /chat.');
  }

  // bodyParser:false so we can set a generous JSON limit (long conversation
  // histories) without double-parsing.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.use(json({ limit: '4mb' }));

  // Behind Render's proxy, trust the first hop so req.ip is the real client
  // (the per-IP rate limit depends on it).
  app.set('trust proxy', 1);

  // The browser talks only to this backend; the password is the gate, so a
  // permissive CORS policy is acceptable and lets the Vite dev server call the API.
  app.enableCors();

  // Serve the built React frontend if present (Step 5 output: web/dist). Until
  // it is built, the API runs headless — the chat endpoint and PDF still work.
  const webDist = join(config.webDir, 'dist');
  if (existsSync(webDist)) {
    app.useStaticAssets(webDist);
    log.log(`Serving built frontend from ${webDist}`);
  } else {
    log.warn(`No built frontend at ${webDist} (Step 5 not built yet) — serving API + /thesis.pdf only.`);
  }

  await app.listen(config.port, '0.0.0.0');
  log.log(`Thesis Companion backend listening on :${config.port} (env=${config.nodeEnv}).`);
}

void bootstrap();
