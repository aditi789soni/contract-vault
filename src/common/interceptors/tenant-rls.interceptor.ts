import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { TenantContext } from '../context/tenant.context';
import { ActiveUserPayload } from '../decorators/current-user.decorator';

@Injectable()
export class TenantRlsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const user: ActiveUserPayload | undefined = request.user;

    const ipAddress =
      (request.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      request.ip ||
      request.socket?.remoteAddress ||
      '127.0.0.1';

    if (user?.tenantId) {
      return new Observable((subscriber) => {
        TenantContext.run(
          {
            tenantId: user.tenantId,
            userId: user.sub,
            role: user.role,
            ipAddress,
          },
          () => {
            next.handle().subscribe(subscriber);
          },
        );
      });
    }

    return next.handle();
  }
}
