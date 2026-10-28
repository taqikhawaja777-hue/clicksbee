import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { createHash, randomUUID } from 'crypto';
import * as argon2 from 'argon2';
import * as bcrypt from 'bcryptjs';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/reset-password.dto';
import { Role } from '@prisma/client';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  private async hashPassword(password: string): Promise<string> {
    try {
      return await argon2.hash(password);
    } catch {
      return await bcrypt.hash(password, 10);
    }
  }

  private async verifyPassword(hash: string, plain: string): Promise<boolean> {
    try {
      if (hash.startsWith('$argon2')) {
        return await argon2.verify(hash, plain);
      }
      return await bcrypt.compare(plain, hash);
    } catch {
      return false;
    }
  }

  async register(dto: RegisterDto) {
    const cleanEmail = (dto.email || '').trim().toLowerCase();
    const existingUser = await this.prisma.user.findUnique({
      where: { email: cleanEmail },
    });

    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    const orgSlug = dto.organizationName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-');

    let org = await this.prisma.organization.findUnique({
      where: { slug: orgSlug },
    });

    if (!org) {
      org = await this.prisma.organization.create({
        data: {
          name: dto.organizationName,
          slug: orgSlug,
          licenses: {
            create: {
              plan: 'STARTER',
              maxEmployees: 50,
              status: 'ACTIVE',
            },
          },
          policies: {
            create: {
              name: 'Default Organization Policy',
              isDefault: true,
              minScreenshotInterval: 300,
              maxScreenshotInterval: 900,
              screenshotEnabled: true,
              idleTimeoutSeconds: 300,
            },
          },
        },
      });
    }

    const passwordHash = await this.hashPassword(dto.password);

    // Departments are per-organization, plain-named rows (no separate
    // management UI exists yet - the signup form just offers a fixed list
    // of names) - find-or-create by (organizationId, name) rather than
    // requiring the frontend to already know a real Department id.
    let departmentId: string | undefined;
    if (dto.departmentName?.trim()) {
      const departmentName = dto.departmentName.trim();
      const department = await this.prisma.department.upsert({
        where: { organizationId_name: { organizationId: org.id, name: departmentName } },
        update: {},
        create: { organizationId: org.id, name: departmentName },
      });
      departmentId = department.id;
    }

    const user = await this.prisma.user.create({
      data: {
        organizationId: org.id,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: cleanEmail,
        passwordHash,
        role: dto.role || Role.ADMIN,
        departmentId,
        designation: dto.designation?.trim() || undefined,
        employeeCode: `EMP-${Math.floor(1000 + Math.random() * 9000)}`,
      },
    });

    const tokens = await this.generateTokens(user.id, user.email, user.role, user.organizationId);

    const { passwordHash: _, ...result } = user;
    return {
      user: result,
      tokens,
    };
  }

  async login(dto: LoginDto) {
    const cleanEmail = (dto.email || '').trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: cleanEmail },
    });

    if (!user) {
      this.logger.warn(`Login failed: user not found for email="${cleanEmail}"`);
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.isActive) {
      this.logger.warn(`Login failed: account is deactivated for email="${cleanEmail}" (userId=${user.id})`);
      throw new UnauthorizedException('Account has been deactivated');
    }

    const isPasswordValid = await this.verifyPassword(user.passwordHash, dto.password);
    if (!isPasswordValid) {
      this.logger.warn(`Login failed: invalid password for email="${cleanEmail}" (userId=${user.id})`);
      throw new UnauthorizedException('Invalid email or password');
    }

    this.logger.log(`Login succeeded for email="${cleanEmail}" (userId=${user.id}, role=${user.role})`);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Feeds the manager-portal Logs page (AuditLogsService.getLogs) - a
    // login previously produced no record anywhere in the system, not
    // even a silent one, so "logged in" could never appear alongside
    // check-in/check-out/etc. in that employee's activity log. Purely an
    // observability side-effect - must never block a successful login.
    // eventId must be set to a real unique value, not omitted: every other
    // ActivityEvent writer in this codebase (ActivitiesService) always
    // supplies one for exactly this reason - eventId's @unique index isn't
    // sparse, so MongoDB treats every row that omits it as colliding on
    // the same implicit null, and only the first such row ever succeeds.
    this.prisma.activityEvent
      .create({
        data: { organizationId: user.organizationId, userId: user.id, type: 'LOGIN', eventId: randomUUID() },
      })
      .catch((e) => console.error('[AuthService] Failed to record LOGIN activity event:', e));

    const tokens = await this.generateTokens(user.id, user.email, user.role, user.organizationId);

    const { passwordHash: _, ...result } = user;
    return {
      user: result,
      tokens,
    };
  }

  async refreshTokens(dto: RefreshTokenDto) {
    const refreshSecret =
      this.configService.get<string>('JWT_REFRESH_SECRET') ||
      'super-secret-jwt-refresh-key-stitchmonitor-2026';

    let payload: any;
    try {
      payload = this.jwtService.verify(dto.refreshToken, {
        secret: refreshSecret,
        clockTolerance: 30,
      });
    } catch (e: any) {
      this.logger.warn(`Refresh token verification error: ${e?.message}`);
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const sha256Hash = createHash('sha256').update(dto.refreshToken).digest('hex');

    // 1. O(1) indexed lookup by SHA-256 hash
    let tokenRecord = await this.prisma.refreshToken.findFirst({
      where: {
        userId: payload.sub,
        tokenHash: { in: [sha256Hash, `sha256:${sha256Hash}`] },
      },
    });

    // 2. Backward compatibility fallback for legacy bcrypt/argon2 tokens
    if (!tokenRecord) {
      const candidates = await this.prisma.refreshToken.findMany({
        where: {
          userId: payload.sub,
          isRevoked: false,
        },
        take: 10,
      });

      for (const candidate of candidates) {
        if (await this.verifyPassword(candidate.tokenHash, dto.refreshToken)) {
          tokenRecord = candidate;
          break;
        }
      }
    }

    if (!tokenRecord) {
      this.logger.warn(`Refresh failed: token record not found for userId=${payload.sub}`);
      throw new UnauthorizedException('Refresh token is expired or revoked');
    }

    // 3. Grace window for concurrent requests:
    // If this token was revoked within the last 30s by a racing parallel request from the same client,
    // grant the refresh and return valid tokens rather than logging out the employee!
    if (tokenRecord.isRevoked) {
      const tokenAge = tokenRecord.createdAt ? Date.now() - new Date(tokenRecord.createdAt).getTime() : Infinity;
      const isWithinGrace = tokenRecord.replacedByToken || tokenAge < 30000;
      if (!isWithinGrace) {
        this.logger.warn(`Refresh failed: token is revoked for userId=${payload.sub}`);
        throw new UnauthorizedException('Refresh token is expired or revoked');
      }
    }

    if (new Date() > tokenRecord.expiresAt) {
      this.logger.warn(`Refresh failed: token expired at ${tokenRecord.expiresAt.toISOString()} for userId=${payload.sub}`);
      throw new UnauthorizedException('Refresh token is expired or revoked');
    }

    await this.prisma.refreshToken.update({
      where: { id: tokenRecord.id },
      data: { isRevoked: true },
    });

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User no longer exists or is inactive');
    }

    return await this.generateTokens(user.id, user.email, user.role, user.organizationId);
  }

  async logout(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, isRevoked: false },
      data: { isRevoked: true },
    });
    return { message: 'Successfully logged out' };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isValid = await this.verifyPassword(user.passwordHash, dto.currentPassword);
    if (!isValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    const newHash = await this.hashPassword(dto.newPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash },
    });

    await this.logout(userId);

    return { message: 'Password updated successfully' };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (!user) {
      return { message: 'If the email exists, a password reset token has been sent' };
    }
    const resetToken = this.jwtService.sign(
      { sub: user.id, type: 'reset' },
      { expiresIn: '1h' },
    );
    return {
      message: 'Password reset token generated successfully',
      resetToken,
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    try {
      const payload = this.jwtService.verify(dto.token);
      if (payload.type !== 'reset') {
        throw new BadRequestException('Invalid token type');
      }
      const newHash = await this.hashPassword(dto.newPassword);
      await this.prisma.user.update({
        where: { id: payload.sub },
        data: { passwordHash: newHash },
      });
      return { message: 'Password reset successfully' };
    } catch {
      throw new BadRequestException('Invalid or expired reset token');
    }
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        organizationId: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        employeeCode: true,
        avatar: true,
        isActive: true,
        lastLoginAt: true,
        departmentId: true,
        teamId: true,
        managerId: true,
        createdAt: true,
        updatedAt: true,
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            timezone: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User profile not found');
    }

    return user;
  }

  private async generateTokens(
    userId: string,
    email: string,
    role: Role,
    organizationId: string,
  ) {
    const payload = { sub: userId, email, role, organizationId };

    const accessToken = this.jwtService.sign(payload, {
      secret:
        this.configService.get<string>('JWT_SECRET') ||
        'super-secret-jwt-access-key-stitchmonitor-2026',
      expiresIn: this.configService.get<string>('JWT_EXPIRATION') || '15m',
    });

    const refreshSecret =
      this.configService.get<string>('JWT_REFRESH_SECRET') ||
      'super-secret-jwt-refresh-key-stitchmonitor-2026';

    const refreshToken = this.jwtService.sign(payload, {
      secret: refreshSecret,
      expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRATION') || '7d',
    });

    const tokenHash = createHash('sha256').update(refreshToken).digest('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: 900, // 15 minutes
    };
  }
}
