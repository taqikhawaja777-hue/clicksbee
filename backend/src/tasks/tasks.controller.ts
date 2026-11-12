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
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { TasksService } from './tasks.service';
import { CreateTaskDto, TaskReplyDto, UpdateTaskDto } from './dto/task.dto';
import { StorageService } from '../storage/storage.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TaskStatus } from '@prisma/client';

@ApiTags('Tasks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tasks')
export class TasksController {
  constructor(
    private readonly tasksService: TasksService,
    private readonly storageService: StorageService,
  ) {}

  @ApiOperation({ summary: 'Create task' })
  @Post()
  async createTask(
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
    @Body() dto: CreateTaskDto,
  ) {
    return this.tasksService.createTask(userId, organizationId, dto);
  }

  @ApiOperation({ summary: 'Upload a document to attach to a task - the brief on creation, or a reply' })
  @ApiConsumes('multipart/form-data')
  @Post('attachment')
  @UseInterceptors(FileInterceptor('file'))
  async uploadAttachment(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    const { fileUrl } = await this.storageService.upload(
      file.buffer,
      organizationId,
      userId,
      file.originalname,
      file.mimetype || 'application/octet-stream',
    );
    return { url: fileUrl, fileName: file.originalname };
  }

  @ApiOperation({ summary: 'Reply on a task with a note and/or document - the assignee sends work back, the assigner follows up' })
  @Post(':id/reply')
  async replyToTask(
    @Param('id') id: string,
    @CurrentUser('id') reqUserId: string,
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('role') role: string,
    @Body() dto: TaskReplyDto,
  ) {
    return this.tasksService.addReply(id, organizationId, reqUserId, role, dto);
  }

  @ApiOperation({ summary: 'Task-based productivity for every non-employee team member (manager/HR/SM/team lead/CSR) over a shift-day range' })
  @Get('productivity')
  async getTeamProductivity(
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('role') role: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (role === 'EMPLOYEE') {
      throw new ForbiddenException('Team productivity is available to managers and admins only');
    }
    return this.tasksService.getTeamProductivity(organizationId, from, to);
  }

  @ApiOperation({ summary: 'Tickets = completed tasks; optionally for one member (assigned by or to them)' })
  @Get('tickets')
  async getTickets(
    @CurrentUser('id') reqUserId: string,
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('role') role: string,
    @Query('userId') userId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.tasksService.getTickets(organizationId, reqUserId, role, userId, Number(page) || 1, Number(pageSize) || 50);
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
