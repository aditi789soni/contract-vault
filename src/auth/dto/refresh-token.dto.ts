import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    description: 'Valid JWT Refresh Token to rotate',
  })
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}
