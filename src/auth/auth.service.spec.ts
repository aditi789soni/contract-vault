import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuthService', () => {
  let service: AuthService;
  let prismaService: {
    user: { findUnique: jest.Mock };
    executeWithTenantRls: jest.Mock;
  };
  let jwtService: {
    signAsync: jest.Mock;
    verifyAsync: jest.Mock;
  };

  beforeEach(async () => {
    prismaService = {
      user: {
        findUnique: jest.fn(),
      },
      executeWithTenantRls: jest.fn(),
    };

    jwtService = {
      signAsync: jest
        .fn()
        .mockResolvedValueOnce('mock-access-token')
        .mockResolvedValueOnce('mock-refresh-token'),
      verifyAsync: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prismaService },
        { provide: JwtService, useValue: jwtService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const map: Record<string, string> = {
                JWT_ACCESS_SECRET: 'test-access-secret',
                JWT_ACCESS_EXPIRATION: '15m',
                JWT_REFRESH_SECRET: 'test-refresh-secret',
                JWT_REFRESH_EXPIRATION: '7d',
              };
              return map[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should register a new tenant and initial Admin user', async () => {
    prismaService.executeWithTenantRls.mockImplementation(async (cb, tid) =>
      cb({
        tenant: {
          create: jest.fn().mockResolvedValue({
            id: tid,
            name: 'Acme Corp',
            domain: 'acme.com',
          }),
        },
        user: {
          create: jest.fn().mockResolvedValue({
            id: 'admin-user-1',
            tenantId: tid,
            email: 'admin@acme.com',
            role: 'Admin',
          }),
          update: jest.fn().mockResolvedValue({}),
        },
      }),
    );

    const res = await service.registerTenant({
      tenantName: 'Acme Corp',
      domain: 'acme.com',
      adminEmail: 'admin@acme.com',
      adminPassword: 'Password123!',
    });

    expect(res.tenant.name).toBe('Acme Corp');
    expect(res.user.role).toBe('Admin');
    expect(res.accessToken).toBe('mock-access-token');
    expect(res.refreshToken).toBe('mock-refresh-token');
  });

  it('should throw UnauthorizedException on invalid login password', async () => {
    const hash = await bcrypt.hash('CorrectPassword123!', 10);
    prismaService.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'admin@acme.com',
      passwordHash: hash,
      tenantId: 'tenant-1',
      role: 'Admin',
    });

    await expect(
      service.login({
        email: 'admin@acme.com',
        password: 'WrongPassword!',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
