import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Express } from 'express';

let appPromise: Promise<Express> | null = null;

function getApp(): Promise<Express> {
  if (!appPromise) {
    process.env.EVENTS_SERVERLESS = '1';
    appPromise = import('../server.ts')
      .then((mod) => mod.createExpressApp({ serverless: true }))
      .catch((err) => {
        appPromise = null;
        throw err;
      });
  }
  return appPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const app = await getApp();
    await new Promise<void>((resolve, reject) => {
      const done = () => resolve();
      res.once('finish', done);
      res.once('close', done);
      res.once('error', reject);
      try {
        app(
          req as unknown as Parameters<Express>[0],
          res as unknown as Parameters<Express>[1]
        );
      } catch (invokeErr) {
        reject(invokeErr);
      }
    });
  } catch (err) {
    appPromise = null;
    if (!res.headersSent) {
      const message =
        err instanceof Error && err.message.trim()
          ? err.message
          : 'Serverless API handler failed.';
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ error: message }));
    } else if (!res.writableEnded) {
      res.end();
    }
  }
}
