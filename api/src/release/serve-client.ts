import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extname, join } from 'node:path';
import { static as serveStatic } from 'express';
import type { INestApplication } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

export const clientDirectory = fileURLToPath(
  new URL('../client/', import.meta.url),
);
export function installClient(
  app: INestApplication,
  directory = clientDirectory,
): void {
  if (!existsSync(join(directory, 'index.html')))
    throw Error(
      'Production frontend is missing. Run build:release before start:release.',
    );
  const assets = serveStatic(directory, {
    index: false,
    redirect: false,
    dotfiles: 'deny',
    setHeaders(response, path) {
      response.setHeader(
        'Cache-Control',
        path.endsWith('primeui-license.local.json')
          ? 'no-store'
          : /-[A-Za-z0-9_-]{8,}\.(?:js|css)$/.test(path)
            ? 'public, max-age=31536000, immutable'
            : 'no-cache',
      );
    },
  });
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (
      /^\/(?:api|swagger|swagger-json)(?:\/|$)/.test(request.path) ||
      request.path.split('/').some((part) => part.startsWith('.'))
    )
      return next();
    assets(request, response, (error?: unknown) => {
      if (error) return next(error);
      if (
        !['GET', 'HEAD'].includes(request.method) ||
        extname(request.path) ||
        !request.headers.accept?.toLowerCase().includes('text/html')
      )
        return next();
      response.setHeader('Cache-Control', 'no-cache');
      response.sendFile(join(directory, 'index.html'));
    });
  });
}
