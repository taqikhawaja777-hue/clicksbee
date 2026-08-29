import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PoliciesService } from './policies.service';
import { CreatePolicyDto } from './dto/policy.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '@prisma/client';

@ApiTags('Monitoring Policies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('policies')
export class PoliciesController {
  constructor(private readonly policiesService: PoliciesService) {}

  @ApiOperation({ summary: 'Create monitoring policy (Admin/Manager)' })
  @Roles(Role.ADMIN, Role.MANAGER)
  @Post()
  async createPolicy(
    @CurrentUser('organizationId') organizationId: string,
    @Body() dto: CreatePolicyDto,
  ) {
    return this.policiesService.createPolicy(organizationId, dto);
  }

  @ApiOperation({ summary: 'Get all monitoring policies' })
  @Get()
  async getPolicies(@CurrentUser('organizationId') organizationId: string) {
    return this.policiesService.getPolicies(organizationId);
  }

  @ApiOperation({ summary: 'Get monitoring policy by ID' })
  @Get(':id')
  async getPolicyById(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.policiesService.getPolicyById(id, organizationId);
  }

  @ApiOperation({ summary: 'Update monitoring policy (Admin/Manager)' })
  @Roles(Role.ADMIN, Role.MANAGER)
  @Put(':id')
  async updatePolicy(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
    @Body() dto: CreatePolicyDto,
  ) {
    return this.policiesService.updatePolicy(id, organizationId, dto);
  }

  @ApiOperation({ summary: 'Delete monitoring policy (Admin)' })
  @Roles(Role.ADMIN)
  @Delete(':id')
  async deletePolicy(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.policiesService.deletePolicy(id, organizationId);
  }
}

@ApiTags('Client Configuration')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('client')
export class ClientConfigController {
  constructor(private readonly policiesService: PoliciesService) {}

  @ApiOperation({ summary: 'Get desktop client effective policy configuration' })
  @Get('config')
  async getClientConfig(
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.policiesService.getClientConfig(userId, organizationId);
  }
}
