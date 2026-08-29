import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class StartSessionDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  deviceId?: string;
}

export class EndSessionDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  sessionId?: string;
}

export class HeartbeatDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  sessionId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  deviceId?: string;

  @ApiPropertyOptional({ example: 'VS Code' })
  @IsString()
  @IsOptional()
  currentApplication?: string;
}
