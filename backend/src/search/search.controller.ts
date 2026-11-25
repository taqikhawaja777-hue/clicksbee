import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SearchService } from './search.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('Search')
@ApiBearerAuth()
// Cross-employee data - Admin/Boss only (access.util.ts).
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @ApiOperation({ summary: 'Global search across entities' })
  @Get()
  async search(
    @CurrentUser('organizationId') organizationId: string,
    @CurrentUser('role') role: string,
    @Query('q') query: string,
  ) {
    return this.searchService.globalSearch(organizationId, query, role);
  }
}
