import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { RegistrationError } from './auth/registration-error.js';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

// Startup and HTTP tests use the same route and documentation configuration.
export function configureApp(app: INestApplication): void {
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
      'Workshop browsing, registration, JWT login, rotating refresh cookies, logout and protected current-account lookup. Seat reservations arrive in later phases.',
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
