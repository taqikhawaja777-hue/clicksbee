import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import {
  Category,
  CATEGORY_LABELS,
  OFFICE_CATEGORIES,
  categoryOf,
  permissionsOf,
} from '../common/access/access.util';

/** The Employee tab's remaining designations (Team Lead / SM / HR moved to Office / Manager). */
export const EMPLOYEE_DESIGNATIONS = ['Employee', 'CSR'];

function keyMatches(given: string | undefined, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given.trim().toLowerCase());
  const b = Buffer.from(expected.trim().toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Which category a signup creates. The client's `role` is never trusted:
 *  - EMPLOYEE (default): sales employee, designation Employee/CSR only.
 *  - OFFICE: needs OFFICE_SIGNUP_KEY; one of SM / Team Lead / Back Office / Validator / Closer.
 *  - MANAGER: needs MANAGER_SIGNUP_KEY; always HR. Admin/Boss can only be
 *    granted by an existing Admin (Users page) - nobody can sign up with full access.
 * Keys live in the server's environment (Render), not in the app or this repository.
 */
export function resolveSignupCategory(
  dto: { category?: string; officeCategory?: string; signupKey?: string; role?: string; designation?: string },
  env: NodeJS.ProcessEnv = process.env,
): { category: Category; designation: string | null } {
  const requested = dto.category || (dto.role && dto.role !== 'EMPLOYEE' ? 'MANAGER' : 'EMPLOYEE');

  if (requested === 'OFFICE') {
    if (!env.OFFICE_SIGNUP_KEY) throw new ForbiddenException('Office signup is not enabled on the server yet');
    if (!keyMatches(dto.signupKey, env.OFFICE_SIGNUP_KEY)) throw new ForbiddenException('Incorrect Office key');
    if (!dto.officeCategory || !(OFFICE_CATEGORIES as string[]).includes(dto.officeCategory)) {
      throw new BadRequestException('Choose your Office Category');
    }
    return { category: dto.officeCategory as Category, designation: null };
  }

  if (requested === 'MANAGER') {
    if (!env.MANAGER_SIGNUP_KEY) throw new ForbiddenException('Manager signup is not enabled on the server yet');
    if (!keyMatches(dto.signupKey, env.MANAGER_SIGNUP_KEY)) {
      throw new ForbiddenException('Incorrect Manager key - please update WorkTrackPro to the latest version');
    }
    return { category: 'HR', designation: null };
  }

  const designation = dto.designation?.trim() || null;
  if (designation && !EMPLOYEE_DESIGNATIONS.includes(designation)) {
    throw new BadRequestException(`"${designation}" is now in the Office or Manager category - sign up there instead`);
  }
  return { category: 'EMPLOYEE', designation };
}

/** Adds the access category and permission list the desktop app builds its menu from. */
export function withAccess<T extends { role: string; designation?: string | null; officeCategory?: string | null }>(user: T) {
  const category = categoryOf(user);
  return { ...user, category, categoryLabel: CATEGORY_LABELS[category], permissions: permissionsOf(user) };
}
