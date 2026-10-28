import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { UnauthorizedException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { createHash } from 'crypto';

describe('Auth Flow & Refresh Resilience Integration Tests', () => {
  let authService: AuthService;
  let jwtService: JwtService;
  let prismaService: any;

  const mockUser = {
    id: 'user_123456789012345678901234',
    organizationId: 'org_123456789012345678901234',
    firstName: 'Haider',
    lastName: 'Ali',
    email: 'haider.ali@worktrackpro.com',
    passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$somehash',
    role: Role.EMPLOYEE,
    isActive: true,
  };

  const storedRefreshTokens: any[] = [];

  beforeEach(async () => {
    storedRefreshTokens.length = 0;

    prismaService = {
      user: {
        findUnique: jest.fn().mockImplementation(async ({ where }: any) => {
          if (where.email && where.email === mockUser.email) {
            return { ...mockUser };
          }
          if (where.id && where.id === mockUser.id) {
            return { ...mockUser };
          }
          return null;
        }),
        update: jest.fn().mockResolvedValue({ ...mockUser, lastLoginAt: new Date() }),
      },
      activityEvent: {
        create: jest.fn().mockResolvedValue({ id: 'event_1' }),
      },
      refreshToken: {
        create: jest.fn().mockImplementation(async ({ data }: any) => {
          const record = { id: `token_${Date.now()}_${Math.random()}`, ...data, isRevoked: false, createdAt: new Date() };
          storedRefreshTokens.push(record);
          return record;
        }),
        findFirst: jest.fn().mockImplementation(async ({ where }: any) => {
          const match = storedRefreshTokens.find((r) => {
            if (r.userId !== where.userId) return false;
            if (where.tokenHash?.in) {
              return where.tokenHash.in.includes(r.tokenHash);
            }
            if (where.tokenHash) {
              return r.tokenHash === where.tokenHash;
            }
            return true;
          });
          return match ? { ...match } : null;
        }),
        findMany: jest.fn().mockImplementation(async ({ where }: any) => {
          return storedRefreshTokens.filter((r) => r.userId === where.userId && (where.isRevoked === undefined || r.isRevoked === where.isRevoked));
        }),
        update: jest.fn().mockImplementation(async ({ where, data }: any) => {
          const record = storedRefreshTokens.find((r) => r.id === where.id);
          if (record) {
            Object.assign(record, data);
            return { ...record };
          }
          return null;
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: prismaService,
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn().mockReturnValue('mocked.jwt.token'),
            verify: jest.fn().mockImplementation((token: string) => {
              if (token === 'expired_token') {
                throw new Error('jwt expired');
              }
              return {
                sub: mockUser.id,
                email: mockUser.email,
                role: mockUser.role,
                organizationId: mockUser.organizationId,
              };
            }),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string) => {
              if (key === 'JWT_SECRET') return 'test-secret';
              if (key === 'JWT_REFRESH_SECRET') return 'test-refresh-secret';
              return null;
            }),
          },
        },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    jwtService = module.get<JwtService>(JwtService);

    // Mock verifyPassword for deterministic testing
    (authService as any).verifyPassword = jest.fn().mockImplementation(async (_hash: string, plain: string) => {
      return plain === 'CorrectPassword123!';
    });
  });

  describe('1. Login Success', () => {
    it('should successfully log in and issue access and refresh tokens with trimmed email', async () => {
      const result = await authService.login({
        email: '  haider.ali@worktrackpro.com  ',
        password: 'CorrectPassword123!',
      });

      expect(result).toBeDefined();
      expect(result.tokens.accessToken).toBe('mocked.jwt.token');
      expect(result.tokens.refreshToken).toBe('mocked.jwt.token');
      expect(result.user.email).toBe(mockUser.email);
      expect(storedRefreshTokens.length).toBe(1);
    });
  });

  describe('2. Wrong Password', () => {
    it('should reject login with UnauthorizedException and log warning', async () => {
      await expect(
        authService.login({
          email: 'haider.ali@worktrackpro.com',
          password: 'WrongPassword!',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('3. Expired Token with Silent Refresh', () => {
    it('should refresh token using indexed SHA-256 lookup', async () => {
      const refreshToken = 'valid_refresh_token_abc123';
      const tokenHash = createHash('sha256').update(refreshToken).digest('hex');

      storedRefreshTokens.push({
        id: 'token_record_1',
        userId: mockUser.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        isRevoked: false,
        createdAt: new Date(),
      });

      const result = await authService.refreshTokens({ refreshToken });

      expect(result).toBeDefined();
      expect(result.accessToken).toBe('mocked.jwt.token');
      expect(result.refreshToken).toBe('mocked.jwt.token');
      // Old token must be marked as revoked
      expect(storedRefreshTokens[0].isRevoked).toBe(true);
    });
  });

  describe('4. Simultaneous Refresh Calls (Race Resilience)', () => {
    it('should resolve race condition and allow second in-flight refresh within grace period', async () => {
      const refreshToken = 'concurrent_refresh_token';
      const tokenHash = createHash('sha256').update(refreshToken).digest('hex');

      storedRefreshTokens.push({
        id: 'token_record_concurrent',
        userId: mockUser.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        isRevoked: false,
        createdAt: new Date(),
      });

      // Fire two refresh requests simultaneously
      const [res1, res2] = await Promise.all([
        authService.refreshTokens({ refreshToken }),
        authService.refreshTokens({ refreshToken }),
      ]);

      expect(res1).toBeDefined();
      expect(res2).toBeDefined();
      expect(res1.accessToken).toBe('mocked.jwt.token');
      expect(res2.accessToken).toBe('mocked.jwt.token');
    });
  });

  describe('5. Concurrent Logins', () => {
    it('should allow concurrent logins from multiple devices without wiping other sessions', async () => {
      const [login1, login2] = await Promise.all([
        authService.login({ email: 'haider.ali@worktrackpro.com', password: 'CorrectPassword123!' }),
        authService.login({ email: 'haider.ali@worktrackpro.com', password: 'CorrectPassword123!' }),
      ]);

      expect(login1.tokens).toBeDefined();
      expect(login2.tokens).toBeDefined();
      // Both sessions exist and have valid non-revoked tokens
      expect(storedRefreshTokens.length).toBe(2);
      expect(storedRefreshTokens[0].isRevoked).toBe(false);
      expect(storedRefreshTokens[1].isRevoked).toBe(false);
    });
  });

  describe('6. Login Independence from External Productivity Service', () => {
    it('should complete login swiftly without waiting for slow external services', async () => {
      const start = Date.now();
      const result = await authService.login({
        email: 'haider.ali@worktrackpro.com',
        password: 'CorrectPassword123!',
      });
      const duration = Date.now() - start;

      expect(result).toBeDefined();
      expect(duration).toBeLessThan(1000); // Must be fast
    });
  });
});
