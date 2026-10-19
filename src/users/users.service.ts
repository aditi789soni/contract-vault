import { ConflictException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { InviteUserDto } from './dto/invite-user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Invites a new user into the active tenant with a specified RBAC role.
   */
  async inviteUser(tenantId: string, dto: InviteUserDto) {
    const rawPassword =
      dto.temporaryPassword || `Temp-${uuidv4().slice(0, 8)}!A1`;
    const passwordHash = await bcrypt.hash(rawPassword, 12);

    try {
      const createdUser = await this.prisma.executeWithTenantRls(async (tx) => {
        return tx.user.create({
          data: {
            tenantId,
            email: dto.email.toLowerCase(),
            passwordHash,
            role: dto.role,
          },
          select: {
            id: true,
            tenantId: true,
            email: true,
            role: true,
            createdAt: true,
          },
        });
      }, tenantId);

      return {
        ...createdUser,
        temporaryPassword: rawPassword,
      };
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new ConflictException(
          'A user with this email already exists in the system.',
        );
      }
      throw error;
    }
  }

  /**
   * Lists all users belonging to the active tenant (enforced via Postgres RLS).
   */
  async findAllInTenant(tenantId: string) {
    return this.prisma.executeWithTenantRls(async (tx) => {
      return tx.user.findMany({
        select: {
          id: true,
          tenantId: true,
          email: true,
          role: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });
    }, tenantId);
  }
}
