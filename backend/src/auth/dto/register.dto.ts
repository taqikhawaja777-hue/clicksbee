import { IsEmail, IsNotEmpty, IsString, MinLength, IsEnum, IsOptional, IsIn } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@prisma/client';

export class RegisterDto {
  @ApiProperty({ example: 'StitchMonitor Inc.' })
  @IsString()
  @IsNotEmpty()
  organizationName: string;

  @ApiProperty({ example: 'John' })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @ApiProperty({ example: 'john@stitchmonitor.local' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: 'SecurePassword123!' })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;

  /**
   * Ignored for access: the server decides the role from `category`. Still
   * accepted so older app versions' requests validate; an old "Manager"
   * signup (role ADMIN, no key) is refused.
   */
  @ApiPropertyOptional({ enum: Role, deprecated: true })
  @IsEnum(Role)
  @IsOptional()
  role?: Role;

  @ApiPropertyOptional({ enum: ['EMPLOYEE', 'OFFICE', 'MANAGER'], default: 'EMPLOYEE' })
  @IsIn(['EMPLOYEE', 'OFFICE', 'MANAGER'])
  @IsOptional()
  category?: 'EMPLOYEE' | 'OFFICE' | 'MANAGER';

  @ApiPropertyOptional({ enum: ['SM', 'TEAM_LEAD', 'BACK_OFFICE', 'VALIDATOR', 'CLOSER'], description: 'Required for the Office category' })
  @IsIn(['SM', 'TEAM_LEAD', 'BACK_OFFICE', 'VALIDATOR', 'CLOSER'])
  @IsOptional()
  officeCategory?: string;

  @ApiPropertyOptional({ description: 'Office / Manager signup key (checked on the server)' })
  @IsString()
  @IsOptional()
  signupKey?: string;

  @ApiPropertyOptional({ example: 'Engineering' })
  @IsString()
  @IsOptional()
  departmentName?: string;

  @ApiPropertyOptional({ example: 'SM', description: 'Job title pick-list: SM, CSR, or Team Lead' })
  @IsString()
  @IsOptional()
  designation?: string;
}
