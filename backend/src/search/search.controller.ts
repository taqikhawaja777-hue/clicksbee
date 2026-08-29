import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SearchService } from './search.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Search')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
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
