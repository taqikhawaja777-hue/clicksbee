import { IsBoolean, IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { RuleType } from '@prisma/client';

export class CreateCategoryRuleDto {
  @ApiProperty({ enum: RuleType })
  @IsEnum(RuleType)
  type: RuleType;

  @ApiProperty({ example: 'github.com or code.exe' })
  @IsString()
  @IsNotEmpty()
  pattern: string;

  @ApiProperty({ example: 'Development' })
  @IsString()
  @IsNotEmpty()
  category: string;

  @ApiProperty({ default: true })
  @IsBoolean()
  isProductive: boolean;
}
