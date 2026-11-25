import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Requires a valid login token on every route it guards. (A former bypass
 * that let any URL containing "/employees" or "/reports/attendance-analytics"
 * through without a token - with an empty user - was removed.)
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any) {
    if (err || !user) {
      throw err || new UnauthorizedException('Authentication token invalid or expired');
    }
    return user;
  }
}
