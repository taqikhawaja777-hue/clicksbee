import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SessionsService } from './sessions.service';
import { StartSessionDto, EndSessionDto, HeartbeatDto } from './dto/session.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Work Sessions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @ApiOperation({ summary: 'Start work session' })
  @Post('start')
  async startSession(
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
    @Body() dto: StartSessionDto,
  ) {
    return this.sessionsService.startSession(userId, organizationId, dto);
  }

  @ApiOperation({ summary: 'End work session' })
  @HttpCode(HttpStatus.OK)
  @Post('end')
  async endSession(
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
    @Body() dto: EndSessionDto,
  ) {
    return this.sessionsService.endSession(userId, organizationId, dto);
  }

  @ApiOperation({ summary: 'Session heartbeat' })
  @HttpCode(HttpStatus.OK)
  @Post('heartbeat')
  async heartbeat(
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
    @Body() dto: HeartbeatDto,
  ) {
    return this.sessionsService.heartbeat(userId, organizationId, dto);
  }
}
