import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDeviceDto {
  @ApiProperty({ example: 'John-MacBook-Pro' })
  @IsString()
  @IsNotEmpty()
  deviceName: string;

  @ApiProperty({ example: 'johns-mbp.local' })
  @IsString()
  @IsNotEmpty()
  hostname: string;

  @ApiProperty({ example: 'darwin' })
  @IsString()
  @IsNotEmpty()
  platform: string;

  @ApiProperty({ example: '14.2.1' })
  @IsString()
  @IsNotEmpty()
  osVersion: string;

  @ApiProperty({ example: '1.0.0' })
  @IsString()
  @IsNotEmpty()
  appVersion: string;

  @ApiPropertyOptional({ example: '192.168.1.50' })
  @IsString()
  @IsOptional()
  ipAddress?: string;
}
