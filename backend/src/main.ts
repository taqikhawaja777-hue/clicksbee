import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Screenshot/recording-adjacent endpoints (screenshots/capture,
  // recordings historically) send base64-encoded image data in the JSON
  // body, which routinely exceeds Express's default 100kb body-parser
  // limit - that mismatch is what's been causing
  // "PayloadTooLargeError: request entity too large" / 500s on
  // /api/v1/screenshots/capture.
  app.useBodyParser('json', { limit: '15mb' });
  app.useBodyParser('urlencoded', { limit: '15mb', extended: true });

  app.use(helmet());
  const frontendOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    // A packaged Electron app loads its renderer via loadFile() (file://),
    // not a real http(s) origin - Chromium sends no Origin header at all
    // for those requests (unlike the Vite dev server's http://localhost:5173,
    // which does and still needs to match frontendOrigins below). A plain
    // origin array rejects a request with no Origin header outright, which
    // would mean the packaged Windows app could never reach this backend at
    // all - so first allow the "no Origin header" case explicitly, then
    // fall back to the normal allowlist for anything that does send one.
    origin: (origin, callback) => {
      if (!origin || frontendOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'), false);
      }
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());

  const config = new DocumentBuilder()
    .setTitle('StitchMonitor API')
    .setDescription('The StitchMonitor Backend API description')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}/api/v1`);
}
bootstrap();
