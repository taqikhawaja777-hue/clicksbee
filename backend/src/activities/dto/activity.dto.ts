import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsInt,
  IsBoolean,
  IsArray,
  ValidateNested,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ActivityEventType } from '@prisma/client';

export class ApplicationUsageDto {
  @ApiProperty({ example: 'VS Code' })
  @IsString()
  @IsNotEmpty()
  applicationName: string;

  @ApiProperty({ example: 'code.exe' })
  @IsString()
  @IsNotEmpty()
  processName: string;

  @ApiPropertyOptional({ example: 'main.ts - StitchMonitor' })
  @IsString()
  @IsOptional()
  windowTitle?: string;

  @ApiProperty()
  @IsNotEmpty()
  startedAt: string;

  @ApiProperty()
  @IsNotEmpty()
  endedAt: string;

  @ApiProperty({ example: 120 })
  @IsInt()
  duration: number;

  @ApiPropertyOptional({ example: 'Development' })
  @IsString()
  @IsOptional()
  category?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isProductive?: boolean;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  deviceId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  eventId?: string;
}

export class BatchApplicationUsageDto {
  @ApiProperty({ type: [ApplicationUsageDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApplicationUsageDto)
  applications: ApplicationUsageDto[];

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  deviceId?: string;
}

export class WebsiteUsageDto {
  @ApiProperty({ example: 'github.com' })
  @IsString()
  @IsNotEmpty()
  domain: string;

  @ApiProperty({ example: 'https://github.com/organization/repo' })
  @IsString()
  @IsNotEmpty()
  url: string;

  @ApiPropertyOptional({ example: 'GitHub Repository' })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiProperty()
  @IsNotEmpty()
  startedAt: string;

  @ApiProperty()
  @IsNotEmpty()
  endedAt: string;

  @ApiProperty({ example: 300 })
  @IsInt()
  duration: number;

  @ApiPropertyOptional({ example: 'Development' })
  @IsString()
  @IsOptional()
  category?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isProductive?: boolean;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  deviceId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  eventId?: string;
}

export class BatchWebsiteUsageDto {
  @ApiProperty({ type: [WebsiteUsageDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WebsiteUsageDto)
  websites: WebsiteUsageDto[];

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  deviceId?: string;
}

export class IdleEventDto {
  @ApiProperty({ example: 180 })
  @IsInt()
  idleDuration: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  deviceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  timestamp?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  eventId?: string;
}

export class GenericActivityEventDto {
  @ApiProperty({ enum: ActivityEventType })
  @IsEnum(ActivityEventType)
  type: ActivityEventType;

  @ApiPropertyOptional()
  @IsOptional()
  metadata?: any;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  deviceId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  eventId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  timestamp?: string;
}
