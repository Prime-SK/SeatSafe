import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({
    example: 'learner@example.test',
    format: 'email',
    maxLength: 254,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({
    example: 'a sufficiently long password',
    minLength: 1,
    maxLength: 128,
    writeOnly: true,
    description:
      'Preserved exactly; login does not apply registration password policy.',
  })
  @IsString()
  @Length(1, 128)
  password: string;
}
