import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { RoleType } from '../../common/decorators/roles.decorator';

export class InviteUserDto {
  @ApiProperty({
    example: 'manager@acme.com',
    description: 'Email address of the user to invite into the current tenant',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    enum: ['Viewer', 'Manager', 'Admin'],
    example: 'Manager',
    description: 'RBAC role assigned to the invited user',
  })
  @IsIn(['Viewer', 'Manager', 'Admin'])
  role: RoleType;

  @ApiPropertyOptional({
    example: 'TempPassw0rd123!',
    description: 'Optional initial password (auto-generated if omitted)',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  temporaryPassword?: string;
}
