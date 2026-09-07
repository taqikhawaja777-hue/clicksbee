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
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto/employee.dto';

@ApiTags('Employees')
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @ApiOperation({ summary: 'Get all registered employees directly from MongoDB' })
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

  @ApiOperation({ summary: 'Get all registered employees (Public Dashboard)' })
  @Get('all')
  async getAllRegisteredEmployees() {
    return this.employeesService.getAllRegisteredEmployees();
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
  async checkInEmployee(@Param('id') id: string) {
    return this.employeesService.checkInEmployee(id);
  }

  @ApiOperation({ summary: 'Check out employee' })
  @Post(':id/check-out')
  async checkOutEmployee(@Param('id') id: string) {
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
