import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePolicyDto {
  @ApiProperty({ example: 'Standard Office Policy' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

  @ApiPropertyOptional({ example: 300 })
  @IsInt()
  @Min(30)
  @IsOptional()
  minScreenshotInterval?: number;

  @ApiPropertyOptional({ example: 900 })
  @IsInt()
  @Min(60)
  @IsOptional()
  maxScreenshotInterval?: number;

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  screenshotEnabled?: boolean;

  @ApiPropertyOptional({ example: 300 })
  @IsInt()
  @Min(60)
  @IsOptional()
  idleTimeoutSeconds?: number;

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  applicationTrackingEnabled?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  websiteTrackingEnabled?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  captureOnActivity?: boolean;

  @ApiPropertyOptional({ example: 30 })
  @IsInt()
  @IsOptional()
  retentionDays?: number;
}
