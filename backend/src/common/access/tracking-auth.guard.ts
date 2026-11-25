import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Legacy mode: app versions up to 1.0.10 send tracking data from the
 * background process without a login token. Until every PC is updated those
 * WRITES are still accepted (only for the userId they name). Set
 * ALLOW_LEGACY_TRACKING=false on Render once everyone runs 1.0.11+ to
 * require a token for these too. Reads never use this - they always need a
 * login and a permission.
 */
export function legacyTrackingAllowed(): boolean {
  return process.env.ALLOW_LEGACY_TRACKING !== 'false';
}

/**
 * For desktop tracking uploads: a valid token signs the request in as that
 * user (the handler then ignores any userId in the body); no token is only
 * accepted in legacy mode.
 */
@Injectable()
export class TrackingAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const hasToken = /^Bearer\s+\S+/i.test(String(req.headers?.authorization || ''));
    if (!hasToken) {
      if (legacyTrackingAllowed()) return true;
      throw new UnauthorizedException('Sign in required - please update WorkTrackPro');
    }
    return super.canActivate(context) as Promise<boolean>;
  }
}

/** The user a tracking upload belongs to: the signed-in user, or (legacy) the body's userId. */
export function trackingUserId(req: any, bodyUserId?: string | null): string {
  if (req?.user?.id) return req.user.id;
  if (!bodyUserId) throw new UnauthorizedException('Sign in required');
  return bodyUserId;
}
