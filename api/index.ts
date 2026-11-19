import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Express } from 'express';

let appPromise: Promise<Express> | null = null;

function getApp(): Promise<Express> {
  if (!appPromise) {
    process.env.EVENTS_SERVERLESS = '1';
    appPromise = import('../server.ts').then((mod) =>
      mod.createExpressApp({ serverless: true })
    );
  }
  return appPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await getApp();
  await new Promise<void>((resolve, reject) => {
    const done = () => resolve();
    res.once('finish', done);
    res.once('close', done);
    res.once('error', reject);
    app(
      req as unknown as Parameters<Express>[0],
      res as unknown as Parameters<Express>[1]
    );
  });
}
