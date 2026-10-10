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
      'Workshop browsing, account registration and JWT login. Protected endpoints, refresh and seat reservations arrive in later phases.',
    )
    .setVersion('0.1.0')
    .build();

  const documentFactory = () => SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('swagger', app, documentFactory, {
    useGlobalPrefix: false,
    jsonDocumentUrl: 'swagger-json',
  });
}
