import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { can } from './access.util';

/**
 * 'ADMIN' for Manager-portal users (Admin/Boss, HR), 'EMPLOYEE' for everyone
 * else - for services that branch on "manager or not". Use instead of the raw
 * stored role, which can be ADMIN on older SM/Team Lead accounts.
 */
export const AccessRole = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const user = ctx.switchToHttp().getRequest().user;
  return user && can(user, 'managerPortal') ? 'ADMIN' : 'EMPLOYEE';
});
