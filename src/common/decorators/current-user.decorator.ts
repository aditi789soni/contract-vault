import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface ActiveUserPayload {
  sub: string;
  email: string;
  tenantId: string;
  role: 'Viewer' | 'Manager' | 'Admin';
}

export const CurrentUser = createParamDecorator(
  (data: keyof ActiveUserPayload | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user: ActiveUserPayload = request.user;
    return data ? user?.[data] : user;
  },
);
