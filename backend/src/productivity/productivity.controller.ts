import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ProductivityService } from './productivity.service';
import { CreateCategoryRuleDto } from './dto/productivity.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '@prisma/client';

@ApiTags('Productivity Engine')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('productivity')
export class ProductivityController {
  constructor(private readonly productivityService: ProductivityService) {}

  @ApiOperation({ summary: 'Calculate daily user productivity record' })
  @Get('calculate')
  async calculateUserProductivity(
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
    @Query('date') date?: string,
  ) {
    const targetDate = date || new Date().toISOString().split('T')[0];
    return this.productivityService.calculateUserDailyProductivity(userId, organizationId, targetDate);
  }

  @ApiOperation({ summary: 'Create category productivity rule (Admin)' })
  @Roles(Role.ADMIN)
  @Post('rules')
  async createCategoryRule(
    @CurrentUser('organizationId') organizationId: string,
    @Body() dto: CreateCategoryRuleDto,
  ) {
    return this.productivityService.createCategoryRule(organizationId, dto);
  }

  @ApiOperation({ summary: 'Get category productivity rules' })
  @Get('rules')
  async getCategoryRules(@CurrentUser('organizationId') organizationId: string) {
    return this.productivityService.getCategoryRules(organizationId);
  }

  @ApiOperation({ summary: 'Delete category rule (Admin)' })
  @Roles(Role.ADMIN)
  @Delete('rules/:id')
  async deleteCategoryRule(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.productivityService.deleteCategoryRule(id, organizationId);
  }
}
