import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { can, categoryOf, CATEGORY_LABELS, Permission } from './access.util';

export const PERMISSIONS_KEY = 'requiredPermissions';

/**
 * Route needs ANY of the listed permissions (see access.util.ts). Use with
 * @UseGuards(JwtAuthGuard, PermissionsGuard) - the user comes from the JWT,
 * re-read from the database on every request (JwtStrategy), so a category
 * change by Admin applies immediately.
 */
export const RequirePermission = (...permissions: Permission[]) => SetMetadata(PERMISSIONS_KEY, permissions);

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest().user;
    if (!user) throw new ForbiddenException('Sign in required');
    if (required.some((p) => can(user, p))) return true;
    throw new ForbiddenException(`Your role (${CATEGORY_LABELS[categoryOf(user)]}) does not have access to this`);
  }
}
