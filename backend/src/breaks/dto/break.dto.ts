import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BreakType } from '@prisma/client';

export class StartBreakDto {
  @ApiProperty({ enum: BreakType, default: BreakType.SHORT_BREAK })
  @IsEnum(BreakType)
  breakType: BreakType;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  notes?: string;
}

export class EndBreakDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  notes?: string;
}
