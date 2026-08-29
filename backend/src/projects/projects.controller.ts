import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ProjectsService } from './projects.service';
import { CreateProjectDto, UpdateProjectDto } from './dto/project.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '@prisma/client';

@ApiTags('Projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @ApiOperation({ summary: 'Create project (Admin/Manager)' })
  @Roles(Role.ADMIN, Role.MANAGER)
  @Post()
  async createProject(
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
    @Body() dto: CreateProjectDto,
  ) {
    return this.projectsService.createProject(userId, organizationId, dto);
  }

  @ApiOperation({ summary: 'Get all projects' })
  @Get()
  async getProjects(@CurrentUser('organizationId') organizationId: string) {
    return this.projectsService.getProjects(organizationId);
  }

  @ApiOperation({ summary: 'Get project by ID' })
  @Get(':id')
  async getProjectById(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.projectsService.getProjectById(id, organizationId);
  }

  @ApiOperation({ summary: 'Update project (Admin/Manager)' })
  @Roles(Role.ADMIN, Role.MANAGER)
  @Patch(':id')
  async updateProject(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projectsService.updateProject(id, organizationId, dto);
  }

  @ApiOperation({ summary: 'Delete project (Admin/Manager)' })
  @Roles(Role.ADMIN, Role.MANAGER)
  @Delete(':id')
  async deleteProject(
    @Param('id') id: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.projectsService.deleteProject(id, organizationId);
  }
}
