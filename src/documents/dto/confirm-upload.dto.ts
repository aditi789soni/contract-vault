import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';

export class ConfirmUploadDto {
  @ApiProperty({
    example: 'Master Service Agreement 2026',
    description: 'Human-readable title of the contract or document',
  })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({
    example: 'tenants/11111111-2222-3333-4444-555555555555/doc-uuid-msa.pdf',
    description: 'S3/MinIO object key returned from the upload-url endpoint',
  })
  @IsString()
  @IsNotEmpty()
  fileKey: string;

  @ApiProperty({
    example: 'application/pdf',
    description: 'MIME type of the uploaded document',
  })
  @IsString()
  @IsNotEmpty()
  mimeType: string;

  @ApiProperty({
    example: 245760,
    description: 'File size in bytes',
  })
  @IsInt()
  @IsPositive()
  sizeBytes: number;

  @ApiPropertyOptional({
    example: { counterparty: 'Globex Corp', effectiveDate: '2026-11-01' },
    description: 'Optional arbitrary contract metadata JSON',
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
