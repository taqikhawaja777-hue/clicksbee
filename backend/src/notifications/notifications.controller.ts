import {
  Body,
  Controller,
  Get,
  Patch,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { NotificationsService, isManagementTier } from './notifications.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { NotificationType, Role } from '@prisma/client';

@ApiTags('Notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  @ApiOperation({ summary: 'Get notifications for the current user - employees see only their own, admins/managers see the org-wide admin feed' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get()
  async getNotifications(
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('role') role: Role,
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    return this.notificationsService.getNotifications(userId, organizationId, role, Number(page) || 1, Number(limit) || 20);
  }

  @ApiOperation({ summary: 'Unread notification count for the badge - same per-role scoping as the list endpoint' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('unread-count')
  async getUnreadCount(
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('role') role: Role,
  ) {
    return this.notificationsService.getUnreadCount(userId, organizationId, role);
  }

  @ApiOperation({ summary: 'Mark all of the current user/role scope\'s notifications as read' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Patch('read-all')
  async markAllAsRead(
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('role') role: Role,
  ) {
    return this.notificationsService.markAllAsRead(userId, organizationId, role);
  }

  @ApiOperation({ summary: 'Mark a single notification as read' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Patch(':id/read')
  async markAsRead(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('role') role: Role,
  ) {
    return this.notificationsService.markAsRead(id, userId, organizationId, role);
  }

  @ApiOperation({ summary: 'List everyone in the org messageable via Send Message (not the same, role-filtered list as /employees)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('messageable-users')
  async getMessageableUsers(
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.notificationsService.getMessageableUsers(organizationId, userId);
  }

  @ApiOperation({ summary: 'Upload a file (e.g. a PDF employee report) to attach to a message' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
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

  @ApiOperation({
    summary:
      'Send Notification / message. Management tier (ADMIN, MANAGER, or designation SM/HR) can message anyone in the org, including broadcasting to "All Employees". Floor tier (designation CSR/Team Lead, or no designation) can only message other floor-tier employees, one at a time - enforced here, not just hidden in the UI.',
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('send')
  async sendNotification(
    @CurrentUser('id') senderUserId: string,
    @CurrentUser('organizationId') organizationId: string,
    @Body()
    body: {
      recipientUserId?: string;
      allEmployees?: boolean;
      title?: string;
      message: string;
      attachmentUrl?: string;
      attachmentName?: string;
    },
  ) {
    if (!body?.message?.trim()) {
      throw new BadRequestException('message is required');
    }

    const sender = await this.prisma.user.findFirst({
      where: { id: senderUserId, organizationId },
      select: { role: true, designation: true },
    });
    if (!sender) {
      throw new ForbiddenException('Sender not found');
    }
    const senderIsManagement = isManagementTier(sender.role, sender.designation);

    let recipientUserIds: string[];
    if (body.allEmployees) {
      // Broadcasting to the whole org is a management-tier privilege -
      // enforced here (not just an omitted UI button), since the "All
      // Employees" fan-out previously only existed for ADMIN/MANAGER
      // callers and floor-tier employees were never meant to blast a
      // message to everyone, including management, at once.
      if (!senderIsManagement) {
        throw new ForbiddenException('Only management (ADMIN, MANAGER, SM, or HR) can message All Employees');
      }
      const employees = await this.prisma.user.findMany({
        where: { organizationId, role: Role.EMPLOYEE },
        select: { id: true },
      });
      recipientUserIds = employees.map((e) => e.id);
    } else {
      if (!body.recipientUserId) {
        throw new BadRequestException('recipientUserId is required unless allEmployees is true');
      }
      // Scoped to this sender's own organization - nobody can target a
      // user id belonging to a different org just by guessing/passing it.
      const recipient = await this.prisma.user.findFirst({
        where: { id: body.recipientUserId, organizationId },
        select: { id: true, role: true, designation: true },
      });
      if (!recipient) {
        throw new BadRequestException('recipientUserId is not a valid employee in your organization');
      }

      // Tiered permission: management tier can message anyone (including
      // reaching down to floor-tier employees). Floor tier can only
      // message other floor-tier employees - they cannot reach up to
      // HR/SM/Admin/Manager inboxes.
      if (!senderIsManagement && isManagementTier(recipient.role, recipient.designation)) {
        throw new ForbiddenException(
          'CSR/Team Lead employees can only message other CSR/Team Lead employees, not HR/SM/Admin/Manager',
        );
      }

      recipientUserIds = [recipient.id];
    }

    return this.notificationsService.sendManualNotification(
      organizationId,
      senderUserId,
      recipientUserIds,
      body.title || 'Message',
      body.message.trim(),
      body.attachmentUrl,
      body.attachmentName,
    );
  }

  // ---- internal bridge - called server-to-server by productivity_service,
  // never a browser, so this deliberately isn't behind JwtAuthGuard (a
  // FastAPI process has no employee login/JWT of its own to send). Same
  // trusted-network posture already used by every other internal/dev
  // endpoint in this codebase (see JwtAuthGuard's own /employees bypass,
  // productivity_service's un-authed dev endpoints) - not gold-plating
  // security beyond what already exists elsewhere here.

  @ApiOperation({ summary: 'Internal: productivity_service reports a real event (check-in, idle alert, etc.) to notify' })
  @Post('system-event')
  async recordSystemEvent(
    @Body()
    body: {
      employeeEmail: string;
      type: NotificationType;
      adminTitle: string;
      adminMessage: string;
      employeeTitle?: string;
      employeeMessage?: string;
      metadata?: any;
    },
  ) {
    if (!body?.employeeEmail || !body?.type || !body?.adminMessage) {
      throw new BadRequestException('employeeEmail, type, and adminMessage are required');
    }
    return this.notificationsService.recordSystemEvent(body);
  }
}
