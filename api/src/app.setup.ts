import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { RegistrationError } from './auth/registration-error.js';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json } from 'express';
import type { Request, Response, NextFunction } from 'express';

// Startup and HTTP tests use the same route and documentation configuration.
export function configureApp(app: INestApplication): void {
  // Parse JSON primitives only on this route so its empty-body contract can reject them safely.
  // All existing routes retain Express's default strict JSON parser.
  const bookingJson = json({ strict: false });
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (
      request.method !== 'POST' ||
      !/^\/api\/workshops\/[^/]+\/bookings\/?$/.test(request.path)
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
      'Workshop browsing and administration, transaction-safe seat reservations, administrator booking lists, registration, JWT login, rotating refresh cookies, logout and protected account lookup. Idempotency and cancellation arrive in later phases.',
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
