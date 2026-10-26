import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { UserEntity } from '../users/user.entity.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PasswordHasher } from './password-hasher.js';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { LoginService } from './login.service.js';
import { AuthSessionEntity } from './auth-session.entity.js';
import { SessionAuthenticationService } from './session-authentication.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import {
  AccessTokenService,
  validateJwtSecret,
} from './access-token.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, AuthSessionEntity]),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 5 }]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: validateJwtSecret(config.get<unknown>('JWT_SECRET')),
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordHasher,
    LoginService,
    AccessTokenService,
    SessionAuthenticationService,
    JwtAuthGuard,
  ],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
