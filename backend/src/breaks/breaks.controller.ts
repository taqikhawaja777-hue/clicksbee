import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BreaksService } from './breaks.service';
import { StartBreakDto, EndBreakDto } from './dto/break.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Breaks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('breaks')
export class BreaksController {
  constructor(private readonly breaksService: BreaksService) {}

  @ApiOperation({ summary: 'Start a break session' })
  @Post('start')
  async startBreak(
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
    @Body() dto: StartBreakDto,
  ) {
    return this.breaksService.startBreak(userId, organizationId, dto);
  }

  @ApiOperation({ summary: 'End an active break session' })
  @HttpCode(HttpStatus.OK)
  @Post('end')
  async endBreak(
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
    @Body() dto: EndBreakDto,
  ) {
    return this.breaksService.endBreak(userId, organizationId, dto);
  }

  @ApiOperation({ summary: 'Get current user breaks' })
  @Get('me')
  async getMyBreaks(
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
  ) {
    return this.breaksService.getMyBreaks(userId, organizationId);
  }

  @ApiOperation({ summary: 'Get user break history' })
  @Get('user/:userId')
  async getUserBreaks(
    @Param('userId') targetUserId: string,
    @CurrentUser('id') reqUserId: string,
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.breaksService.getUserBreaks(targetUserId, reqUserId, organizationId, role);
  }
}
