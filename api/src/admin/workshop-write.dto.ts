import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  Validate,
  ValidateIf,
  ValidatorConstraint,
  isISO8601,
} from 'class-validator';
import type { ValidatorConstraintInterface } from 'class-validator';

@ValidatorConstraint({ name: 'explicitTimestamp', async: false })
class ExplicitTimestamp implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return (
      typeof value === 'string' &&
      /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
        value,
      ) &&
      isISO8601(value, { strict: true, strictSeparator: true }) &&
      Number.isFinite(Date.parse(value))
    );
  }
  defaultMessage(): string {
    return 'startsAt must be a valid ISO timestamp with Z or an explicit UTC offset';
  }
}
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateWorkshopDto {
  @ApiProperty({
    example: 'PostgreSQL transactions',
    minLength: 1,
    maxLength: 200,
  })
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  @Matches(/\S/u)
  title: string;

  @ApiProperty({
    example: 20,
    minimum: 1,
    maximum: 2147483647,
    type: 'integer',
  })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  capacity: number;

  @ApiProperty({
    example: '2030-05-01T15:30:00+05:30',
    format: 'date-time',
    description:
      'Future start instant; Z or an explicit UTC offset is required.',
  })
  @Validate(ExplicitTimestamp)
  startsAt: string;

  @ApiPropertyOptional({ default: true })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  registrationOpen?: boolean;
}

// Explicit update rules avoid inheriting creation defaults or accepting null via IsOptional.
export class UpdateWorkshopDto {
  @ApiPropertyOptional({
    minLength: 1,
    maxLength: 200,
    example: 'Updated workshop title',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  @Matches(/\S/u)
  title?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 2147483647,
    type: 'integer',
    example: 25,
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  capacity?: number;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2030-06-01T10:00:00Z',
    description:
      'Rescheduling requires a future instant. The existing instant may be retained.',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Validate(ExplicitTimestamp)
  startsAt?: string;

  @ApiPropertyOptional({
    description: 'Opening requires the resulting workshop start to be future.',
    example: false,
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  registrationOpen?: boolean;
}
