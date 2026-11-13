import {
  Controller,
  Post,
  Get,
  Patch,
  Put,
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
import {
  CreateTaskDto,
  ReopenSheetDto,
  SaveSheetResponsesDto,
  SubmitSheetDto,
  TaskReplyDto,
  UpdateTaskDto,
} from './dto/task.dto';
import { TaskSheetsService } from './task-sheets.service';
import { MAX_SHEET_FILE_BYTES } from './task-sheet.util';
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
    private readonly taskSheetsService: TaskSheetsService,
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

  @ApiOperation({ summary: 'Upload a fill-in spreadsheet (xlsx/xls/xlsm/xlsb/ods/csv/tsv) - pass the returned sheetId to POST /tasks' })
  @ApiConsumes('multipart/form-data')
  @Post('sheets')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_SHEET_FILE_BYTES } }))
  async uploadSheet(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.taskSheetsService.upload(file, userId, organizationId, role);
  }

  @ApiOperation({ summary: "A task's spreadsheet cells and saved responses (never the file itself)" })
  @Get(':id/sheet')
  async getSheet(
    @Param('id') id: string,
    @CurrentUser('id') reqUserId: string,
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.taskSheetsService.getSheet(id, organizationId, reqUserId, role);
  }

  @ApiOperation({ summary: 'Assignee saves client response / remarks for changed rows (draft)' })
  @Put(':id/sheet/responses')
  async saveSheet(
    @Param('id') id: string,
    @CurrentUser('id') reqUserId: string,
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('role') role: string,
    @Body() dto: SaveSheetResponsesDto,
  ) {
    return this.taskSheetsService.save(id, organizationId, reqUserId, role, dto.responses);
  }

  @ApiOperation({ summary: 'Assignee sends the filled spreadsheet to the manager (locks it)' })
  @HttpCode(HttpStatus.OK)
  @Post(':id/sheet/submit')
  async submitSheet(
    @Param('id') id: string,
    @CurrentUser('id') reqUserId: string,
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('role') role: string,
    @Body() dto: SubmitSheetDto,
  ) {
    return this.taskSheetsService.submit(id, organizationId, reqUserId, role, dto.responses);
  }

  @ApiOperation({ summary: 'Manager sends a submitted spreadsheet back to the assignee for changes' })
  @HttpCode(HttpStatus.OK)
  @Post(':id/sheet/reopen')
  async reopenSheet(
    @Param('id') id: string,
    @CurrentUser('id') reqUserId: string,
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('role') role: string,
    @Body() dto: ReopenSheetDto,
  ) {
    return this.taskSheetsService.reopen(id, organizationId, reqUserId, role, dto.note);
  }

  @ApiOperation({ summary: 'Manager-only download: ?version=original or completed (default)' })
  @Get(':id/sheet/file')
  async downloadSheet(
    @Param('id') id: string,
    @CurrentUser('id') reqUserId: string,
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('role') role: string,
    @Query('version') version?: string,
  ) {
    return this.taskSheetsService.download(
      id,
      organizationId,
      reqUserId,
      role,
      version === 'original' ? 'original' : 'completed',
    );
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
