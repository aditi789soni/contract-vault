import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString } from 'class-validator';

export class UpdateDocumentMetadataDto {
  @ApiPropertyOptional({
    example: 'Amended Master Service Agreement 2026',
    description: 'Updated document title',
  })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({
    example: { status: 'Executed', renewalDate: '2027-11-01' },
    description: 'Updated contract metadata JSON',
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
