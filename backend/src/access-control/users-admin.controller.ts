import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../common/access/permissions.guard';
import { CATEGORIES, CATEGORY_LABELS, Category, categoryOf, storageFor } from '../common/access/access.util';

export class UpdateUserAccessDto {
  @ApiPropertyOptional({ enum: CATEGORIES })
  @IsOptional()
  @IsIn(CATEGORIES as unknown as string[])
  category?: Category;

  @ApiPropertyOptional({ nullable: true, description: "The agent's Team Lead (a TEAM_LEAD user id) - null removes it" })
  @IsOptional()
  @IsString()
  teamLeadId?: string | null;
}

const USER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  role: true,
  designation: true,
  officeCategory: true,
  managerId: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

/**
 * Admin/Boss only: see everyone's category, change it (including granting
 * Admin/Boss - the only way to get full access), and set each agent's Team Lead.
 */
@ApiTags('Users (Admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('users.manage')
@Controller('admin/users')
export class UsersAdminController {
  constructor(private readonly prisma: PrismaService) {}

  @ApiOperation({ summary: "Everyone in the organization with their category and Team Lead" })
  @Get()
  async list(@Req() req: any) {
    const users = await this.prisma.user.findMany({
      where: { organizationId: req.user.organizationId },
      select: USER_SELECT,
      orderBy: { firstName: 'asc' },
    });
    const names = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
    return users.map((u) => {
      const category = categoryOf(u);
      return {
        id: u.id,
        name: `${u.firstName} ${u.lastName}`.trim(),
        email: u.email,
        category,
        categoryLabel: CATEGORY_LABELS[category],
        // True when the category is derived from an older account's role/designation.
        categoryIsDerived: !u.officeCategory,
        teamLeadId: u.managerId || null,
        teamLeadName: u.managerId ? names.get(u.managerId) || null : null,
        isActive: u.isActive,
        lastLoginAt: u.lastLoginAt,
      };
    });
  }

  @ApiOperation({ summary: "Change someone's category and/or Team Lead" })
  @Patch(':id')
  async update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateUserAccessDto) {
    if (!/^[a-f0-9]{24}$/i.test(id)) throw new NotFoundException('User not found');
    const target = await this.prisma.user.findFirst({
      where: { id, organizationId: req.user.organizationId },
      select: USER_SELECT,
    });
    if (!target) throw new NotFoundException('User not found');

    const data: Record<string, unknown> = {};
    if (dto.category) {
      if (target.id === req.user.id && dto.category !== 'ADMIN') {
        throw new ForbiddenException("You can't remove your own Admin access");
      }
      const stored = storageFor(dto.category);
      data.officeCategory = dto.category;
      data.role = stored.role;
      data.designation = stored.designation;
    }
    if (dto.teamLeadId !== undefined) {
      if (dto.teamLeadId === null || dto.teamLeadId === '') {
        data.managerId = null;
      } else {
        if (dto.teamLeadId === id) throw new BadRequestException('Someone cannot be their own Team Lead');
        const lead = /^[a-f0-9]{24}$/i.test(dto.teamLeadId)
          ? await this.prisma.user.findFirst({
              where: { id: dto.teamLeadId, organizationId: req.user.organizationId },
              select: { id: true, role: true, designation: true, officeCategory: true },
            })
          : null;
        if (!lead || categoryOf(lead) !== 'TEAM_LEAD') throw new BadRequestException('Choose a Team Lead');
        data.managerId = lead.id;
      }
    }
    if (Object.keys(data).length === 0) throw new BadRequestException('Nothing to change');

    await this.prisma.user.update({ where: { id }, data });
    const updated = await this.list(req);
    return updated.find((u) => u.id === id);
  }
}
