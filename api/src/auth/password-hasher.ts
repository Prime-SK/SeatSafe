import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

@Injectable()
export class PasswordHasher {
  // Public dummy credential: verification performs the same Argon2id work for an absent account.
  static readonly dummyHash =
    '$argon2id$v=19$m=19456,p=1,t=2$Co5wjVmr06DU+mCPA+5Gaw$DHWsDUH/wjvznpyKcnGf59YctHwfmNet2idM/7CsH+I';
  verify(encodedHash: string, password: string): Promise<boolean> {
    return argon2.verify(encodedHash, password);
  }
  hash(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
  }
}
