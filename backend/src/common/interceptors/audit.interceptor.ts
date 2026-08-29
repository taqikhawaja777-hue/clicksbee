import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Reflector } from '@nestjs/core';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly auditLogsService: AuditLogsService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const action = this.reflector.get<string>('auditAction', context.getHandler());
    const entityType = this.reflector.get<string>('auditEntity', context.getClass());

    return next.handle().pipe(
      tap(() => {
        if (action && entityType && request.user) {
          const { user, ip, headers } = request;
          this.auditLogsService.logAction(
            user.organizationId,
            user.id,
            action,
            entityType,
            request.params.id,
            request.body,
            ip,
            headers['user-agent'],
          ).catch((e) => console.error('Audit Log Error', e));
        }
      }),
    );
  }
}
