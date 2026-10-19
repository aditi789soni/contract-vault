import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RequestUploadUrlDto {
  @ApiProperty({
    example: 'master-service-agreement-2026.pdf',
    description: 'Original file name of the contract/document',
  })
  @IsString()
  @IsNotEmpty()
  fileName: string;

  @ApiProperty({
    example: 'application/pdf',
    description: 'MIME type of the document to upload',
  })
  @IsString()
  @IsNotEmpty()
  mimeType: string;
}
