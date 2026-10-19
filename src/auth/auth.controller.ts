import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterTenantDto } from './dto/register-tenant.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

@ApiTags('Authentication')
@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register-tenant')
  @ApiOperation({
    summary: 'Register a new Enterprise Tenant and initial Admin user',
  })
  @ApiResponse({
    status: 201,
    description:
      'Tenant and initial Admin user created with Access and Refresh tokens.',
  })
  async registerTenant(@Body() dto: RegisterTenantDto) {
    return this.authService.registerTenant(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Authenticate user and issue Access + Refresh tokens',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns JWT Access and Refresh tokens.',
  })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate Refresh Token and issue a new Access + Refresh token pair',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns rotated JWT Access and Refresh tokens.',
  })
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshTokens(dto);
  }
}
