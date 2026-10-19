import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  const createMockContext = (user?: any): ExecutionContext =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    }) as unknown as ExecutionContext;

  it('should allow access when no roles are required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const context = createMockContext({ role: 'Viewer' });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow access when user has a required role (Admin)', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['Admin']);
    const context = createMockContext({
      sub: 'user-1',
      tenantId: 'tenant-1',
      role: 'Admin',
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should throw ForbiddenException when Viewer attempts an Admin action', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['Admin']);
    const context = createMockContext({
      sub: 'user-2',
      tenantId: 'tenant-1',
      role: 'Viewer',
    });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should throw ForbiddenException when user has no role attached', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(['Manager', 'Admin']);
    const context = createMockContext({});
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
