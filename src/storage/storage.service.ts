import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class StorageService {
  private readonly s3Client: S3Client;
  private readonly bucketName: string;

  constructor(private readonly configService: ConfigService) {
    this.bucketName =
      this.configService.get<string>('S3_BUCKET_NAME') || 'contracts';

    this.s3Client = new S3Client({
      region: this.configService.get<string>('S3_REGION') || 'us-east-1',
      endpoint:
        this.configService.get<string>('S3_ENDPOINT') ||
        'http://localhost:9000',
      forcePathStyle:
        this.configService.get<string>('S3_FORCE_PATH_STYLE') !== 'false',
      credentials: {
        accessKeyId:
          this.configService.get<string>('S3_ACCESS_KEY_ID') || 'minioadmin',
        secretAccessKey:
          this.configService.get<string>('S3_SECRET_ACCESS_KEY') ||
          'minioadmin',
      },
    });
  }

  /**
   * Generates a pre-signed PUT URL for uploading a contract/document directly to S3/MinIO.
   */
  async getPresignedUploadUrl(
    fileKey: string,
    mimeType: string,
    expiresInSeconds = 900,
  ): Promise<{ uploadUrl: string; fileKey: string; expiresIn: number }> {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: fileKey,
      ContentType: mimeType,
    });

    const uploadUrl = await getSignedUrl(this.s3Client, command, {
      expiresIn: expiresInSeconds,
    });

    return {
      uploadUrl,
      fileKey,
      expiresIn: expiresInSeconds,
    };
  }

  /**
   * Generates a pre-signed GET URL valid for 5 minutes (300 seconds) by default.
   */
  async getPresignedDownloadUrl(
    fileKey: string,
    expiresInSeconds = 300,
  ): Promise<{ downloadUrl: string; expiresIn: number }> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: fileKey,
    });

    const downloadUrl = await getSignedUrl(this.s3Client, command, {
      expiresIn: expiresInSeconds,
    });

    return {
      downloadUrl,
      expiresIn: expiresInSeconds,
    };
  }

  /**
   * Deletes an object from S3/MinIO bucket.
   */
  async deleteObject(fileKey: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: fileKey,
    });
    await this.s3Client.send(command);
  }
}
