import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { InviteUserDto } from './dto/invite-user.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  ActiveUserPayload,
} from '../common/decorators/current-user.decorator';
import { TenantRlsInterceptor } from '../common/interceptors/tenant-rls.interceptor';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('api/v1/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(TenantRlsInterceptor)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post('invite')
  @Roles('Admin')
  @ApiOperation({
    summary:
      'Invite a new user to the tenant with a specific RBAC role (Admin only)',
  })
  @ApiResponse({
    status: 201,
    description: 'User invited and provisioned within the current tenant.',
  })
  async inviteUser(
    @CurrentUser() user: ActiveUserPayload,
    @Body() dto: InviteUserDto,
  ) {
    return this.usersService.inviteUser(user.tenantId, dto);
  }

  @Get()
  @Roles('Admin', 'Manager')
  @ApiOperation({
    summary: 'List all users within the current tenant',
  })
  async findAll(@CurrentUser() user: ActiveUserPayload) {
    return this.usersService.findAllInTenant(user.tenantId);
  }
}
