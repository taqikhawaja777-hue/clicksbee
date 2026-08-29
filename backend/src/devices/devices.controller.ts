import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { DevicesService } from './devices.service';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Devices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @ApiOperation({ summary: 'Register desktop client device' })
  @Post('register')
  async registerDevice(
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
    @Body() dto: RegisterDeviceDto,
  ) {
    return this.devicesService.registerDevice(userId, organizationId, dto);
  }

  @ApiOperation({ summary: 'Get registered devices' })
  @Get()
  async getDevices(
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.devicesService.getDevices(userId, organizationId, role);
  }

  @ApiOperation({ summary: 'Get device by ID' })
  @Get(':id')
  async getDeviceById(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.devicesService.getDeviceById(id, userId, organizationId, role);
  }

  @ApiOperation({ summary: 'Delete/Unregister device' })
  @Delete(':id')
  async deleteDevice(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.devicesService.deleteDevice(id, userId, organizationId, role);
  }
}
