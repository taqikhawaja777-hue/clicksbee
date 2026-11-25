import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { can, categoryOf } from '../access/access.util';

/**
 * @Roles() checks, decided by the access category (access.util.ts) rather
 * than the raw stored role - an account whose role is ADMIN from an older
 * signup but whose category is now SM/Team Lead/HR gets only that
 * category's access:
 *   @Roles(ADMIN)            -> Admin/Boss only
 *   @Roles(ADMIN, MANAGER)   -> the Manager portal (Admin/Boss, HR)
 *   anything incl. EMPLOYEE  -> any signed-in user
 * (A previous URL-based bypass for /employees and /reports/attendance-analytics was removed.)
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user || !user.role) {
      throw new ForbiddenException('User authentication or role missing');
    }

    if (requiredRoles.includes(Role.EMPLOYEE)) return true;
    const allowed = requiredRoles.includes(Role.MANAGER) ? can(user, 'managerPortal') : categoryOf(user) === 'ADMIN';
    if (!allowed) {
      throw new ForbiddenException(
        `Insufficient privileges: requires one of [${requiredRoles.join(', ')}] roles`,
      );
    }
    return true;
  }
}
