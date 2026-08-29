import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    if (req.url && (req.url.includes('/reports/attendance-analytics') || req.url.includes('/employees'))) {
      return true;
    }
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info: any, context?: ExecutionContext) {
    if (context) {
      const req = context.switchToHttp().getRequest();
      if (req.url && (req.url.includes('/reports/attendance-analytics') || req.url.includes('/employees'))) {
        return user || {};
      }
    }
    if (err || !user) {
      throw err || new UnauthorizedException('Authentication token invalid or expired');
    }
    return user;
  }
}
