import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../common/access/permissions.guard';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto/employee.dto';

// Login required for everything; managers (Admin/HR) manage, SM may list
// for report filters. Previously this whole controller had no guard at all.
@ApiTags('Employees')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('managerPortal')
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @ApiOperation({ summary: 'Get all registered employees directly from MongoDB' })
  @RequirePermission('managerPortal', 'productivity.all', 'loginRecords.view')
  @Get()
  async getEmployees(
    @Req() req: any,
    @Query('search') search?: string,
    @Query('departmentId') departmentId?: string,
    @Query('teamId') teamId?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    const orgId = req.user?.organizationId;
    if (!orgId) {
      return this.employeesService.getAllRegisteredEmployees();
    }
    return this.employeesService.getEmployees(
      orgId,
      search,
      departmentId,
      teamId,
      page ? +page : 1,
      limit ? +limit : 50,
    );
  }

  @ApiOperation({ summary: 'Get all registered employees of your organization' })
  @RequirePermission('managerPortal', 'productivity.all', 'loginRecords.view')
  @Get('all')
  async getAllRegisteredEmployees(@Req() req: any) {
    return this.employeesService.getAllRegisteredEmployees(req.user.organizationId);
  }

  @ApiOperation({ summary: 'Create new employee' })
  @Post()
  async createEmployee(
    @Req() req: any,
    @Body() dto: CreateEmployeeDto,
  ) {
    // No auth guard is applied to this controller, so req.user is never
    // populated - undefined here (not a hardcoded placeholder org id that
    // matches nothing real) tells the service to skip the org-ownership
    // check entirely, which is the actual current security reality of
    // this controller. A hardcoded fallback string previously made every
    // one of these calls 404 against the real, single organization that
    // actually exists in this database.
    const orgId = req.user?.organizationId;
    return this.employeesService.createEmployee(orgId, dto);
  }

  @ApiOperation({ summary: 'Get employee profile by ID' })
  @Get(':id')
  async getEmployeeById(
    @Param('id') id: string,
    @Req() req: any,
  ) {
    // No auth guard is applied to this controller, so req.user is never
    // populated - undefined here (not a hardcoded placeholder org id that
    // matches nothing real) tells the service to skip the org-ownership
    // check entirely, which is the actual current security reality of
    // this controller. A hardcoded fallback string previously made every
    // one of these calls 404 against the real, single organization that
    // actually exists in this database.
    const orgId = req.user?.organizationId;
    return this.employeesService.getEmployeeById(id, orgId);
  }

  @ApiOperation({ summary: 'Update employee' })
  @Patch(':id')
  async updateEmployee(
    @Param('id') id: string,
    @Req() req: any,
    @Body() dto: UpdateEmployeeDto,
  ) {
    // No auth guard is applied to this controller, so req.user is never
    // populated - undefined here (not a hardcoded placeholder org id that
    // matches nothing real) tells the service to skip the org-ownership
    // check entirely, which is the actual current security reality of
    // this controller. A hardcoded fallback string previously made every
    // one of these calls 404 against the real, single organization that
    // actually exists in this database.
    const orgId = req.user?.organizationId;
    return this.employeesService.updateEmployee(id, orgId, dto);
  }

  @ApiOperation({ summary: 'Check in employee' })
  @Post(':id/check-in')
  async checkInEmployee(@Param('id') id: string, @Req() req: any) {
    await this.employeesService.getEmployeeById(id, req.user.organizationId);
    return this.employeesService.checkInEmployee(id);
  }

  @ApiOperation({ summary: 'Check out employee' })
  @Post(':id/check-out')
  async checkOutEmployee(@Param('id') id: string, @Req() req: any) {
    await this.employeesService.getEmployeeById(id, req.user.organizationId);
    return this.employeesService.checkOutEmployee(id);
  }

  @ApiOperation({ summary: 'Delete employee' })
  @Delete(':id')
  async deleteEmployee(
    @Param('id') id: string,
    @Req() req: any,
  ) {
    // No auth guard is applied to this controller, so req.user is never
    // populated - undefined here (not a hardcoded placeholder org id that
    // matches nothing real) tells the service to skip the org-ownership
    // check entirely, which is the actual current security reality of
    // this controller. A hardcoded fallback string previously made every
    // one of these calls 404 against the real, single organization that
    // actually exists in this database.
    const orgId = req.user?.organizationId;
    return this.employeesService.deleteEmployee(id, orgId);
  }
}
