import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

// Startup and HTTP tests use the same route and documentation configuration.
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');

  const config = new DocumentBuilder()
    .setTitle('SeatSafe API')
    .setDescription(
      'Workshop browsing and, in later phases, seat reservations.',
    )
    .setVersion('0.1.0')
    .build();

  const documentFactory = () => SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('swagger', app, documentFactory, {
    useGlobalPrefix: false,
    jsonDocumentUrl: 'swagger-json',
  });
}
