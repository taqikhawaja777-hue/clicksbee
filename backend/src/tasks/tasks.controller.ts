import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TasksService } from './tasks.service';
import { CreateTaskDto, UpdateTaskDto } from './dto/task.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TaskStatus } from '@prisma/client';

@ApiTags('Tasks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @ApiOperation({ summary: 'Create task' })
  @Post()
  async createTask(
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
    @Body() dto: CreateTaskDto,
  ) {
    return this.tasksService.createTask(userId, organizationId, dto);
  }

  @ApiOperation({ summary: 'Get tasks' })
  @Get()
  async getTasks(
    @CurrentUser('id') reqUserId: string,
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('role') role: string,
    @Query('projectId') projectId?: string,
    @Query('status') status?: TaskStatus,
  ) {
    return this.tasksService.getTasks(organizationId, reqUserId, role, projectId, status);
  }

  @ApiOperation({ summary: 'Get task by ID' })
  @Get(':id')
  async getTaskById(
    @Param('id') id: string,
    @CurrentUser('id') reqUserId: string,
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.tasksService.getTaskById(id, organizationId, reqUserId, role);
  }

  @ApiOperation({ summary: 'Update task' })
  @Patch(':id')
  async updateTask(
    @Param('id') id: string,
    @CurrentUser('id') reqUserId: string,
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('role') role: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.tasksService.updateTask(id, organizationId, reqUserId, role, dto);
  }

  @ApiOperation({ summary: 'Delete task' })
  @Delete(':id')
  async deleteTask(
    @Param('id') id: string,
    @CurrentUser('id') reqUserId: string,
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.tasksService.deleteTask(id, organizationId, reqUserId, role);
  }

  @ApiOperation({ summary: 'Start working on task' })
  @HttpCode(HttpStatus.OK)
  @Post(':id/start')
  async startTask(
    @Param('id') id: string,
    @CurrentUser('id') reqUserId: string,
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.tasksService.startTask(id, organizationId, reqUserId, role);
  }

  @ApiOperation({ summary: 'Mark task completed' })
  @HttpCode(HttpStatus.OK)
  @Post(':id/complete')
  async completeTask(
    @Param('id') id: string,
    @CurrentUser('id') reqUserId: string,
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.tasksService.completeTask(id, organizationId, reqUserId, role);
  }
}
