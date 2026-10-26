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
import { RolesGuard } from './roles.guard.js';
import { AuthRefreshTokenEntity } from './auth-refresh-token.entity.js';
import { RefreshTokenService } from './refresh-token.service.js';
import { RefreshCookieService } from './refresh-cookie.service.js';
import { LoginOriginGuard } from './login-origin.guard.js';
import { SessionCredentialService } from './session-credential.service.js';
import { SessionCredentialFilter } from './session-credential.filter.js';
import {
  AccessTokenService,
  validateJwtSecret,
} from './access-token.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      AuthSessionEntity,
      AuthRefreshTokenEntity,
    ]),
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
    RolesGuard,
    RefreshTokenService,
    RefreshCookieService,
    LoginOriginGuard,
    SessionCredentialService,
    SessionCredentialFilter,
  ],
  // Route guards are instantiated in the consuming module; export their dependencies too.
  exports: [
    JwtAuthGuard,
    RolesGuard,
    AccessTokenService,
    SessionAuthenticationService,
  ],
})
export class AuthModule {}
