import { Controller, Get, UseGuards, UseInterceptors } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  ActiveUserPayload,
} from '../common/decorators/current-user.decorator';
import { TenantRlsInterceptor } from '../common/interceptors/tenant-rls.interceptor';

@ApiTags('Audit Logs')
@ApiBearerAuth()
@Controller('api/v1/audit-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(TenantRlsInterceptor)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @Roles('Admin')
  @ApiOperation({
    summary: 'List tamper-proof audit logs for the current tenant (Admin only)',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns immutable audit log records for the active tenant.',
  })
  async findAll(@CurrentUser() user: ActiveUserPayload) {
    return this.auditService.findAllForTenant(user.tenantId);
  }
}
