import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterTenantDto } from './dto/register-tenant.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ActiveUserPayload } from '../common/decorators/current-user.decorator';

@Injectable()
export class AuthService {
  private readonly accessSecret: string;
  private readonly accessExpiration: string;
  private readonly refreshSecret: string;
  private readonly refreshExpiration: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.accessSecret =
      this.configService.get<string>('JWT_ACCESS_SECRET') ||
      'super-secret-enterprise-access-key-change-in-prod';
    this.accessExpiration =
      this.configService.get<string>('JWT_ACCESS_EXPIRATION') || '15m';
    this.refreshSecret =
      this.configService.get<string>('JWT_REFRESH_SECRET') ||
      'super-secret-enterprise-refresh-key-change-in-prod';
    this.refreshExpiration =
      this.configService.get<string>('JWT_REFRESH_EXPIRATION') || '7d';
  }

  /**
   * Registers a new Tenant and its initial Admin user inside an RLS-scoped transaction.
   */
  async registerTenant(dto: RegisterTenantDto) {
    const newTenantId = uuidv4();
    const passwordHash = await bcrypt.hash(dto.adminPassword, 12);

    try {
      const result = await this.prisma.executeWithTenantRls(async (tx) => {
        const tenant = await tx.tenant.create({
          data: {
            id: newTenantId,
            name: dto.tenantName,
            domain: dto.domain ?? null,
          },
        });

        const adminUser = await tx.user.create({
          data: {
            tenantId: tenant.id,
            email: dto.adminEmail.toLowerCase(),
            passwordHash,
            role: 'Admin',
          },
        });

        const tokens = await this.generateTokenPair({
          sub: adminUser.id,
          email: adminUser.email,
          tenantId: tenant.id,
          role: adminUser.role,
        });

        const refreshTokenHash = await bcrypt.hash(tokens.refreshToken, 10);
        await tx.user.update({
          where: { id: adminUser.id },
          data: { refreshTokenHash },
        });

        return {
          tenant: {
            id: tenant.id,
            name: tenant.name,
            domain: tenant.domain,
          },
          user: {
            id: adminUser.id,
            email: adminUser.email,
            role: adminUser.role,
            tenantId: tenant.id,
          },
          ...tokens,
        };
      }, newTenantId);

      return result;
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new ConflictException(
          'Tenant name, domain, or admin email is already registered.',
        );
      }
      throw error;
    }
  }

  /**
   * Authenticates a user and issues a fresh Access + Refresh token pair.
   */
  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isPasswordValid = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const tokens = await this.generateTokenPair({
      sub: user.id,
      email: user.email,
      tenantId: user.tenantId,
      role: user.role,
    });

    const refreshTokenHash = await bcrypt.hash(tokens.refreshToken, 10);

    await this.prisma.executeWithTenantRls(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { refreshTokenHash },
      });
    }, user.tenantId);

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
      },
      ...tokens,
    };
  }

  /**
   * Rotates a valid Refresh Token, invalidating the previous token hash.
   */
  async refreshTokens(dto: RefreshTokenDto) {
    let payload: ActiveUserPayload;
    try {
      payload = await this.jwtService.verifyAsync<ActiveUserPayload>(
        dto.refreshToken,
        {
          secret: this.refreshSecret,
        },
      );
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    return this.prisma.executeWithTenantRls(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user || !user.refreshTokenHash) {
        throw new UnauthorizedException('Access denied: session not found');
      }

      const isRefreshTokenMatching = await bcrypt.compare(
        dto.refreshToken,
        user.refreshTokenHash,
      );

      if (!isRefreshTokenMatching) {
        // Potential token reuse detected: revoke stored token hash
        await tx.user.update({
          where: { id: user.id },
          data: { refreshTokenHash: null },
        });
        throw new UnauthorizedException(
          'Refresh token has already been rotated or revoked',
        );
      }

      const tokens = await this.generateTokenPair({
        sub: user.id,
        email: user.email,
        tenantId: user.tenantId,
        role: user.role,
      });

      const newRefreshTokenHash = await bcrypt.hash(tokens.refreshToken, 10);
      await tx.user.update({
        where: { id: user.id },
        data: { refreshTokenHash: newRefreshTokenHash },
      });

      return tokens;
    }, payload.tenantId);
  }

  private async generateTokenPair(payload: ActiveUserPayload): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    const jti = uuidv4();
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { ...payload, jti },
        {
          secret: this.accessSecret,
          expiresIn: this.accessExpiration as any,
        },
      ),
      this.jwtService.signAsync(
        { ...payload, jti: uuidv4() },
        {
          secret: this.refreshSecret,
          expiresIn: this.refreshExpiration as any,
        },
      ),
    ]);

    return { accessToken, refreshToken };
  }
}
