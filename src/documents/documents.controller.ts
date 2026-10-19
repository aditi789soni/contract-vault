import {
  Body,
  Controller,
  Delete,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { DocumentsService } from './documents.service';
import { RequestUploadUrlDto } from './dto/request-upload-url.dto';
import { ConfirmUploadDto } from './dto/confirm-upload.dto';
import { UpdateDocumentMetadataDto } from './dto/update-document.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  ActiveUserPayload,
} from '../common/decorators/current-user.decorator';
import { TenantRlsInterceptor } from '../common/interceptors/tenant-rls.interceptor';

@ApiTags('Documents')
@ApiBearerAuth()
@Controller('api/v1/documents')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(TenantRlsInterceptor)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post('upload-url')
  @Roles('Admin', 'Manager')
  @ApiOperation({
    summary: 'Generate a pre-signed S3/MinIO PUT URL for uploading a contract',
  })
  @ApiResponse({
    status: 201,
    description: 'Returns a pre-signed PUT URL and tenant-scoped fileKey.',
  })
  async createUploadUrl(
    @CurrentUser() user: ActiveUserPayload,
    @Body() dto: RequestUploadUrlDto,
  ) {
    return this.documentsService.createUploadUrl(user, dto);
  }

  @Post('confirm')
  @Roles('Admin', 'Manager')
  @ApiOperation({
    summary:
      'Confirm completed upload and store document metadata in PostgreSQL',
  })
  @ApiResponse({
    status: 201,
    description: 'Stores document metadata and emits UPLOAD audit log.',
  })
  async confirmUpload(
    @CurrentUser() user: ActiveUserPayload,
    @Body() dto: ConfirmUploadDto,
    @Ip() ip: string,
  ) {
    return this.documentsService.confirmUpload(user, dto, ip);
  }

  @Get()
  @Roles('Admin', 'Manager', 'Viewer')
  @ApiOperation({
    summary: 'List all documents for the active tenant (RLS enforced)',
  })
  async findAll(@CurrentUser() user: ActiveUserPayload) {
    return this.documentsService.findAll(user);
  }

  @Get(':id')
  @Roles('Admin', 'Manager', 'Viewer')
  @ApiOperation({
    summary: 'Get document metadata by ID (RLS enforced, emits VIEW audit log)',
  })
  async findOne(
    @CurrentUser() user: ActiveUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
  ) {
    return this.documentsService.findOne(user, id, ip);
  }

  @Get(':id/download-url')
  @Roles('Admin', 'Manager', 'Viewer')
  @ApiOperation({
    summary:
      'Generate a pre-signed S3/MinIO GET URL valid for 5 minutes (enforces RBAC + Tenant RLS + Audit Log)',
  })
  @ApiResponse({
    status: 200,
    description:
      'Returns a 5-minute pre-signed GET URL and records an immutable DOWNLOAD audit log.',
  })
  async getDownloadUrl(
    @CurrentUser() user: ActiveUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
  ) {
    return this.documentsService.getDownloadUrl(user, id, ip);
  }

  @Patch(':id')
  @Roles('Admin', 'Manager')
  @ApiOperation({
    summary: 'Update document metadata (Manager and Admin only)',
  })
  async updateMetadata(
    @CurrentUser() user: ActiveUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDocumentMetadataDto,
  ) {
    return this.documentsService.updateMetadata(user, id, dto);
  }

  @Delete(':id')
  @Roles('Admin')
  @ApiOperation({
    summary: 'Delete a document (Admin only, emits DELETE audit log)',
  })
  async remove(
    @CurrentUser() user: ActiveUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
  ) {
    return this.documentsService.remove(user, id, ip);
  }
}
