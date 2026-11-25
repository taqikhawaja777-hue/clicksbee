import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../common/access/permissions.guard';
import { CATEGORY_LABELS, categoryOf } from '../common/access/access.util';

/** A Team Lead's own agents (people whose Team Lead is them) - used to assign work and lead lists. */
@ApiTags('Team')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('team')
export class TeamController {
  constructor(private readonly prisma: PrismaService) {}

  @ApiOperation({ summary: 'My agents (Team Lead)' })
  @RequirePermission('leads.assignTeam')
  @Get('members')
  async members(@Req() req: any) {
    const users = await this.prisma.user.findMany({
      where: { organizationId: req.user.organizationId, managerId: req.user.id, isActive: true },
      select: { id: true, firstName: true, lastName: true, email: true, role: true, designation: true, officeCategory: true },
      orderBy: { firstName: 'asc' },
    });
    return users.map((u) => {
      const category = categoryOf(u);
      return { id: u.id, name: `${u.firstName} ${u.lastName}`.trim(), email: u.email, category, categoryLabel: CATEGORY_LABELS[category] };
    });
  }
}
