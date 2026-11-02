import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { RegistrationError } from './auth/registration-error.js';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { LabService } from './reliability/lab.service.js';
import { ConfigService } from '@nestjs/config';
import { installClient } from './release/serve-client.js';

// Startup and HTTP tests use the same route and documentation configuration.
export function configureApp(app: INestApplication): void {
  const settings = app.get(ConfigService);
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.disable('x-powered-by');
  expressApp.set('trust proxy', settings.get<number>('TRUST_PROXY_HOPS') ?? 0);
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  if (settings.get<string>('NODE_ENV') === 'production') installClient(app);
  const labJson = json({ strict: false });
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (!request.path.startsWith('/api/admin/reliability/')) return next();
    response.setHeader('Cache-Control', 'no-store');
    if (!request.path.startsWith('/api/admin/reliability/runs')) return next();
    if (
      !app.get(LabService).enabled() ||
      !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(
        request.socket.remoteAddress ?? '',
      )
    ) {
      response.status(404).json({
        statusCode: 404,
        code: 'LAB_UNAVAILABLE',
        message: 'Reliability lab is unavailable',
      });
      return;
    }
    if (request.method !== 'POST') return next();
    const reject = () =>
      response.status(400).json({
        statusCode: 400,
        code: 'VALIDATION_FAILED',
        message: 'Invalid lab request',
        fieldErrors: {
          body: ['Supply a run UUID and supported scenario only'],
        },
      });
    if (
      (Number(request.headers['content-length'] ?? 0) > 0 ||
        request.headers['transfer-encoding'] !== undefined) &&
      !request.is('application/json')
    ) {
      reject();
      return;
    }
    labJson(request, response, (error?: unknown) => {
      if (error) reject();
      else next();
    });
  });
  const userStatusJson = json({ strict: false });
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (
      request.method !== 'PATCH' ||
      !/^\/api\/admin\/users\/[^/]+\/status\/?$/.test(request.path)
    )
      return next();
    response.setHeader('Cache-Control', 'no-store');
    const reject = () =>
      response.status(400).json({
        statusCode: 400,
        code: 'VALIDATION_FAILED',
        message: 'Invalid user administration request',
        fieldErrors: {
          body: ['Supply an object with one boolean isEnabled field'],
        },
      });
    const hasBody =
      Number(request.headers['content-length'] ?? 0) > 0 ||
      request.headers['transfer-encoding'] !== undefined;
    if (hasBody && !request.is('application/json')) {
      reject();
      return;
    }
    userStatusJson(request, response, (error?: unknown) => {
      if (error) reject();
      else next();
    });
  });
  // Parse JSON primitives only on booking mutations so their empty-body contracts reject them safely.
  // All existing routes retain Express's default strict JSON parser.
  const bookingJson = json({ strict: false });
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (
      request.method !== 'POST' ||
      !/^\/api\/(?:workshops\/[^/]+\/bookings|bookings\/[^/]+\/cancel)\/?$/.test(
        request.path,
      )
    )
      return next();
    response.setHeader('Cache-Control', 'no-store');
    const hasBody =
      Number(request.headers['content-length'] ?? 0) > 0 ||
      request.headers['transfer-encoding'] !== undefined;
    if (hasBody && !request.is('application/json')) {
      response.status(400).json({
        statusCode: 400,
        code: 'VALIDATION_FAILED',
        message: 'Invalid booking request',
        fieldErrors: { body: ['Supply no body or an empty JSON object'] },
      });
      return;
    }
    bookingJson(request, response, (error?: unknown) => {
      if (error) {
        response.status(400).json({
          statusCode: 400,
          code: 'VALIDATION_FAILED',
          message: 'Invalid booking request',
          fieldErrors: { body: ['Supply no body or an empty object'] },
        });
        return;
      }
      next();
    });
  });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: false },
      validationError: { target: false, value: false },
      exceptionFactory: (errors) =>
        new RegistrationError(
          400,
          'VALIDATION_FAILED',
          'Invalid registration data',
          Object.fromEntries(
            errors.map((error) => [
              error.property,
              Object.values(error.constraints ?? {}),
            ]),
          ),
        ),
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('SeatSafe API')
    .setDescription(
      'Workshop browsing and administration, Angular reservations and cancellation, account-scoped Idempotency-Key replay, private booking history, administrator booking lists and user search/status management, registration, JWT login, rotating refresh cookies, logout and protected account lookup.',
    )
    .setVersion('0.1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token',
    )
    .addCookieAuth(
      'seatsafe_refresh',
      {
        type: 'apiKey',
        in: 'cookie',
        description:
          'HttpOnly credential set automatically by login/refresh. Browsers cannot set a Cookie header through Swagger Authorize.',
      },
      'refresh-cookie',
    )
    .build();

  const documentFactory = () => SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('swagger', app, documentFactory, {
    useGlobalPrefix: false,
    jsonDocumentUrl: 'swagger-json',
    swaggerOptions: { persistAuthorization: false },
  });
}
