import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class RegisterTenantDto {
  @ApiProperty({
    example: 'Acme Corporation',
    description: 'Unique organization / tenant name',
  })
  @IsString()
  @IsNotEmpty()
  tenantName: string;

  @ApiPropertyOptional({
    example: 'acme.com',
    description: 'Optional corporate domain for the tenant',
  })
  @IsOptional()
  @IsString()
  domain?: string;

  @ApiProperty({
    example: 'admin@acme.com',
    description: 'Initial Admin user email address',
  })
  @IsEmail()
  @IsNotEmpty()
  adminEmail: string;

  @ApiProperty({
    example: 'StrongP@ssw0rd123!',
    description: 'Initial Admin password (minimum 8 characters)',
  })
  @IsString()
  @MinLength(8)
  adminPassword: string;
}
