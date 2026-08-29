import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDeviceDto } from './dto/register-device.dto';

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  async registerDevice(userId: string, organizationId: string, dto: RegisterDeviceDto) {
    const existing = await this.prisma.device.findFirst({
      where: {
        userId,
        organizationId,
        hostname: dto.hostname,
      },
    });

    if (existing) {
      return this.prisma.device.update({
        where: { id: existing.id },
        data: {
          deviceName: dto.deviceName,
          platform: dto.platform,
          osVersion: dto.osVersion,
          appVersion: dto.appVersion,
          ipAddress: dto.ipAddress,
          lastSeenAt: new Date(),
          isActive: true,
        },
      });
    }

    return this.prisma.device.create({
      data: {
        userId,
        organizationId,
        deviceName: dto.deviceName,
        hostname: dto.hostname,
        platform: dto.platform,
        osVersion: dto.osVersion,
        appVersion: dto.appVersion,
        ipAddress: dto.ipAddress,
        lastSeenAt: new Date(),
        isActive: true,
      },
    });
  }

  async getDevices(userId: string, organizationId: string, role: string) {
    if (role === 'ADMIN') {
      return this.prisma.device.findMany({
        where: { organizationId },
        include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
        orderBy: { lastSeenAt: 'desc' },
      });
    }
    return this.prisma.device.findMany({
      where: { organizationId, userId },
      orderBy: { lastSeenAt: 'desc' },
    });
  }

  async getDeviceById(id: string, userId: string, organizationId: string, role: string) {
    const device = await this.prisma.device.findUnique({
      where: { id },
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });

    if (!device || device.organizationId !== organizationId) {
      throw new NotFoundException('Device not found');
    }

    if (role !== 'ADMIN' && device.userId !== userId) {
      throw new ForbiddenException('Access denied to this device record');
    }

    return device;
  }

  async deleteDevice(id: string, userId: string, organizationId: string, role: string) {
    const device = await this.getDeviceById(id, userId, organizationId, role);
    await this.prisma.device.delete({ where: { id: device.id } });
    return { message: 'Device unregistered successfully' };
  }
}
