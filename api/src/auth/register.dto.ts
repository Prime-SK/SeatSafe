import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'Sample learner', minLength: 1, maxLength: 100 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 100)
  @Matches(/\S/u, { message: 'displayName must not be blank' })
  displayName: string;

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
    minLength: 15,
    maxLength: 128,
    writeOnly: true,
    description: '15–128 Unicode characters. Preserved exactly.',
  })
  @IsString()
  @Length(15, 128)
  @Matches(/\S/u, { message: 'password must not be entirely whitespace' })
  password: string;
}
